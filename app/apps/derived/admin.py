"""Admin for derived state.

Everything in this app is DISPOSABLE — it can be dropped and rebuilt from
the event log alone, and that property is what makes it safe to change the
mastery model and replay history.

So the admin treats these tables as a *window onto the engines*, not an
editing surface. `TopicState`, `StudentState` and `PlanBlock` are
read-only: hand-editing a mastery score produces a number that the next
recompute silently overwrites, and in the meantime a mentor has acted on
it. Deletion is allowed, because dropping derived rows is a legitimate
operation — that is exactly what a rebuild does.

`Flag` and `Intervention` are the exception and ARE editable: resolving a
flag and recording its outcome is a human judgement, not a computed value,
and those two fields are the training labels for the eventual risk model.
"""

from django.contrib import admin
from django.utils.html import format_html
from django.utils.safestring import mark_safe

from .models import Flag, Intervention, PlanBlock, StudentState, TopicState

SEVERITY_COLOUR = {
    Flag.CRITICAL: "#dc2626",
    Flag.HIGH: "#ea580c",
    Flag.WATCH: "#d97706",
    Flag.IMPROVING: "#16a34a",
}


def bar(value, *, invert=False):
    """A 0-1 float as a small coloured bar. Reading 40 floats in a column is
    the kind of thing a person is bad at and a bar is good at."""
    if value is None:
        return mark_safe('<span style="color:#94a3b8">&mdash;</span>')
    pct = max(0, min(100, round(value * 100)))
    good = pct >= 60
    if invert:
        good = pct < 55
    colour = "#16a34a" if good else "#dc2626" if (pct < 40) != invert else "#d97706"
    return format_html(
        '<span style="display:inline-block;width:60px;background:#e2e8f0;'
        'border-radius:2px"><span style="display:inline-block;width:{}%;'
        'background:{};height:10px;border-radius:2px"></span></span> {}',
        pct, colour, f"{value:.2f}",
    )


class ComputedAdmin(admin.ModelAdmin):
    """Read-only, but deletable. See the module docstring."""

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def get_readonly_fields(self, request, obj=None):
        return [f.name for f in self.model._meta.fields]


@admin.register(TopicState)
class TopicStateAdmin(ComputedAdmin):
    list_display = ("student", "topic_path", "mastery_bar", "retention_bar",
                    "attempts_n", "correct_n", "accuracy_30d", "exposure_min",
                    "self_rating", "gap", "last_seen")
    list_filter = ("institute", "topic__kind", "topic__syllabus")
    search_fields = ("student__name", "student__roll_no", "topic__name")
    raw_id_fields = ("student", "topic", "institute")
    list_select_related = ("student", "topic__parent__parent")
    date_hierarchy = "last_seen"
    show_full_result_count = False
    list_per_page = 50

    @admin.display(description="topic", ordering="topic__name")
    def topic_path(self, obj):
        return obj.topic.path

    @admin.display(description="mastery", ordering="mastery")
    def mastery_bar(self, obj):
        """Null is shown as an em dash, never as 0.

        Below the evidence floor we report nothing rather than a
        confident-looking number derived from four attempts — showing 0.00
        here would leak exactly the false confidence the null exists to
        prevent.
        """
        return bar(obj.mastery)

    @admin.display(description="retention", ordering="retention")
    def retention_bar(self, obj):
        return bar(obj.retention)

    @admin.display(description="conf. gap")
    def gap(self, obj):
        """Self-rating minus measured mastery. Positive = overconfident."""
        g = obj.confidence_gap
        if g is None:
            return "—"
        colour = "#dc2626" if g > 0.25 else "#64748b"
        # format_html escapes args into SafeString, which has no __format__
        # for 'f' — so the number is rendered before it is interpolated.
        return format_html('<span style="color:{}">{}</span>', colour, f"{g:+.2f}")


