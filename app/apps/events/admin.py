"""Admin for the event log.

EVERY MODEL HERE IS READ-ONLY IN THE ADMIN, ON PURPOSE.

The event tables are append-only: rows are never UPDATEd or DELETEd, and a
correction arrives as a new row. That invariant is what lets us change the
mastery model in month six and replay two years of history through it. An
admin that offers an "edit" button on `Attempt` is an invitation to break
it quietly — one well-meaning fix to a mis-scored question and the replay
no longer reproduces what actually happened.

So `AppendOnlyAdmin` below denies add, change and delete. The changelist
and the detail page still work; they are the fastest way to answer "what
did we actually ingest for this student" and that is the only thing the
admin should be doing to an event.

`ChapterStatus` is the exception — it is faculty-maintained state, not a
student event, and is editable.
"""

from django.contrib import admin
from django.utils.html import format_html

from .models import Attempt, ChapterStatus, ConfidenceRating, RevisionEvent, StudyLog

STATUS_COLOUR = {
    Attempt.CORRECT: "#16a34a",
    Attempt.WRONG: "#dc2626",
    Attempt.BLANK: "#d97706",
    Attempt.NOT_REACHED: "#6b7280",
}


class AppendOnlyAdmin(admin.ModelAdmin):
    """Look, don't touch. See the module docstring."""

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def get_readonly_fields(self, request, obj=None):
        return [f.name for f in self.model._meta.fields]


@admin.register(Attempt)
class AttemptAdmin(AppendOnlyAdmin):
    list_display = ("ts", "student", "topic_path", "question_id", "status_chip",
                    "marks", "time_spent", "test_paper", "source")
    list_filter = ("institute", "source", "status", "test_paper")
    search_fields = ("question_id", "student__name", "student__roll_no", "topic__name")
    # 24k rows today, ~20M at target scale. A plain <select> would try to
    # render every student and every topic on each page load. Inert while
    # AppendOnlyAdmin holds every field read-only, and kept deliberately so
    # that relaxing that guard cannot accidentally reintroduce the dropdown.
    raw_id_fields = ("student", "topic", "test_paper", "ingest_batch", "institute")
    list_select_related = ("student", "topic__parent__parent", "test_paper")
    date_hierarchy = "ts"
    list_per_page = 50
    # Skips the second unfiltered COUNT(*) the changelist otherwise runs.
    show_full_result_count = False

    @admin.display(description="topic", ordering="topic__name")
    def topic_path(self, obj):
        return obj.topic.path

    @admin.display(description="status", ordering="status")
    def status_chip(self, obj):
        return format_html(
            '<span style="background:{};color:#fff;padding:1px 6px;'
            'border-radius:3px;font-size:11px">{}</span>',
            STATUS_COLOUR.get(obj.status, "#6b7280"), obj.get_status_display(),
        )


@admin.register(StudyLog)
class StudyLogAdmin(AppendOnlyAdmin):
    list_display = ("ts", "student", "topic", "minutes", "mode", "logged_at", "bulk_logged")
    list_filter = ("institute", "mode")
    search_fields = ("student__name", "student__roll_no", "topic__name")
    raw_id_fields = ("student", "topic", "institute")
    list_select_related = ("student", "topic")
    date_hierarchy = "ts"
    show_full_result_count = False

    @admin.display(boolean=True, description="back-filled?")
    def bulk_logged(self, obj):
        """True when the student told us about a session more than a day after
        it supposedly happened.

        This is the whole reason `logged_at` exists alongside `ts`: a week of
        study entered on Sunday evening is one signal, not seven, and the
        engines down-weight it. Surfacing it here makes the data-quality
        problem visible rather than theoretical.
        """
        if obj.logged_at is None or obj.ts is None:
            return False
        return (obj.logged_at - obj.ts).total_seconds() > 86_400


@admin.register(ConfidenceRating)
class ConfidenceRatingAdmin(AppendOnlyAdmin):
    list_display = ("ts", "student", "topic", "self_rating")
    list_filter = ("institute", "self_rating")
    search_fields = ("student__name", "student__roll_no", "topic__name")
    raw_id_fields = ("student", "topic", "institute")
    list_select_related = ("student", "topic")
    date_hierarchy = "ts"
    show_full_result_count = False


@admin.register(RevisionEvent)
class RevisionEventAdmin(AppendOnlyAdmin):
    list_display = ("scheduled_for", "student", "topic", "cycle", "done_at", "overdue")
    list_filter = ("institute", "cycle", ("done_at", admin.EmptyFieldListFilter))
    search_fields = ("student__name", "student__roll_no", "topic__name")
    raw_id_fields = ("student", "topic", "institute")
    list_select_related = ("student", "topic")
    date_hierarchy = "scheduled_for"
    show_full_result_count = False

    @admin.display(boolean=True, description="overdue")
    def overdue(self, obj):
        return obj.is_overdue


@admin.register(ChapterStatus)
class ChapterStatusAdmin(admin.ModelAdmin):
    """Editable: this is faculty-maintained state, not a student event.

    It answers "has this chapter been covered in class yet", which gates
    whether a weak-topic flag is fair — flagging a student on a chapter
    nobody has taught them is how a console loses its audience.
    """

    list_display = ("batch", "topic", "taught_at", "completed_at", "progress")
    list_filter = ("institute", "batch", ("completed_at", admin.EmptyFieldListFilter))
    search_fields = ("topic__name", "batch__name")
    raw_id_fields = ("topic",)
    # batch__exam, not batch: Batch.__str__ renders the exam code, so
    # stopping at batch costs one query per row.
    list_select_related = ("batch__exam", "topic", "institute")
    list_editable = ("taught_at", "completed_at")
    date_hierarchy = "taught_at"

    @admin.display(description="state")
    def progress(self, obj):
        if obj.completed_at:
            return "completed"
        if obj.taught_at:
            return "in progress"
        return "not started"
