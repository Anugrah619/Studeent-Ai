"""Derived state — everything here is DISPOSABLE.

Nothing in this app is ever hand-edited. All of it can be dropped and
rebuilt from the event log alone, which is what makes it safe to change
a model and replay history.

That rule is the reason this is a separate app: the folder boundary makes
"this is rebuildable" visible to anyone reading the code.
"""

from django.db import models

from apps.tenancy import models as tenancy


class TopicState(tenancy.TenantScoped):
    """Per (student, topic) rollup. Recomputed on event and nightly."""

    student = models.ForeignKey(
        "tenancy.Student", on_delete=models.CASCADE, related_name="topic_states"
    )
    topic = models.ForeignKey(
        "syllabus.Topic", on_delete=models.CASCADE, related_name="topic_states"
    )

    # Null below the evidence floor. We report nothing rather than a
    # confident-looking number derived from four attempts.
    mastery = models.FloatField(null=True, blank=True)        # 0–1
    retention = models.FloatField(null=True, blank=True)      # forecast recall

    attempts_n = models.IntegerField(default=0)
    correct_n = models.IntegerField(default=0)
    accuracy_30d = models.FloatField(null=True, blank=True)
    exposure_min = models.IntegerField(default=0)
    avg_time_spent = models.FloatField(null=True, blank=True)
    self_rating = models.IntegerField(null=True, blank=True)  # latest confidence

    last_seen = models.DateTimeField(null=True, blank=True)
    last_revised = models.DateTimeField(null=True, blank=True)
    computed_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["student", "topic"], name="uniq_topic_state")
        ]
        indexes = [
            models.Index(fields=["institute", "mastery"], name="idx_tstate_inst_mastery"),
            models.Index(fields=["student", "mastery"], name="idx_tstate_stu_mastery"),
        ]

    def __str__(self) -> str:
        m = "—" if self.mastery is None else f"{self.mastery:.2f}"
        return f"{self.student.name} · {self.topic.name} · {m}"

    @property
    def confidence_gap(self) -> float | None:
        """Self-rating minus measured mastery, both on 0–1.

        Positive means overconfident — rates it strong, scores weak.
        """
        if self.mastery is None or self.self_rating is None:
            return None
        return ((self.self_rating - 1) / 4.0) - self.mastery


class StudentState(tenancy.TenantScoped):
    """Per-student rollup across all topics."""

    student = models.OneToOneField(
        "tenancy.Student", on_delete=models.CASCADE, related_name="state"
    )

    consistency = models.FloatField(null=True, blank=True)     # 0–1, study regularity
    load_index = models.FloatField(null=True, blank=True)      # hours trend
    balance_index = models.FloatField(null=True, blank=True)   # time share vs marks-lost share
    revision_debt = models.IntegerField(default=0)             # topics overdue
    risk_score = models.FloatField(null=True, blank=True)      # 0–1

    mock_avg = models.FloatField(null=True, blank=True)
    mock_trend = models.FloatField(null=True, blank=True)      # marks gained/lost recently
    syllabus_pct = models.FloatField(null=True, blank=True)

    computed_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [models.Index(fields=["institute", "risk_score"], name="idx_sstate_inst_risk")]

    def __str__(self) -> str:
        return f"{self.student.name} state"


class Flag(tenancy.TenantScoped):
    """A detector's output — evidenced, versioned, and routable to a human.

    `evidence` holds whatever that detector measured, so a mentor can
    always be shown *why*. `rule_version` is what lets us answer that
    question six months later, after the rule has changed twice.
    """

    WATCH, HIGH, CRITICAL, IMPROVING = "watch", "high", "critical", "improving"
    SEVERITY = [
        (WATCH, "Watch"),
        (HIGH, "High"),
        (CRITICAL, "Critical"),
        (IMPROVING, "Improving"),
    ]

    RECOVERED, DECLINED, UNKNOWN = "recovered", "declined", "unknown"
    OUTCOME = [(RECOVERED, "Recovered"), (DECLINED, "Declined"), (UNKNOWN, "Unknown")]

    student = models.ForeignKey(
        "tenancy.Student", on_delete=models.CASCADE, related_name="flags"
    )
    topic = models.ForeignKey(
        "syllabus.Topic", null=True, blank=True, on_delete=models.SET_NULL
    )
    type = models.CharField(max_length=40)                 # weak_topic, overload, ...
    severity = models.CharField(max_length=10, choices=SEVERITY)
    headline = models.CharField(max_length=300)            # human-readable summary
    evidence = models.JSONField(default=dict)
    rule_version = models.CharField(max_length=20, default="v1")

    raised_at = models.DateTimeField()
    resolved_at = models.DateTimeField(null=True, blank=True)
    outcome = models.CharField(max_length=12, choices=OUTCOME, blank=True)

    class Meta:
        ordering = ["-raised_at"]
        indexes = [
            models.Index(
                fields=["institute", "resolved_at", "severity"], name="idx_flag_triage"
            ),
            models.Index(fields=["student", "type"], name="idx_flag_stu_type"),
        ]

    def __str__(self) -> str:
        return f"[{self.severity}] {self.student.name}: {self.type}"

    @property
    def is_open(self) -> bool:
        return self.resolved_at is None


class Intervention(models.Model):
    """What the mentor actually did. Closes the risk loop.

    Without this the system generates worry rather than outcomes — and
    these rows are also the training labels for the eventual risk model.
    """

    flag = models.ForeignKey(Flag, on_delete=models.CASCADE, related_name="interventions")
    mentor = models.ForeignKey("tenancy.Mentor", on_delete=models.PROTECT)
    action = models.TextField()
    taken_at = models.DateTimeField()

    class Meta:
        ordering = ["-taken_at"]

    def __str__(self) -> str:
        return f"{self.mentor.name} → {self.flag.student.name}"


class PlanBlock(tenancy.TenantScoped):
    """One slot in a student's day.

    `reason_code` is shown to the student. It is a retention feature, not
    a log line — unexplained plans get abandoned in week two.
    """

    student = models.ForeignKey(
        "tenancy.Student", on_delete=models.CASCADE, related_name="plan_blocks"
    )
    topic = models.ForeignKey("syllabus.Topic", on_delete=models.PROTECT)
    date = models.DateField()
    start_time = models.TimeField(null=True, blank=True)
    minutes = models.IntegerField()
    mode = models.CharField(max_length=10)                 # learn | practice | revise
    reason_code = models.CharField(max_length=40)          # weak_topic | revision_r2 | syllabus
    reason_text = models.CharField(max_length=200, blank=True)
    completed = models.BooleanField(default=False)

    class Meta:
        ordering = ["date", "start_time"]
        indexes = [models.Index(fields=["student", "date"], name="idx_plan_stu_date")]

    def __str__(self) -> str:
        return f"{self.student.name} {self.date} {self.topic.name}"
