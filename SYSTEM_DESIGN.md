# Student AI — System & Database Design

**For review.** Version 0.1 · 17 Sep 2026

> **If you're picking this up cold:** read §0, then §1 for the system shape, then §3 for the schema. §8 lists the decisions I'm least sure about — that's where review is most valuable.
>
> Background reading if you want it: [`TECHNICAL_DOC.md`](TECHNICAL_DOC.md) (full spec, product reasoning, costs) and [`WORKFLOW.md`](WORKFLOW.md) (diagrams). This document is the detailed design those two summarise.

---

## 0 · What this system is, in one page

An analytics platform for competitive-exam coaching institutes (JEE, NEET, etc.). It ingests mock-test results the institute already has, computes per-student per-topic mastery, detects students who are in trouble, and tells a mentor who to talk to and why.

**Three properties drive every design decision below:**

1. **It is an event-sourcing + analytics system, not a CRUD app.** The interesting work is deriving state from an append-only event log, not editing rows.
2. **It is multi-tenant.** Multiple competing coaching institutes share one deployment and must never see each other's data.
3. **The LLM does not compute anything.** All intelligence is deterministic code. A language model only converts computed results into prose. This is why explainability and reproducibility are achievable at all.

**Scale we are designing for:** 20 institutes × ~300 students. Roughly 20M rows in the largest table over two years. This is *not* a big-data problem — it comfortably fits one Postgres instance. Please push back if you think I'm under- or over-designing for this.

---

## 1 · System design

### 1.1 Layers

Data flows strictly in one direction. No layer reaches past the one below it.

```
L0  Sources          mock files · roster · chapter completion · student app
L1  Ingestion        parse → map columns → resolve identity → map topic → validate
L2  Canonical store  append-only event tables
L3  Feature store    derived per-(student,topic) and per-student state
L4  Engines          mastery · retention · detectors · mock analyzer · planner
L5  Insight objects  typed, evidenced results  ← the contract
L6  Narration        Gemini, prose only
L7  Surfaces         director dashboard · mentor console · student PWA · parent report
```

**L5 is the seam.** Above it, everything is arithmetic on stored events. Below it, everything is presentation. Surfaces read insight objects *directly* — narration is an enhancement, not a dependency. If the LLM is unavailable, the product still works; it just stops writing sentences.

### 1.2 Two request paths on one machine

```
SYNC   nginx → gunicorn/Django → Postgres          (page loads, must be fast)
ASYNC  django-q2 workers → Postgres                (ingestion, nightly recompute, planning)
```

Everything expensive is async. Ingestion runs for minutes; nightly recompute touches every student. Neither belongs in a request cycle.

**Why not serverless:** both async workloads are hostile to function timeouts and cold starts.
**Why not Kubernetes:** one machine carries the target scale. Distributed-systems problems aren't the ones we have.

### 1.3 Recompute strategy

Derived state updates on two triggers:

| Trigger | Scope | When |
|---|---|---|
| **On-event** | Only the affected `(student, topic)` rows | After an ingest or a study log |
| **Nightly** | Everything | Scheduled, idempotent |

Both must be **idempotent** — running twice produces the same result — and the full nightly pass must be able to rebuild all derived state from events alone.

### 1.4 Component choices

| Concern | Choice | Reasoning |
|---|---|---|
| Language | Python 3.12 | ML libraries (pyBKT, py-irt, FSRS) are Python-native |
| Framework | Django 5 + DRF | Admin gives us the mapping review queue, syllabus editor and tenant management for free — these are a large fraction of the product's internal tooling |
| Database | PostgreSQL 16 | Window functions, JSONB, RLS, partitioning. All four are load-bearing |
| Jobs | django-q2, ORM broker | Uses existing Postgres — no Redis service, no Redis bill |
| Console | HTMX + Alpine | Server-rendered tables and drill-downs; no separate API layer to maintain |
| LLM | Gemini (Flash / Flash-Lite) | Narration only |

---

## 2 · Multi-tenancy

### 2.1 The choice

