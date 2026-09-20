"""Admin for tenancy and people.

A note that applies to every admin module in this project: the admin is
*not* outside the tenancy story. `TenantMiddleware` runs before the view,
so a staff user who is not a Django superuser has their connection scoped
to their own institute and the changelists below filter themselves in
Postgres. Superusers are deliberately unscoped — the admin is our
back-office, and mapping review and tenant management are cross-tenant
jobs. See apps/tenancy/rls.py.
"""

from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin
from django.db.models import Count, Q
from django.urls import reverse
from django.utils.html import format_html

from .models import Batch, Institute, Mentor, Student, User


def link(obj, label=None):
    """Admin change-link for any model instance, or an em dash for None."""
    if obj is None:
        return "—"
    url = reverse(
        f"admin:{obj._meta.app_label}_{obj._meta.model_name}_change", args=[obj.pk]
    )
    return format_html('<a href="{}">{}</a>', url, label or str(obj))


@admin.register(User)
class UserAdmin(DjangoUserAdmin):
    list_display = ("username", "email", "role", "is_staff", "is_superuser", "last_login")
    list_filter = ("is_staff", "is_superuser", "is_active")
    search_fields = ("username", "email", "first_name", "last_name")
    ordering = ("username",)

    @admin.display(description="role")
    def role(self, obj):
        """Which side of the product this login is for.

        Worth surfacing because Student.user is nullable by design: in the
        Tier-0 model an institute uploads marks and the student never logs
        in, so most students have no row here at all.
        """
        mentor = getattr(obj, "mentor", None)
        if mentor:
            return format_html("mentor · {}", link(mentor.institute))
        student = getattr(obj, "student", None)
        if student:
            return format_html("student · {}", link(student))
        if obj.is_superuser:
            return "superuser (cross-tenant)"
        return "—"


@admin.register(Institute)
class InstituteAdmin(admin.ModelAdmin):
    list_display = ("name", "city", "slug", "students", "batches", "mentors", "created_at")
    search_fields = ("name", "city", "slug")
    prepopulated_fields = {"slug": ("name",)}
    date_hierarchy = "created_at"

    def get_queryset(self, request):
        return super().get_queryset(request).annotate(
            _students=Count("tenancy_student_set", distinct=True),
            _batches=Count("tenancy_batch_set", distinct=True),
            _mentors=Count("tenancy_mentor_set", distinct=True),
        )

    @admin.display(ordering="_students", description="students")
    def students(self, obj):
        return obj._students

    @admin.display(ordering="_batches", description="batches")
    def batches(self, obj):
        return obj._batches

    @admin.display(ordering="_mentors", description="mentors")
    def mentors(self, obj):
        return obj._mentors


@admin.register(Mentor)
class MentorAdmin(admin.ModelAdmin):
    list_display = ("name", "institute", "email", "has_login", "caseload")
    list_filter = ("institute",)
    search_fields = ("name", "email", "user__username")
    autocomplete_fields = ("user",)
    list_select_related = ("institute", "user")

    def get_queryset(self, request):
        return super().get_queryset(request).annotate(_caseload=Count("students"))

    @admin.display(boolean=True, description="login")
    def has_login(self, obj):
        return obj.user_id is not None

    @admin.display(ordering="_caseload", description="students owned")
    def caseload(self, obj):
        return obj._caseload


@admin.register(Batch)
class BatchAdmin(admin.ModelAdmin):
    list_display = ("name", "institute", "exam", "year", "exam_date", "syllabus", "size")
    list_filter = ("institute", "exam", "year")
    search_fields = ("name",)
    list_select_related = ("institute", "exam", "syllabus")
    autocomplete_fields = ("syllabus",)

    def get_queryset(self, request):
        return super().get_queryset(request).annotate(_size=Count("students"))

    @admin.display(ordering="_size", description="students")
    def size(self, obj):
        return obj._size


@admin.register(Student)
class StudentAdmin(admin.ModelAdmin):
    list_display = (
        "name", "roll_no", "batch", "institute", "mentor",
        "status", "open_flags", "joined_at",
    )
    list_filter = ("institute", "batch", "mentor", ("exited_at", admin.EmptyFieldListFilter))
    search_fields = ("name", "roll_no", "user__username")
    # batch__exam, not batch: Batch.__str__ renders the exam code, so
    # stopping at batch costs one query per row.
    list_select_related = ("institute", "batch__exam", "mentor")
    autocomplete_fields = ("user",)
    raw_id_fields = ("batch", "mentor")
    date_hierarchy = "joined_at"
    readonly_fields = ("state_summary",)
    fieldsets = (
        (None, {"fields": ("institute", "batch", "roll_no", "name", "mentor")}),
        ("Account", {
            "fields": ("user",),
            "description": "Null until the student onboards onto the app (P4). "
                           "Tier-0 institutes upload marks and the student never logs in.",
        }),
        ("Lifecycle", {
            "fields": ("target", "joined_at", "exited_at"),
            "description": "exited_at is the dropout label — supervised-learning "
                           "ground truth for the risk model. Cheap now, impossible "
                           "to reconstruct later.",
        }),
        ("Derived", {"fields": ("state_summary",), "classes": ("collapse",)}),
    )

    def get_queryset(self, request):
        return super().get_queryset(request).annotate(
            _open_flags=Count("flags", filter=Q(flags__resolved_at__isnull=True))
        )

    @admin.display(boolean=True, description="active")
    def status(self, obj):
        return obj.exited_at is None

    @admin.display(ordering="_open_flags", description="open flags")
    def open_flags(self, obj):
        return obj._open_flags

    @admin.display(description="student state")
    def state_summary(self, obj):
        state = getattr(obj, "state", None)
        if state is None:
            return "No StudentState row yet — run the recompute."
        return format_html(
            "risk {} · consistency {} · revision debt {} · mock avg {} — {}",
            state.risk_score, state.consistency, state.revision_debt,
            state.mock_avg, link(state, "open"),
        )
