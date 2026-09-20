"""Admin for the syllabus tree.

This module gets more care than the others because the syllabus editor is
real internal tooling, not a debugging convenience: the tree is versioned
per institute, every event hangs off a Topic, and someone has to sit and
reorganise it when an institute renumbers its chapters.

The tree is an adjacency list, so a flat changelist is naturally confusing.
Three things fix that here: rows are ordered by their position *in the
tree* rather than by raw column, the breadcrumb path is a column, and
`weight`/`position` are editable in place so a whole unit can be
reweighted without opening 12 pages.
"""

from django.contrib import admin
from django.db.models import Count, F
from django.utils.html import format_html

from .models import Exam, SyllabusVersion, Topic

KIND_COLOUR = {Topic.SUBJECT: "#7c3aed", Topic.UNIT: "#0891b2", Topic.CHAPTER: "#64748b"}


@admin.register(Exam)
class ExamAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "marks_correct", "marks_wrong", "total_marks", "versions_n")
    search_fields = ("code", "name")

    def get_queryset(self, request):
        return super().get_queryset(request).annotate(_versions=Count("versions"))

    @admin.display(ordering="_versions", description="syllabus versions")
    def versions_n(self, obj):
        return obj._versions


class TopicInline(admin.TabularInline):
    """Children of the topic being edited — the unit-level editing surface."""

    model = Topic
    fk_name = "parent"
    extra = 0
    fields = ("position", "name", "kind", "weight")
    ordering = ("position", "name")
    show_change_link = True
    verbose_name_plural = "child topics (reorder with position)"


@admin.register(SyllabusVersion)
class SyllabusVersionAdmin(admin.ModelAdmin):
    list_display = ("__str__", "institute", "exam", "version", "is_active", "topics_n", "created_at")
    list_filter = ("institute", "exam", "is_active")
    search_fields = ("institute__name", "exam__code", "exam__name", "note")
    list_select_related = ("institute", "exam")
    date_hierarchy = "created_at"
    actions = ("clone_version",)

    def get_queryset(self, request):
        return super().get_queryset(request).annotate(_topics=Count("topics"))

    @admin.display(ordering="_topics", description="topics")
    def topics_n(self, obj):
        return obj._topics

    @admin.action(description="Clone to a new version (copies the whole tree)")
    def clone_version(self, request, queryset):
        """Whole-tree copy — SYSTEM_DESIGN §8 Q6 answered in favour of 'simple'.

        A syllabus tree is a few hundred rows. Copying all of it costs
        nothing and keeps every historical event bound to the exact
        structure that was current when it was recorded. Per-node
        versioning would save kilobytes and cost weeks of reasoning.
        """
        for source in queryset.select_related("institute", "exam"):
            latest = (
                SyllabusVersion.objects.filter(
                    institute=source.institute, exam=source.exam
                ).order_by("-version").first()
            )
            clone = SyllabusVersion.objects.create(
                institute=source.institute,
                exam=source.exam,
                version=latest.version + 1,
                is_active=False,
                note=f"cloned from v{source.version}",
            )
            # Two passes: create every node, then re-point parents. Avoids
            # depending on the order rows come back in.
            old_to_new = {}
            originals = list(source.topics.all())
            for t in originals:
                old_to_new[t.pk] = Topic.objects.create(
                    syllabus=clone, parent=None, name=t.name,
                    kind=t.kind, weight=t.weight, position=t.position,
                ).pk
            for t in originals:
                if t.parent_id:
                    Topic.objects.filter(pk=old_to_new[t.pk]).update(
                        parent_id=old_to_new[t.parent_id]
                    )
            self.message_user(
                request,
                f"Created {clone} with {len(originals)} topics. It is INACTIVE — "
                "edit it, then tick is_active and untick the old one.",
            )


@admin.register(Topic)
class TopicAdmin(admin.ModelAdmin):
    list_display = ("tree", "kind_chip", "weight", "position", "syllabus", "children_n", "usage")
    list_display_links = ("tree",)
    list_editable = ("weight", "position")
    list_filter = ("kind", "syllabus__institute", "syllabus__exam", "syllabus")
    search_fields = ("name", "parent__name", "parent__parent__name")
    raw_id_fields = ("parent",)
    autocomplete_fields = ("syllabus",)
    inlines = (TopicInline,)
    list_per_page = 100
    save_on_top = True
    fields = ("syllabus", "parent", "name", "kind", "weight", "position")

    def get_queryset(self, request):
        return (
            super().get_queryset(request)
            .select_related("syllabus__institute", "syllabus__exam", "parent__parent")
            .annotate(_children=Count("children", distinct=True))
            # Depth-first order, so the flat list reads like the tree:
            # subject position, then unit position, then the chapter's own.
            .order_by(
                F("parent__parent__position").asc(nulls_first=True),
                F("parent__position").asc(nulls_first=True),
                "position", "name",
            )
        )

    @admin.display(description="topic")
    def tree(self, obj):
        """Name, indented by depth. Reading a tree as a flat list otherwise
        means holding the hierarchy in your head."""
        depth = 0
        node = obj
        while node.parent_id is not None and depth < 6:
            node = node.parent
            depth += 1
        return format_html(
            '<span style="color:#94a3b8">{}</span>{}',
            "    " * depth + ("└ " if depth else ""),
            obj.name,
        )

    @admin.display(description="kind", ordering="kind")
    def kind_chip(self, obj):
        return format_html(
            '<span style="background:{};color:#fff;padding:1px 6px;'
            'border-radius:3px;font-size:11px">{}</span>',
            KIND_COLOUR.get(obj.kind, "#64748b"), obj.get_kind_display(),
        )

    @admin.display(ordering="_children", description="children")
    def children_n(self, obj):
        return obj._children or "—"

    @admin.display(description="path")
    def usage(self, obj):
        """Full breadcrumb. `select_related` above keeps this off the N+1 path
        for the three levels the tree actually has."""
        return obj.path
