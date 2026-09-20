"""Admin for ingestion.

`QuestionTopicMapAdmin` is the most important screen in this file and
arguably in the whole admin. Question→topic mapping is THE GATE: an
attempt not mapped to a topic is a number with no meaning, so nothing
downstream — mastery, weakness, marks-lost attribution, planning — works
until a human has cleared the queue for a paper.

The economics only work if mapping is done once per paper and reused, with
LLM-proposed tags *confirmed* by a person rather than trusted. That shape
dictates the screen: filter to what still needs a decision, set the topic
inline without opening a page, and confirm in bulk.
"""

from django.apps import apps
from django.contrib import admin
from django.db.models import Count, IntegerField, OuterRef, Q, Subquery
from django.db.models.functions import Coalesce
from django.utils import timezone
from django.utils.html import format_html
from django.utils.safestring import mark_safe

from .models import ColumnMappingProfile, IngestBatch, QuestionTopicMap, TestPaper

STATUS_COLOUR = {"pending": "#d97706", "done": "#16a34a", "failed": "#dc2626"}


class MappingStatusFilter(admin.SimpleListFilter):
    """The queue itself. Default view is 'needs a decision'.

    Three states, not two: a question with a proposed topic that nobody has
    confirmed is *not* mapped, and treating it as mapped is how an LLM
    guess silently becomes ground truth.
    """

    title = "mapping status"
    parameter_name = "mapping"

    def lookups(self, request, model_admin):
        return (
            ("todo", "Needs a decision (unmapped or unconfirmed)"),
            ("unmapped", "No topic at all"),
            ("proposed", "Topic proposed, awaiting confirmation"),
            ("confirmed", "Confirmed by a human"),
        )

    def queryset(self, request, qs):
        return {
            "todo": lambda: qs.filter(Q(topic__isnull=True) | Q(confirmed_at__isnull=True)),
            "unmapped": lambda: qs.filter(topic__isnull=True),
            "proposed": lambda: qs.filter(topic__isnull=False, confirmed_at__isnull=True),
            "confirmed": lambda: qs.filter(topic__isnull=False, confirmed_at__isnull=False),
        }.get(self.value(), lambda: qs)()


@admin.register(TestPaper)
class TestPaperAdmin(admin.ModelAdmin):
    list_display = ("name", "institute", "exam", "held_on", "total_questions",
                    "max_marks", "mapping_progress", "attempts_n")
    list_filter = ("institute", "exam")
    search_fields = ("name",)
    list_select_related = ("institute", "exam")
    date_hierarchy = "held_on"

    def get_queryset(self, request):
        """Three counts, three subqueries — deliberately NOT three annotations.

        `Count(...)` over both `question_map` and `attempts` in one
        annotate() joins them together: 525 map rows x 24,000 attempts is a
        12.6M-row intermediate that COUNT(DISTINCT) then has to collapse.
        Measured at 2.5s on the seed data, and it grows with the product of
        the two tables. Correlated subqueries each touch one index and
        measure at ~30ms total.
        """
        def n(qs):
            return Coalesce(
                Subquery(
                    qs.filter(test_paper=OuterRef("pk"))
                    .order_by().values("test_paper")
                    .annotate(c=Count("*")).values("c")[:1],
                    output_field=IntegerField(),
                ),
                0,
            )

        return super().get_queryset(request).annotate(
            _mapped=n(QuestionTopicMap.objects.filter(
                topic__isnull=False, confirmed_at__isnull=False)),
            _questions=n(QuestionTopicMap.objects.all()),
            _attempts=n(apps.get_model("events", "Attempt").objects.all()),
        )

    @admin.display(description="mapped", ordering="_mapped")
    def mapping_progress(self, obj):
        """How far this paper is through the gate. Red until it is through."""
        if not obj._questions:
            return mark_safe('<span style="color:#dc2626">no map rows</span>')
        pct = obj._mapped * 100 // obj._questions
        colour = "#16a34a" if pct == 100 else "#d97706" if pct else "#dc2626"
        return format_html(
            '<span style="color:{}">{}/{} ({}%)</span>',
            colour, obj._mapped, obj._questions, pct,
        )

    @admin.display(description="attempts", ordering="_attempts")
    def attempts_n(self, obj):
        return obj._attempts


