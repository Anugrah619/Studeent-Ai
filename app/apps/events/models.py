"""Event tables — append-only, keyed (student, topic, ts).

THE INVARIANT: rows here are never UPDATEd or DELETEd. A correction
arrives as a new row.

Why it matters concretely: when the mastery formula changes in month six,
we delete all derived state, replay every event through the new formula,
and see exactly what it would have flagged across the whole history. If
rows were overwritten, that history is gone and we are guessing.
"""

from django.db import models

from apps.tenancy import models as tenancy


class Attempt(tenancy.TenantScoped):
    """One student's answer to one question.

    `status` is an enum rather than a nullable boolean so the mock
    analyzer can distinguish *ran out of time* from *chose to skip* —
    those two need completely different advice. (SYSTEM_DESIGN.md open
    question 5, resolved in favour of the enum.)
    """

    CORRECT, WRONG, BLANK, NOT_REACHED = "correct", "wrong", "blank", "not_reached"
    STATUS = [
        (CORRECT, "Correct"),
        (WRONG, "Wrong"),
        (BLANK, "Skipped deliberately"),
        (NOT_REACHED, "Ran out of time"),
    ]

    MOCK, PRACTICE = "mock", "practice"
    SOURCE = [(MOCK, "Mock test"), (PRACTICE, "Practice")]

    student = models.ForeignKey(
        "tenancy.Student", on_delete=models.CASCADE, related_name="attempts"
    )
    topic = models.ForeignKey(
        "syllabus.Topic", on_delete=models.PROTECT, related_name="attempts"
    )
    test_paper = models.ForeignKey(
        "ingestion.TestPaper", null=True, blank=True,
        on_delete=models.PROTECT, related_name="attempts",
    )
    question_id = models.CharField(max_length=100)
    status = models.CharField(max_length=12, choices=STATUS)
    time_spent = models.IntegerField(null=True, blank=True)      # seconds; often absent
    marks = models.FloatField(default=0)                         # after negative marking
    source = models.CharField(max_length=10, choices=SOURCE, default=MOCK)
    ts = models.DateTimeField()

    ingest_batch = models.ForeignKey(
        "ingestion.IngestBatch", null=True, blank=True, on_delete=models.PROTECT
    )

    class Meta:
        indexes = [
            # The hot path — every feature-store query uses this.
            models.Index(fields=["student", "topic", "ts"], name="idx_attempt_stu_top_ts"),
            models.Index(fields=["institute", "ts"], name="idx_attempt_inst_ts"),

            # Mock analysis: one student, one paper (marks-lost attribution and
            # the per-question table). Without it Postgres enters on
            # test_paper_id and throws away everyone else's answers — measured
            # at 3,225 rows discarded to return 75, and that ratio grows
            # linearly with the size of the batch that sat the paper.
            # 0.064 ms / 4 buffers with this index, 0.510 ms / 55 without.
            models.Index(fields=["student", "test_paper"], name="idx_attempt_stu_paper"),

            # REMOVED: models.Index(fields=["test_paper"], name="idx_attempt_paper")
            # It was byte-for-byte identical to the index Django already
            # creates for the test_paper FK, so Postgres only ever used one of
            # them (pg_stat_user_indexes: 111 scans vs 0) while both were
            # maintained on every insert. Indexes on this table already weigh
            # 99% of the heap; a free duplicate is not affordable here.
        ]
        ordering = ["-ts"]

    def __str__(self) -> str:
        return f"{self.student.name} {self.question_id} {self.status}"

    @property
    def was_attempted(self) -> bool:
        return self.status in (self.CORRECT, self.WRONG)

    @property
    def is_correct(self) -> bool:
        return self.status == self.CORRECT


class StudyLog(tenancy.TenantScoped):
    """Self-reported study session. Tier-1 data — treat as unreliable.

    `logged_at` vs `ts` is deliberate: it reveals a student who entered a
    whole week's study on Sunday evening. That is one signal, not seven,
    and should be down-weighted.
    """

    LEARN, PRACTICE, REVISE = "learn", "practice", "revise"
    MODE = [(LEARN, "Learn"), (PRACTICE, "Practice"), (REVISE, "Revise")]

    student = models.ForeignKey(
        "tenancy.Student", on_delete=models.CASCADE, related_name="study_logs"
    )
    topic = models.ForeignKey(
        "syllabus.Topic", on_delete=models.PROTECT, related_name="study_logs"
    )
    minutes = models.IntegerField()
    mode = models.CharField(max_length=10, choices=MODE)
    ts = models.DateTimeField()                              # when they studied
    logged_at = models.DateTimeField(auto_now_add=True)      # when they told us

    class Meta:
        indexes = [models.Index(fields=["student", "topic", "ts"], name="idx_log_stu_top_ts")]
        ordering = ["-ts"]

    def __str__(self) -> str:
        return f"{self.student.name} {self.topic.name} {self.minutes}m"


class ConfidenceRating(tenancy.TenantScoped):
    """How strong the student *thinks* they are. Compared against measured
    mastery to detect overconfidence."""

    student = models.ForeignKey(
        "tenancy.Student", on_delete=models.CASCADE, related_name="confidence_ratings"
    )
    topic = models.ForeignKey(
        "syllabus.Topic", on_delete=models.PROTECT, related_name="confidence_ratings"
    )
    self_rating = models.IntegerField()                      # 1–5
    ts = models.DateTimeField()

    class Meta:
        indexes = [models.Index(fields=["student", "topic", "ts"], name="idx_conf_stu_top_ts")]
        ordering = ["-ts"]

    def __str__(self) -> str:
        return f"{self.student.name} {self.topic.name} {self.self_rating}/5"


class RevisionEvent(tenancy.TenantScoped):
    """A scheduled revision cycle and whether it actually happened."""

    student = models.ForeignKey(
        "tenancy.Student", on_delete=models.CASCADE, related_name="revision_events"
    )
    topic = models.ForeignKey(
        "syllabus.Topic", on_delete=models.PROTECT, related_name="revision_events"
    )
    cycle = models.IntegerField()                            # R1, R2, R3
    scheduled_for = models.DateField()
    done_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=["student", "scheduled_for"], name="idx_rev_stu_sched")]
        ordering = ["scheduled_for"]

    def __str__(self) -> str:
        state = "done" if self.done_at else "pending"
        return f"{self.student.name} {self.topic.name} R{self.cycle} ({state})"

    @property
    def is_overdue(self) -> bool:
        from django.utils import timezone

        return self.done_at is None and self.scheduled_for < timezone.localdate()


class ChapterStatus(tenancy.TenantScoped):
    """Where the *batch* is in the syllabus — taught by faculty, not by the student.

    Scoped to batch rather than student: it answers "has this chapter been
    covered in class yet", which gates whether a weak-topic flag is fair.
    """

    batch = models.ForeignKey(
        "tenancy.Batch", on_delete=models.CASCADE, related_name="chapter_statuses"
    )
    topic = models.ForeignKey(
        "syllabus.Topic", on_delete=models.PROTECT, related_name="chapter_statuses"
    )
    taught_at = models.DateField(null=True, blank=True)
    completed_at = models.DateField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["batch", "topic"], name="uniq_chapter_per_batch")
        ]
        verbose_name_plural = "chapter statuses"

    def __str__(self) -> str:
        return f"{self.batch.name} · {self.topic.name}"
