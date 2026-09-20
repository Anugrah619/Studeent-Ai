"""Tenancy and people.

`Institute` is the tenant root. Every tenant-scoped table in the project
carries an `institute` FK, and isolation is enforced in PostgreSQL by
row-level security rather than in application code — one forgotten
`.filter(institute=...)` would otherwise leak a competitor's students.
"""

from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    """Login account.

    Deliberately thin. Not every person in the system has one:
    - Mentors and directors always do.
    - Students only get an account if they onboard onto the app (P4).
      In the Tier-0 model the institute uploads marks and the student
      never logs in, so Student.user stays null.
    """

    class Meta:
        db_table = "auth_user_custom"

    def __str__(self) -> str:
        return self.get_username()


class TenantScoped(models.Model):
    """Abstract base for anything owned by one institute."""

    institute = models.ForeignKey(
        "tenancy.Institute",
        on_delete=models.CASCADE,
        related_name="%(app_label)s_%(class)s_set",
    )

    class Meta:
        abstract = True


class Institute(models.Model):
    name = models.CharField(max_length=200)
    city = models.CharField(max_length=100)
    slug = models.SlugField(max_length=80, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name


class Mentor(TenantScoped):
    user = models.OneToOneField(
        User, null=True, blank=True, on_delete=models.SET_NULL, related_name="mentor"
    )
    name = models.CharField(max_length=200)
    email = models.EmailField(blank=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name


class Batch(TenantScoped):
    name = models.CharField(max_length=100)                      # "Alpha", "Dropper"
    exam = models.ForeignKey("syllabus.Exam", on_delete=models.PROTECT)
    year = models.IntegerField()                                 # target exam year
    syllabus = models.ForeignKey(
        "syllabus.SyllabusVersion", null=True, blank=True, on_delete=models.PROTECT
    )
    exam_date = models.DateField(null=True, blank=True)          # drives deadline-aware scheduling

    class Meta:
        ordering = ["institute", "name"]
        verbose_name_plural = "batches"

    def __str__(self) -> str:
        return f"{self.name} ({self.exam.code} {self.year})"


class Student(TenantScoped):
    batch = models.ForeignKey(Batch, on_delete=models.PROTECT, related_name="students")
    roll_no = models.CharField(max_length=50)
    name = models.CharField(max_length=200)
    mentor = models.ForeignKey(
        Mentor, null=True, blank=True, on_delete=models.SET_NULL, related_name="students"
    )

    # Null until the student onboards onto the app (P4). See User docstring.
    user = models.OneToOneField(
        User, null=True, blank=True, on_delete=models.SET_NULL, related_name="student"
    )

    target = models.CharField(max_length=100, blank=True)        # "AIR < 5000"
    joined_at = models.DateField()

    # Dropout label. Supervised-learning ground truth for the risk model —
    # cheap to capture now, impossible to reconstruct later.
    exited_at = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(
                fields=["institute", "batch", "roll_no"], name="uniq_roll_per_batch"
            )
        ]
        indexes = [models.Index(fields=["institute", "batch"])]

    def __str__(self) -> str:
        return f"{self.name} ({self.roll_no})"

    @property
    def is_active(self) -> bool:
        return self.exited_at is None