| Approach | Isolation | Verdict |
|---|---|---|
| Database per institute | Perfect | Ops burden from customer #1 |
| Schema per institute | Strong | Migration pain around customer #20 |
| **Shared tables + `institute_id` + RLS** | Strong if enforced in DB | ✅ Chosen |

### 2.2 Enforcement

Every tenant-scoped table carries `institute_id`. Isolation is enforced by **PostgreSQL Row-Level Security**, not application code:

```sql
ALTER TABLE attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON attempts
  USING (institute_id = current_setting('app.institute_id')::bigint);
```

Django middleware sets `app.institute_id` per request from the authenticated user.

**Why RLS rather than filtering in Python:** if isolation lives in application code, a single forgotten `.filter(institute=...)` in one view leaks a competitor's students. That is a business-ending bug. With RLS, forgetting returns zero rows instead of the wrong rows.

> **Open question (see §8):** should we *also* enforce via a default Django manager, as belt-and-braces? It duplicates the rule, but makes the intent visible in code where developers actually look.

---

## 3 · Database schema

Written as Django models because that's what we'll build. Postgres-specific pieces are shown as raw SQL.

### 3.1 Tenancy and people

```python
class Institute(models.Model):
    name       = models.CharField(max_length=200)
    city       = models.CharField(max_length=100)
    created_at = models.DateTimeField(auto_now_add=True)

class Mentor(models.Model):
    institute = models.ForeignKey(Institute, on_delete=models.CASCADE)
    user      = models.OneToOneField("User", on_delete=models.CASCADE)
    name      = models.CharField(max_length=200)

class Batch(models.Model):
    institute = models.ForeignKey(Institute, on_delete=models.CASCADE)
    name      = models.CharField(max_length=100)          # "Alpha", "Dropper"
    exam      = models.ForeignKey("Exam", on_delete=models.PROTECT)
    year      = models.IntegerField()                     # target exam year

class Student(models.Model):
    institute = models.ForeignKey(Institute, on_delete=models.CASCADE)
    batch     = models.ForeignKey(Batch, on_delete=models.PROTECT)
    roll_no   = models.CharField(max_length=50)
    name      = models.CharField(max_length=200)
    mentor    = models.ForeignKey(Mentor, null=True, on_delete=models.SET_NULL)
    user      = models.OneToOneField("User", null=True, blank=True,
                                     on_delete=models.SET_NULL)
    target    = models.CharField(max_length=100, blank=True)   # "AIR < 5000"
    joined_at = models.DateField()
    exited_at = models.DateField(null=True, blank=True)        # dropout label

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["institute", "batch", "roll_no"],
                                    name="uniq_roll_per_batch")
        ]
```

**Two things worth noticing:**

`Student.user` is **nullable**, and `Student` is deliberately *not* a subclass of `User`. In the Tier-0 sales model the institute uploads marks and the student never logs in — they have no account. A login is attached later, only if they onboard onto the app. Had we made `Student` a `User` subclass, every student would need an account before we could store a single mark, which would break the entire go-to-market.

`Student.exited_at` is our **dropout label** — supervised-learning ground truth for the risk model. Cheap to capture, impossible to reconstruct later.

### 3.2 Syllabus tree — versioned per institute

```python
class Exam(models.Model):
    code = models.CharField(max_length=32, unique=True)    # "JEE_MAIN"
    name = models.CharField(max_length=100)

class SyllabusVersion(models.Model):
    institute  = models.ForeignKey(Institute, on_delete=models.CASCADE)
    exam       = models.ForeignKey(Exam, on_delete=models.CASCADE)
    version    = models.IntegerField()
    is_active  = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["institute", "exam", "version"],
                                    name="uniq_syllabus_version")
        ]

class Topic(models.Model):
    KIND = [("subject", "Subject"), ("unit", "Unit"), ("topic", "Topic")]

    syllabus = models.ForeignKey(SyllabusVersion, on_delete=models.CASCADE)
    parent   = models.ForeignKey("self", null=True, blank=True,
                                 on_delete=models.CASCADE, related_name="children")
    name     = models.CharField(max_length=200)
    kind     = models.CharField(max_length=10, choices=KIND)
    weight   = models.FloatField(default=1.0)   # typical marks in this exam
    position = models.IntegerField(default=0)   # teaching order

    class Meta:
        indexes = [models.Index(fields=["syllabus", "parent"])]
```

