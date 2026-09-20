"""The syllabus tree — the spine every other table hangs off.

An attempt not mapped to a Topic is a number with no meaning, so this
app is defined first and everything else references it.

The tree is versioned *per institute*: two coaching centres teaching the
same exam split, name and sequence chapters differently. A single global
tree does not survive the second customer.
"""

from django.db import models


class Exam(models.Model):
    code = models.CharField(max_length=32, unique=True)      # "JEE_MAIN"
    name = models.CharField(max_length=100)                  # "JEE Main"
    marks_correct = models.IntegerField(default=4)
    marks_wrong = models.IntegerField(default=-1)            # negative marking
    total_marks = models.IntegerField(default=300)

    class Meta:
        ordering = ["code"]

    def __str__(self) -> str:
        return self.name


class SyllabusVersion(models.Model):
    """A snapshot of one institute's chapter breakdown for one exam.

    Changes create a new version rather than editing the old one, so
    historical attempts stay bound to the structure that was current when
    they were recorded. Without this, a syllabus revision silently
    corrupts every past analysis.
    """

    institute = models.ForeignKey(
        "tenancy.Institute", on_delete=models.CASCADE, related_name="syllabus_versions"
    )
    exam = models.ForeignKey(Exam, on_delete=models.CASCADE, related_name="versions")
    version = models.IntegerField(default=1)
    is_active = models.BooleanField(default=False)
    note = models.CharField(max_length=200, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["institute", "exam", "version"], name="uniq_syllabus_version"
            )
        ]
        ordering = ["institute", "exam", "-version"]

    def __str__(self) -> str:
        return f"{self.institute.name} · {self.exam.code} v{self.version}"


class Topic(models.Model):
    """A node in the syllabus tree — subject, unit, or chapter.

    Stored as an adjacency list (self-referencing `parent`). Simple, and
    sufficient while subtree queries stay cold. If "all topics under
    Physics" becomes a hot path, revisit with Postgres ltree.
    """

    SUBJECT, UNIT, CHAPTER = "subject", "unit", "chapter"
    KIND = [(SUBJECT, "Subject"), (UNIT, "Unit"), (CHAPTER, "Chapter")]

    syllabus = models.ForeignKey(
        SyllabusVersion, on_delete=models.CASCADE, related_name="topics"
    )
    parent = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.CASCADE, related_name="children"
    )
    name = models.CharField(max_length=200)
    kind = models.CharField(max_length=10, choices=KIND)

    # Typical marks this chapter carries in the exam. Derived from ~10 years
    # of previous papers. The planner uses it to prioritise when time is short.
    weight = models.FloatField(default=1.0)

    # Teaching order within the parent.
    position = models.IntegerField(default=0)

    class Meta:
        ordering = ["syllabus", "position", "name"]
        indexes = [
            models.Index(fields=["syllabus", "parent"]),
            models.Index(fields=["syllabus", "kind"]),
        ]

    def __str__(self) -> str:
        return self.name

    @property
    def subject(self) -> "Topic | None":
        """Walk up to the subject node. Used constantly in analytics."""
        node = self
        while node and node.kind != self.SUBJECT:
            node = node.parent
        return node

    @property
    def path(self) -> str:
        parts, node = [], self
        while node:
            parts.append(node.name)
            node = node.parent
        return " › ".join(reversed(parts))