@admin.register(QuestionTopicMap)
class QuestionTopicMapAdmin(admin.ModelAdmin):
    """The mapping review queue."""

    list_display = ("question_id", "test_paper", "topic", "topic_path",
                    "excerpt", "proposed_by", "state", "confirmed_by")
    list_display_links = ("question_id",)
    # Set the topic straight from the changelist — 75 questions mapped
    # without ever leaving the page, which is the only way the per-paper
    # cost stays bearable.
    list_editable = ("topic",)
    list_filter = (MappingStatusFilter, "institute", "test_paper", "proposed_by")
    search_fields = ("question_id", "question_text", "topic__name")
    # Autocomplete rather than raw_id for `topic`: a reviewer knows the
    # chapter name, not its integer id, and the raw_id widget additionally
    # costs one query per row when used inside list_editable.
    autocomplete_fields = ("topic",)
    raw_id_fields = ("test_paper", "institute", "confirmed_by")
    list_select_related = ("test_paper", "topic__parent__parent", "confirmed_by")
    # One paper's worth. Also caps the one unavoidable cost of an editable FK
    # in a changelist: Django's autocomplete widget re-fetches the selected
    # option per row, so a page is 75 primary-key lookups (~150ms here).
    # Worth it — the alternative is 75 page loads.
    list_per_page = 75
    save_on_top = True
    actions = ("confirm_mappings", "unconfirm_mappings")
    fields = ("institute", "test_paper", "question_id", "question_text",
              "topic", "proposed_by", "confirmed_by", "confirmed_at")

    @admin.display(description="topic path")
    def topic_path(self, obj):
        return obj.topic.path if obj.topic_id else mark_safe(
            '<span style="color:#dc2626">unmapped &mdash; blocks everything downstream</span>'
        )

    @admin.display(description="question")
    def excerpt(self, obj):
        text = (obj.question_text or "").strip()
        return (text[:70] + "…") if len(text) > 70 else (text or "—")

    @admin.display(description="state")
    def state(self, obj):
        if obj.topic_id is None:
            return mark_safe('<span style="color:#dc2626">unmapped</span>')
        if obj.confirmed_at is None:
            return mark_safe('<span style="color:#d97706">proposed, unconfirmed</span>')
        return format_html('<span style="color:#16a34a">confirmed {}</span>',
                           obj.confirmed_at.date())

    @admin.action(description="Confirm mapping (stamp me and now)")
    def confirm_mappings(self, request, queryset):
        """Human confirmation is the whole point of the workflow.

        Refuses rows with no topic rather than confirming an empty mapping —
        that would pass the gate while still meaning nothing.
        """
        unmapped = queryset.filter(topic__isnull=True).count()
        n = queryset.filter(topic__isnull=False).update(
            confirmed_by=request.user, confirmed_at=timezone.now()
        )
        self.message_user(request, f"Confirmed {n} mapping(s).")
        if unmapped:
            self.message_user(
                request,
                f"Skipped {unmapped} row(s) with no topic — set a topic first.",
                level="WARNING",
            )

    @admin.action(description="Withdraw confirmation (send back to the queue)")
    def unconfirm_mappings(self, request, queryset):
        n = queryset.update(confirmed_by=None, confirmed_at=None)
        self.message_user(request, f"Returned {n} mapping(s) to the queue.")


@admin.register(IngestBatch)
class IngestBatchAdmin(admin.ModelAdmin):
    list_display = ("filename", "institute", "test_paper", "status_chip",
                    "row_count", "rows_ok", "rows_failed", "created_at")
    list_filter = ("institute", "status")
    search_fields = ("filename", "file_hash")
    list_select_related = ("institute", "test_paper")
    raw_id_fields = ("test_paper",)
    date_hierarchy = "created_at"
    readonly_fields = ("file_hash", "raw_snapshot", "created_at")

    def has_add_permission(self, request):
        # Batches are created by the ingest pipeline, which computes the
        # file hash that makes re-upload idempotent. A hand-made row would
        # have no hash and no snapshot to replay from.
        return False

    @admin.display(description="status", ordering="status")
    def status_chip(self, obj):
        return format_html(
            '<span style="background:{};color:#fff;padding:1px 6px;'
            'border-radius:3px;font-size:11px">{}</span>',
            STATUS_COLOUR.get(obj.status, "#6b7280"), obj.get_status_display(),
        )


@admin.register(ColumnMappingProfile)
class ColumnMappingProfileAdmin(admin.ModelAdmin):
    list_display = ("name", "institute", "fields_mapped", "created_at")
    list_filter = ("institute",)
    search_fields = ("name",)
    list_select_related = ("institute",)
    date_hierarchy = "created_at"

    @admin.display(description="columns mapped")
    def fields_mapped(self, obj):
        return len(obj.mapping or {})