**Why versioned per institute:** two Kota institutes teaching the same exam split, name and sequence chapters differently. A single global tree does not survive the second customer. When an institute reorganises, we create version *n+1*; historical events stay bound to version *n*, so last year's analytics keep working.

`weight` feeds the planner — Rotational Motion is worth more JEE marks than Units & Dimensions, so it should be prioritised when time is short.

### 3.3 Event tables — append-only

**The invariant: events are never `UPDATE`d or `DELETE`d.** A correction arrives as a new row. This is what lets us change the mastery model in month 6 and replay two years of history to see what the new model *would* have flagged.

```python
class Attempt(models.Model):
    institute   = models.ForeignKey(Institute, on_delete=models.CASCADE)
    student     = models.ForeignKey(Student, on_delete=models.CASCADE)
    topic       = models.ForeignKey(Topic, on_delete=models.PROTECT)
    test_paper  = models.ForeignKey("TestPaper", null=True, on_delete=models.PROTECT)
    question_id = models.CharField(max_length=100)
    correct     = models.BooleanField(null=True)   # null = not attempted
    time_spent  = models.IntegerField(null=True)   # seconds; often absent
    source      = models.CharField(max_length=20)  # mock | practice
    ts          = models.DateTimeField()
    ingest_batch = models.ForeignKey("IngestBatch", on_delete=models.PROTECT)

    class Meta:
        indexes = [
            models.Index(fields=["student", "topic", "ts"]),   # the hot path
            models.Index(fields=["institute", "ts"]),
            models.Index(fields=["test_paper"]),
        ]
```

`(student, topic, ts)` is the index every feature-store query uses. It exists from day one.

```python
class StudyLog(models.Model):
    MODE = [("learn", "Learn"), ("practice", "Practice"), ("revise", "Revise")]
    institute = models.ForeignKey(Institute, on_delete=models.CASCADE)
    student   = models.ForeignKey(Student, on_delete=models.CASCADE)
    topic     = models.ForeignKey(Topic, on_delete=models.PROTECT)
    minutes   = models.IntegerField()
    mode      = models.CharField(max_length=10, choices=MODE)
    ts        = models.DateTimeField()
    logged_at = models.DateTimeField(auto_now_add=True)   # detect bulk-logging

class ConfidenceRating(models.Model):
    institute   = models.ForeignKey(Institute, on_delete=models.CASCADE)
    student     = models.ForeignKey(Student, on_delete=models.CASCADE)
    topic       = models.ForeignKey(Topic, on_delete=models.PROTECT)
    self_rating = models.IntegerField()   # 1–5
    ts          = models.DateTimeField()

class RevisionEvent(models.Model):
    institute     = models.ForeignKey(Institute, on_delete=models.CASCADE)
    student       = models.ForeignKey(Student, on_delete=models.CASCADE)
    topic         = models.ForeignKey(Topic, on_delete=models.PROTECT)
    cycle         = models.IntegerField()          # R1, R2, R3
    scheduled_for = models.DateField()
    done_at       = models.DateTimeField(null=True)

class ChapterStatus(models.Model):
    institute    = models.ForeignKey(Institute, on_delete=models.CASCADE)
    batch        = models.ForeignKey(Batch, on_delete=models.CASCADE)
    topic        = models.ForeignKey(Topic, on_delete=models.PROTECT)
    taught_at    = models.DateField(null=True)
    completed_at = models.DateField(null=True)
```

`StudyLog.logged_at` vs `ts` is deliberate: it lets us detect a student who entered a week's worth of study on Sunday evening. That's one signal, not seven, and should be down-weighted.

### 3.4 Ingestion support

