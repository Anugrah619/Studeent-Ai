"""Ingestion support — how an institute's spreadsheets become canonical events.

The largest engineering surface in the project (P1). Every institute
exports differently, names collide, and half the papers carry no chapter
tags. These tables make that mess repeatable and reversible.
"""

from django.db import models

from apps.tenancy import models as tenancy


class TestPaper(tenancy.TenantScoped):
    name = models.CharField(max_length=200)                  # "Mock 14"
    exam = models.ForeignKey("syllabus.Exam", on_delete=models.PROTECT)
    held_on = models.DateField()
    total_questions = models.IntegerField(default=75)
    max_marks = models.IntegerField(default=300)
    marks_correct = models.IntegerField(default=4)
    marks_wrong = models.IntegerField(default=-1)
    duration_min = models.IntegerField(default=180)

    class Meta:
        ordering = ["-held_on"]

    def __str__(self) -> str:
        return self.name


class ColumnMappingProfile(tenancy.TenantScoped):
    """How this institute's spreadsheet columns map onto canonical fields.

    Saved once per institute and reused on every later upload, so the
    second import of the same format is fully automatic.
    """

    name = models.CharField(max_length=100)
    mapping = models.JSONField(default=dict)      # {"Roll No": "roll_no", ...}
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return self.name


class IngestBatch(tenancy.TenantScoped):
    """One uploaded file. Everything it produced traces back here.

    `file_hash` gives idempotency — the same file uploaded twice must not
    double every attempt. `raw_snapshot` keeps the original rows so an
    ingest can be replayed after a parser fix.
    """

    PENDING, DONE, FAILED = "pending", "done", "failed"
    STATUS = [(PENDING, "Pending"), (DONE, "Done"), (FAILED, "Failed")]

    filename = models.CharField(max_length=500)
    file_hash = models.CharField(max_length=64)
    test_paper = models.ForeignKey(
        TestPaper, null=True, blank=True, on_delete=models.SET_NULL
    )
    row_count = models.IntegerField(default=0)
    rows_ok = models.IntegerField(default=0)
    rows_failed = models.IntegerField(default=0)
    status = models.CharField(max_length=10, choices=STATUS, default=PENDING)
    raw_snapshot = models.JSONField(null=True, blank=True)
    error = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["institute", "file_hash"], name="uniq_file_per_institute"
            )
        ]
        verbose_name_plural = "ingest batches"

    def __str__(self) -> str:
        return f"{self.filename} ({self.status})"


class Misconception(models.Model):
    """A systematic wrong belief that produces predictable wrong answers.

    Not carelessness — a stable, wrong mental model. This is the vocabulary
    the whole reasoning layer speaks, and it is what turns "Aarav is weak at
    Rotational Motion" (useless) into "Aarav uses the centre-of-mass axis
    when rotation is about the end" (a twenty-minute fix).

    Global, not tenant-scoped: physics misconceptions are the same in Kota
    and Jaipur. Institutes share the taxonomy; only their data is separate.
    """

    code = models.CharField(max_length=32, unique=True)      # "MIS-ROT-AXIS"
    subject = models.CharField(max_length=32)                # Physics | Chemistry | Maths
    name = models.CharField(max_length=120)                  # "Wrong axis of rotation"
    description = models.TextField(
        help_text="The wrong belief, stated as the student would hold it."
    )
    remedy = models.TextField(
        blank=True, help_text="What actually fixes it. Shown to the mentor."
    )

    class Meta:
        ordering = ["subject", "code"]

    def __str__(self) -> str:
        return f"{self.code} — {self.name}"


class QuestionOption(models.Model):
    """One lettered option, and — if it is wrong — what mistake produces it.

    The `misconception` FK is the entire point of this table. Knowing a
    student answered incorrectly is worth almost nothing; knowing they chose
    the option that a specific wrong belief produces, repeatedly, is a
    diagnosis.
    """

    question = models.ForeignKey(
        "ingestion.QuestionTopicMap", on_delete=models.CASCADE, related_name="options"
    )
    label = models.CharField(max_length=2)                   # "A" … "D"
    text = models.CharField(max_length=500)
    is_correct = models.BooleanField(default=False)

    # Null on the correct option, and on wrong options we have not yet
    # explained. A wrong option with no misconception is a gap in the
    # taxonomy, not a bug — it just cannot contribute to a diagnosis.
    misconception = models.ForeignKey(
        Misconception, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="distractors",
    )

    class Meta:
        ordering = ["question", "label"]
        constraints = [
            models.UniqueConstraint(
                fields=["question", "label"], name="uniq_option_per_question"
            )
        ]

    def __str__(self) -> str:
        mark = "✓" if self.is_correct else "✗"
        return f"({self.label}) {mark} {self.text[:40]}"


class QuestionTopicMap(tenancy.TenantScoped):
    """THE GATE. Nothing downstream works without this.

    An unmapped question is a number with no meaning. Mapping is a
    one-time cost per paper that pays out on every future student who
    sits it — so it is stored permanently with human confirmation, never
    inferred at runtime.
    """

    BLUEPRINT, LLM, MANUAL = "blueprint", "llm", "manual"
    SOURCE = [(BLUEPRINT, "Paper blueprint"), (LLM, "LLM proposed"), (MANUAL, "Manual")]

    test_paper = models.ForeignKey(
        TestPaper, on_delete=models.CASCADE, related_name="question_map"
    )
    question_id = models.CharField(max_length=100)           # "Q14"
    topic = models.ForeignKey(
        "syllabus.Topic", null=True, blank=True, on_delete=models.PROTECT
    )
    question_text = models.TextField(blank=True)

    # --- content ------------------------------------------------------
    # Added for the reasoning layer. Without these, the richest prompt we
    # can build is "got Q17 wrong, topic Rotational Motion" — from which no
    # model produces a diagnosis. See TECHNICAL_DOC.md §2.
    solution = models.TextField(
        blank=True, help_text="The worked method, not just the final answer."
    )
    difficulty = models.CharField(
        max_length=8, blank=True,
        choices=[("easy", "Easy"), ("medium", "Medium"), ("hard", "Hard")],
    )

    proposed_by = models.CharField(max_length=12, choices=SOURCE, blank=True)
    confirmed_by = models.ForeignKey(
        "tenancy.User", null=True, blank=True, on_delete=models.SET_NULL
    )
    confirmed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["test_paper", "question_id"]
        constraints = [
            models.UniqueConstraint(
                fields=["test_paper", "question_id"], name="uniq_question_per_paper"
            )
        ]
        indexes = [models.Index(fields=["test_paper", "topic"])]

    def __str__(self) -> str:
        return f"{self.test_paper.name} {self.question_id}"

    @property
    def is_mapped(self) -> bool:
        return self.topic_id is not None and self.confirmed_at is not None

    @property
    def has_content(self) -> bool:
        """Can this question support a diagnosis, or only a score?"""
        return bool(self.question_text) and self.options.exists()

    @property
    def correct_option(self) -> "QuestionOption | None":
        return self.options.filter(is_correct=True).first()