@admin.register(StudentState)
class StudentStateAdmin(ComputedAdmin):
    list_display = ("student", "risk_bar", "consistency", "load_index",
                    "balance_index", "revision_debt", "mock_avg", "mock_trend",
                    "syllabus_pct", "computed_at")
    list_filter = ("institute", "student__batch")
    search_fields = ("student__name", "student__roll_no")
    raw_id_fields = ("student", "institute")
    list_select_related = ("student__batch",)
    date_hierarchy = "computed_at"

    @admin.display(description="risk", ordering="risk_score")
    def risk_bar(self, obj):
        return bar(obj.risk_score, invert=True)


@admin.register(Flag)
class FlagAdmin(admin.ModelAdmin):
    """Editable — resolving a flag and recording its outcome is a human call.

    `Flag.outcome` plus `Intervention` are what close the risk loop, and
    they double as the training labels for the risk model. A flag that is
    never closed is a bug in the detector, not a stubborn student, so the
    default filter here is deliberately the open ones.
    """

    list_display = ("raised_at", "student", "severity_chip", "type", "headline",
                    "topic", "open_state", "outcome", "rule_version", "actions_n")
    list_filter = ("institute", "severity", "type", "outcome",
                   ("resolved_at", admin.EmptyFieldListFilter), "rule_version")
    search_fields = ("student__name", "student__roll_no", "headline", "type")
    raw_id_fields = ("student", "topic", "institute")
    list_select_related = ("student__batch", "topic")
    date_hierarchy = "raised_at"
    readonly_fields = ("evidence_pretty", "raised_at", "rule_version")
    inlines = ()
    fieldsets = (
        (None, {"fields": ("institute", "student", "topic", "type", "severity",
                           "headline")}),
        ("Evidence", {
            "fields": ("evidence_pretty", "rule_version", "raised_at"),
            "description": "Exactly what the detector measured. This is how we "
                           "answer 'why was this student flagged?' six months "
                           "later, after the rule has changed twice.",
        }),
        ("Closing the loop", {
            "fields": ("resolved_at", "outcome"),
            "description": "outcome is a training label for the risk model — "
                           "'unknown' is an honest answer, a blank is not.",
        }),
    )

    def get_queryset(self, request):
        from django.db.models import Count
        return super().get_queryset(request).annotate(_actions=Count("interventions"))

    @admin.display(description="severity", ordering="severity")
    def severity_chip(self, obj):
        return format_html(
            '<span style="background:{};color:#fff;padding:1px 6px;'
            'border-radius:3px;font-size:11px">{}</span>',
            SEVERITY_COLOUR.get(obj.severity, "#6b7280"), obj.get_severity_display(),
        )

    @admin.display(boolean=True, description="open")
    def open_state(self, obj):
        return obj.is_open

    @admin.display(ordering="_actions", description="interventions")
    def actions_n(self, obj):
        return obj._actions

    @admin.display(description="evidence")
    def evidence_pretty(self, obj):
        import json
        return format_html(
            '<pre style="margin:0;font-size:12px">{}</pre>',
            json.dumps(obj.evidence or {}, indent=2, sort_keys=True, default=str),
        )


@admin.register(Intervention)
class InterventionAdmin(admin.ModelAdmin):
    list_display = ("taken_at", "mentor", "student", "flag_type", "action")
    list_filter = ("mentor", "flag__type", "flag__severity")
    search_fields = ("action", "mentor__name", "flag__student__name")
    raw_id_fields = ("flag",)
    list_select_related = ("mentor", "flag__student")
    date_hierarchy = "taken_at"

    @admin.display(description="student")
    def student(self, obj):
        return obj.flag.student

    @admin.display(description="flag", ordering="flag__type")
    def flag_type(self, obj):
        return obj.flag.type


@admin.register(PlanBlock)
class PlanBlockAdmin(ComputedAdmin):
    list_display = ("date", "start_time", "student", "topic", "minutes",
                    "mode", "reason_code", "reason_text", "completed")
    list_filter = ("institute", "mode", "reason_code", "completed")
    search_fields = ("student__name", "student__roll_no", "topic__name")
    raw_id_fields = ("student", "topic", "institute")
    list_select_related = ("student", "topic")
    date_hierarchy = "date"
    show_full_result_count = False