```python
class IngestBatch(models.Model):
    """One uploaded file. Everything it produced can be traced back or rolled back."""
    institute    = models.ForeignKey(Institute, on_delete=models.CASCADE)
    filename     = models.CharField(max_length=500)
    file_hash    = models.CharField(max_length=64)   # idempotency
    row_count    = models.IntegerField(default=0)
    status       = models.CharField(max_length=20)   # pending|done|failed
    raw_snapshot = models.JSONField(null=True)       # for replay
    created_at   = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["institute", "file_hash"],
                                    name="uniq_file_per_institute")
        ]

class ColumnMappingProfile(models.Model):
    """How this institute's spreadsheets map onto our canonical fields."""
    institute = models.ForeignKey(Institute, on_delete=models.CASCADE)
    name      = models.CharField(max_length=100)
    mapping   = models.JSONField()   # {"Roll No": "roll_no", "Q1": "q_1", ...}

class TestPaper(models.Model):
    institute  = models.ForeignKey(Institute, on_delete=models.CASCADE)
    name       = models.CharField(max_length=200)     # "Mock 14"
    exam       = models.ForeignKey(Exam, on_delete=models.PROTECT)
    held_on    = models.DateField()
    max_marks  = models.IntegerField()
    marks_correct = models.IntegerField(default=4)
    marks_wrong   = models.IntegerField(default=-1)   # negative marking

class QuestionTopicMap(models.Model):
    """THE GATE. Nothing downstream works without this."""
    institute    = models.ForeignKey(Institute, on_delete=models.CASCADE)
    test_paper   = models.ForeignKey(TestPaper, on_delete=models.CASCADE)
    question_id  = models.CharField(max_length=100)
    topic        = models.ForeignKey(Topic, null=True, on_delete=models.PROTECT)
    proposed_by  = models.CharField(max_length=20, blank=True)   # "llm" | "blueprint"
    confirmed_by = models.ForeignKey("User", null=True, on_delete=models.SET_NULL)
    confirmed_at = models.DateTimeField(null=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["test_paper", "question_id"],
                                    name="uniq_question_per_paper")
        ]
```

`IngestBatch.file_hash` gives us idempotency — the same file uploaded twice must not double every attempt. `raw_snapshot` keeps the original rows so we can replay an ingest after fixing a parser bug.

`QuestionTopicMap.topic` is nullable: an unmapped question sits in the review queue until a human confirms it. Mapping is a one-time cost per paper that pays out on every future student who sits it.

### 3.5 Derived state — disposable by design

Everything here can be dropped and rebuilt from events. Keep it in a separate Django app (`derived/`) so that's obvious.

```python
class TopicState(models.Model):
    institute     = models.ForeignKey(Institute, on_delete=models.CASCADE)
    student       = models.ForeignKey(Student, on_delete=models.CASCADE)
    topic         = models.ForeignKey(Topic, on_delete=models.CASCADE)
    mastery       = models.FloatField(null=True)   # 0–1, null = insufficient evidence
    retention     = models.FloatField(null=True)   # forecast recall probability
    attempts_n    = models.IntegerField(default=0)
    accuracy_30d  = models.FloatField(null=True)
    exposure_min  = models.IntegerField(default=0)
    last_seen     = models.DateTimeField(null=True)
    last_revised  = models.DateTimeField(null=True)
    computed_at   = models.DateTimeField()

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["student", "topic"],
                                    name="uniq_topic_state")
        ]

class StudentState(models.Model):
    institute      = models.ForeignKey(Institute, on_delete=models.CASCADE)
    student        = models.OneToOneField(Student, on_delete=models.CASCADE)
    consistency    = models.FloatField(null=True)
    load_index     = models.FloatField(null=True)   # study-hours trend
    balance_index  = models.FloatField(null=True)   # time share vs marks-lost share
    revision_debt  = models.IntegerField(default=0)
    risk_score     = models.FloatField(null=True)
    computed_at    = models.DateTimeField()

class Flag(models.Model):
    institute    = models.ForeignKey(Institute, on_delete=models.CASCADE)
    student      = models.ForeignKey(Student, on_delete=models.CASCADE)
    type         = models.CharField(max_length=40)   # weak_topic, overload, ...
    severity     = models.CharField(max_length=10)   # watch | high | critical
    evidence     = models.JSONField()                # varies per detector
    rule_version = models.CharField(max_length=20)   # auditability
    raised_at    = models.DateTimeField()
    resolved_at  = models.DateTimeField(null=True)
    outcome      = models.CharField(max_length=20, blank=True)  # recovered|declined|unknown

    class Meta:
        indexes = [models.Index(fields=["institute", "resolved_at", "severity"])]

class Intervention(models.Model):
    flag      = models.ForeignKey(Flag, on_delete=models.CASCADE)
    mentor    = models.ForeignKey(Mentor, on_delete=models.PROTECT)
    action    = models.TextField()
    taken_at  = models.DateTimeField()

class PlanBlock(models.Model):
    institute   = models.ForeignKey(Institute, on_delete=models.CASCADE)
    student     = models.ForeignKey(Student, on_delete=models.CASCADE)
    topic       = models.ForeignKey(Topic, on_delete=models.PROTECT)
    date        = models.DateField()
    minutes     = models.IntegerField()
    mode        = models.CharField(max_length=10)
    reason_code = models.CharField(max_length=40)   # shown to the student
    completed   = models.BooleanField(default=False)
```

`TopicState.mastery` is **nullable** — below the evidence floor we report nothing rather than a confident-looking number derived from four attempts.

`Flag.rule_version` is what lets us answer *"why was this student flagged?"* six months later, after the rule has changed twice.

`Flag.outcome` + `Intervention` close the loop. They're also the training labels for the eventual risk model.

### 3.6 Indexes and partitioning

```sql
-- the hot path, on every feature-store query
CREATE INDEX idx_attempt_student_topic_ts ON attempts (student_id, topic_id, ts DESC);

-- console: open flags by severity for one institute
CREATE INDEX idx_flag_open ON flags (institute_id, severity)
  WHERE resolved_at IS NULL;

-- attempts is the only table that will need partitioning
-- partition by month once it passes ~10M rows
```

**Volume estimate:** 300 students × 75 questions × 2 mocks/month = 45k attempts per institute per month. At 20 institutes over 2 years ≈ **21.6M rows**. Everything else is orders of magnitude smaller — `TopicState` is roughly students × topics, so ~36k rows per institute, refreshed rather than accumulated.

---

## 4 · Rung-0 mastery is SQL, not ML

Worth stating explicitly because it surprises people. The first mastery implementation is a window function:

```sql
SELECT
  student_id,
  topic_id,
  AVG(correct::int) OVER (
    PARTITION BY student_id, topic_id
    ORDER BY ts
    ROWS BETWEEN 19 PRECEDING AND CURRENT ROW
  ) AS rolling_accuracy
FROM attempts
WHERE correct IS NOT NULL;
```

Time-decay weighting goes on top. No ML library, no training, works from the first ten attempts.

Rungs 1–3 (BKT → Elo/IRT → DKT) come later, and only when a held-out AUC comparison shows the current rung failing. See `TECHNICAL_DOC.md` §6.1.

---

## 5 · Data flow — ingestion in detail

The stage most likely to be underestimated. Nine steps:

```
1. Upload file              → IngestBatch created, file_hash checked for duplicates
2. Parse                    → sniff xlsx/csv, stream rather than load whole sheet
3. Apply column mapping     → ColumnMappingProfile for this institute
4. Resolve student          → roll_no exact → name fuzzy (rapidfuzz) → human queue
5. Map question to topic    → QuestionTopicMap; unmapped rows block here  ★ THE GATE
6. Emit attempts            → append-only, tagged with ingest_batch
7. Update features          → TopicState, StudentState for affected rows only
8. Run analyzers            → marks-lost attribution, detectors
9. Emit insight objects     → Flags surface on the console
```

**Why step 5 is the gate:** an attempt not mapped to a topic is a number with no meaning. Everything downstream — mastery, weakness, planning — is per-topic.

**Mapping strategy, cheapest first:**
1. Institute already tags questions by chapter → import directly
2. A paper blueprint exists → map by question number
3. LLM reads question text and proposes a topic → **human confirms once** → stored permanently

Never infer a mapping at runtime.

---

## 6 · Security and compliance

| Concern | Design |
|---|---|
| Tenant isolation | Postgres RLS, enforced in DB (§2.2) |
| Roles | student · mentor · director · admin. Mentors scoped to assigned students only |
| Minors | Most users under 18. Guardian consent, stated retention, export + deletion paths |
| Data residency | India region — DPDP requirement, not a latency preference |
| LLM payloads | **PII stripped before every call.** Opaque `student_ref`, topic names, numbers only. Re-identified locally after generation |
| Audit | Every flag stores `rule_version` + the evidence values that triggered it |

---

## 7 · What is deliberately not designed yet

Flagging these so you don't assume they were forgotten:

- **Caching layer.** Not needed at target scale. Postgres + sensible indexes should carry it.
- **Read replica.** Deferred until analytics queries actually contend with writes.
- **Search.** No full-text requirement yet.
- **Real-time anything.** Nightly recompute plus on-event updates is sufficient; nothing here needs websockets.
- **Attempts partitioning.** Designed for, not implemented — see §3.6.
- **Model serving infrastructure.** Rung-0 runs in-process. Revisit at rung 2+.

---

## 8 · Open questions — where review helps most

These are the calls I'm least confident about. Opinions genuinely wanted.

**1 · Syllabus tree storage.** Adjacency list (`parent_id`) as written, or Postgres `ltree`? Adjacency is simpler but "all topics under Physics" needs a recursive CTE. How hot will subtree queries actually be?

**2 · `TopicState`: table or materialized view?** A table gives control over incremental updates. A matview is simpler but refreshes wholesale. Leaning table — is that right?

**3 · RLS plus a default manager, or RLS alone?** Duplicating the rule in a Django manager makes the intent visible where developers read, but two sources of truth for isolation could itself become a bug.

**4 · Partition `attempts` by month, by institute, or both?** Month matches query patterns (recent data is hot). Institute matches tenancy. Composite feels over-engineered at 20M rows.

**5 · `Attempt.correct` nullable vs. an explicit status enum.** Currently `null` means "not attempted". An enum (`correct | wrong | blank | not_reached`) would distinguish *ran out of time* from *chose to skip* — which the mock analyzer genuinely wants. Worth the extra column?

**6 · Syllabus versioning granularity.** Copy the whole tree on any change (simple, wasteful), or version individual nodes (efficient, much harder to reason about)?

**7 · Should `QuestionTopicMap` be per-paper or global per institute?** Per-paper as written. But the same question often recurs across papers — is a content-hash-based global map worth it?

**8 · Am I under-designing?** Target is 20 institutes / 6,000 students / ~20M rows. I've deliberately chosen one Postgres, one machine, no cache, no queue service. Tell me if you think that breaks earlier than I expect.

---

## 9 · Build order

The dependency graph is close to forced:

| Stage | Builds | Weeks |
|---|---|---|
| **P0** | Schema, syllabus tree, tenancy, RLS | 1–2 |
| **P1** | Ingestion, column mapping, identity resolution, mapping queue | 4–6 |
| **P2** | Feature store, rung-0 mastery, mock analyzer | 2–3 |
| **P3** | Detectors, mentor console, director dashboard — **first sellable** | 3–4 |
| P4 | Student PWA, study logging | 3–4 |
| P5 | Retention model, revision scheduler | 2–3 |
| P6 | Daily planner | 2–3 |
| P7 | Gemini narration | 2–3 |
| P8 | Parent reports, cohort analytics, mastery rungs 1–2 | ongoing |

P3 is reachable without P4 — that's deliberate. It needs zero student behaviour change, so it's demonstrable on an institute's historical files before anyone installs anything.

---

## 10 · How to review this

Most useful, in order:

1. **§8** — the open questions. That's where a second opinion changes the design.
2. **§3** — the schema. Missing constraints? Wrong nullability? An index that won't be used, or one that's missing?
3. **§2** — tenancy. This is the one where a mistake is unrecoverable. Is RLS-only enough?
4. **§5** — ingestion. Have I missed a failure mode? This stage is where real-world mess lives.

Things that are **not** open for review here (already decided, reasoning in `TECHNICAL_DOC.md`): Python/Django/Postgres, Gemini as the narration model, the LLM-never-computes boundary, and the Tier-0-before-student-app sequencing.
