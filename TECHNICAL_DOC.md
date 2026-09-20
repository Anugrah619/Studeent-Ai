# Student AI — Technical Document

**Version 0.2 · 17 Sep 2026**
Companion diagrams: [`WORKFLOW.md`](WORKFLOW.md) · Detailed schema & system design: [`SYSTEM_DESIGN.md`](SYSTEM_DESIGN.md) · Running decisions: [`PROJECT_LOG.md`](PROJECT_LOG.md)

---

## What changed since v0.1

| # | Change | Consequence |
|---|---|---|
| 1 | **LLM is Gemini**, not Claude | Free tier is usable for a pilot but has a hard 500 requests/day ceiling and a privacy condition that forces PII stripping — see §11 |
| 2 | **Stack must be free or near-free** | Redis dropped in favour of a database-backed queue; hosting moved to permanently-free tiers; prototype is fully static |
| 3 | **Prototype is a frontend, not an app** | No backend, no database, no live model calls for the demo — see §12 |
| 4 | **Markdown, not published artifacts** | This document and `WORKFLOW.md` are the canonical reference. `architecture.html` and `build-plan.html` are superseded where they disagree |
| 5 | **Train-vs-prompt boundary made explicit** | Our own models decide; Gemini only describes — see §2.1 |
| 6 | **Data strategy added** | Four sources, volumes, processing pipeline, and the sequential-split trap — see §7 |

> The earlier HTML documents remain accurate on architecture and reasoning. Where they name Claude, Redis, or paid hosting, **this document wins**.

---

## 1 · Product summary

An AI-assisted student performance and preparation system for competitive-exam aspirants (JEE, NEET, CAT, GATE, UPSC, CUET). It runs **alongside** coaching institutes rather than replacing teachers or content.

Focus: preparation management, weakness tracking, revision intelligence, mock-test analytics, and data-grounded guidance.

Explicitly **not**: a doubt-solving chatbot, a lecture platform, a content library, or a generic AI tutor.

### The commercial fact that shapes everything

**The buyer is not the user.** The concept note is written student-facing, but the person who signs is the institute director. They care about retention, results, faculty time saved, and parent satisfaction — not about study plans.

Consequence: every demo opens on the **director's screen** (at-risk triage), never the student app.

---

## 2 · Core principle — the model narrates, it never computes

Every number a student, mentor, or director sees is produced by deterministic code reading the feature store. Gemini receives those computed facts as a structured payload and turns them into sentences. It has:

- no write path back into state
- no authority to produce a figure of its own
- no access to raw tables

**Why this matters more with a cheaper model, not less:**

1. **Explainability.** A director will eventually ask *"why did it flag this student?"* A system that answers with a rule and its evidence keeps the account.
2. **Reproducibility.** The same input always produces the same flag, whatever the model does on a given day.
3. **Cost.** Narration is cacheable. Identical state re-renders for free.
4. **Model independence.** If Gemini's free tier changes terms tomorrow, you swap one layer. The product still works — it just stops writing sentences.

See [`WORKFLOW.md` §2](WORKFLOW.md#2--the-trust-boundary--what-the-model-is-and-is-not-allowed-to-do).

### 2.1 What we train vs what we prompt

A recurring temptation is to let the LLM make the actual decisions — judge mastery, decide who is at risk, choose what to study. It is worth being precise about why that is the wrong architecture, because the instinct behind it (wanting real intelligence in the product) is correct.

**The arithmetic case.** One institute, 312 students, ~40 topics each:

| | LLM decides | Deterministic engine decides |
|---|---|---|
| Calls/day for mastery alone | ~12,480 | 0 |
| Gemini free tier allows | **500** | n/a |
| Cost at Flash-Lite | ~$90/month | **₹0** |
| Same input → same output? | No | Yes |
| Can you explain a flag to a director? | "The AI decided" | Rule + evidence values |
| Can you measure improvement? | No | AUC on held-out attempts |

You would be 25× over the free tier on your first customer, paying for the privilege, and getting a worse answer. *"Rolling accuracy over the last 20 attempts, time-decayed"* is a window function — arithmetic, not reasoning, and arithmetic over many data points is what language models are worst at.

**The strategic case, which matters more.** If Gemini makes the decisions, the product is a prompt — a competitor reproduces it in a weekend using the same Gemini. If your own models make the decisions, trained on accumulated student data, that is a moat which compounds with every month of operation.

**The division of labour:**

```
Your models   →  DECIDE     mastery · risk · what to revise · what to study
Gemini        →  DESCRIBE   turn those decisions into readable sentences
```

**What "our own model" means here.** Not a language model — training one costs millions and buys nothing. It means the prediction models in §6:

| Model | Predicts | Trained on |
|---|---|---|
| Knowledge tracing (BKT → IRT → DKT) | Will this student answer the next question on this topic correctly? | Your `attempts` |
| Retention / decay | Recall probability on exam day | Your `revision_events` |
| Risk | Will this student decline or disengage? | Your `flags` + outcomes |

Small, cheap to run, evaluable, and entirely yours.

**Where Gemini legitimately makes a decision.** Exactly one place: **question → topic mapping**. Reading question text and proposing "this is Coordination Compounds" is genuine language understanding, and it is the gate on all of P1. Note the shape — *LLM proposes, human confirms, result is stored permanently.* Never inferred at runtime.

**Why distillation does not apply here.** The pattern of using a large model to label data while training a small one is worth it when labels are expensive. Here they are free: every attempt already carries ground truth — the student got it right or wrong. The data labels itself as it arrives.

---

## 3 · System layers

| Layer | Responsibility | Contents |
|---|---|---|
| **L0** Sources | External data | Mock result files, roster, chapter completion, student app |
| **L1** Ingestion | Get it in cleanly | Parser, column mapper, identity resolver, question→topic tagger, validator |
| **L2** Canonical store | Append-only truth | `attempts`, `study_logs`, `confidence`, `revision_events`, `topics` |
| **L3** Feature store | Derived, rebuildable | `topic_state`, `student_state` |
| **L4** Engines | Deterministic computation | Mastery, retention, detectors, mock analyzer, planner |
| **L5** Insight objects | The contract | `risk_flag`, `weak_topic`, `marks_lost_attribution`, `plan_block` |
| **L6** Narration | Prose only | Context builder, PII stripper, Gemini, claim validator, cache |
| **L7** Surfaces | Presentation | Director dashboard, mentor console, student app, parent report |

**Cross-cutting:** auth/RBAC · multi-tenancy · job queue · audit trail · consent & retention.

Data moves strictly downward. No layer reaches past the one below it — which is what makes each independently testable and replaceable.

---

## 4 · Data model

> Summary only. Full table definitions, indexes, constraints and open design questions are in [`SYSTEM_DESIGN.md`](SYSTEM_DESIGN.md) §3.

### The spine

`Exam → Subject → Unit → Topic`, **versioned per institute**. Every event references a `topic_id`. An attempt not mapped to a topic is a number with no meaning.

Two coaching centres teaching the same exam split, sequence, and name chapters differently. A single global tree will not survive your second customer.

### Tables

**Tenancy & people**
```
institute (tenant root) → batch → student
                                → mentor (owns N students)
```

**Events — append-only, keyed `(student_id, topic_id, ts)`**

| Table | Key fields |
|---|---|
| `attempts` | `question_id`, `correct`, `time_spent`, `source` |
| `study_logs` | `minutes`, `mode: learn\|practice\|revise` |
| `confidence` | `self_rating 1-5`, `rated_at` |
| `revision_events` | `cycle`, `scheduled_for`, `done_at` |
| `chapter_status` | `taught_at`, `completed_at` |
| `question_topic_map` | **the gate** — `question_id → topic_id`, human-confirmed |

**Derived — recomputed, never hand-edited**

| Table | Contents |
|---|---|
| `topic_state` | `mastery`, `retention`, `exposure`, `last_seen`, `last_revised`, `accuracy_30` |
| `student_state` | `consistency`, `load_index`, `balance_index`, `revision_debt`, `risk_score` |
| `flags` | `type`, `severity`, `evidence[]`, `raised_at`, `resolved_at`, `rule_version` |
| `plan_blocks` | `date`, `topic`, `mode`, `minutes`, `reason_code` |

### Invariants

1. **Event tables are append-only.** Corrections arrive as new rows, never updates.
2. **Derived state is always rebuildable from events alone.** This lets you change the mastery model and replay history to see what it *would* have flagged — which is how you justify a model upgrade, and how you backfill a new detector without waiting weeks for data.
3. **Syllabus tree is versioned.** Historical events stay bound to the version current when recorded.

---

## 5 · Flows

All six flows are diagrammed in [`WORKFLOW.md`](WORKFLOW.md). Summary:

| Flow | What it does | Critical detail |
|---|---|---|
| **A** Ingestion | Mock file → insight | Step 5 (question→topic) is the gate; one-time cost per paper, stored permanently |
| **B** Planning | Four queues → day plan | Greedy scorer first; reason code on every block |
| **C** Risk loop | Detection → mentor → outcome | The return arrow is the product |
| **D** Narration | Insight → prose | PII stripped before the call; claims validated after |
| — Tier split | What works without student data | Tier 0 needs zero behaviour change |
| — Build order | Dependency DAG | P3 reachable without P4 |

---

## 6 · Engines

Each engine has a ladder of increasingly sophisticated implementations. **Ship the lowest rung, instrument it, and climb only when you can show the current rung failing on real data.**

### 6.1 Mastery — knowledge tracing

| Rung | Method | Needs | Buys you |
|---|---|---|---|
| **0** | Time-decayed rolling accuracy | ~10 attempts/topic | A working product. Ship this. |
| 1 | Bayesian Knowledge Tracing (`pyBKT`) | ~50 attempts/topic | Separates guessing from knowing |
| 2 | Elo / IRT (`py-irt`, or ~50 lines for Elo) | Cohort-wide data | Question difficulty for free |
| 3 | DKT / SAKT (PyTorch) | 100k+ attempts | Order effects, topic transfer |

Rung 0 is a **Postgres window function**, not a machine-learning library:
```sql
AVG(correct::int) OVER (
  PARTITION BY student_id, topic_id
  ORDER BY ts
  ROWS BETWEEN 19 PRECEDING AND CURRENT ROW
)
```

**Evaluate every rung identically:** hold out the next attempt, measure whether the model predicted it (AUC). A rung that does not beat the one below it does not ship, however sophisticated.

### 6.2 Retention — spaced repetition against a deadline

Standard SM-2 and FSRS optimise for *indefinite retention at minimum review cost*. Exam preparation has a different objective function:

> **Maximise recall probability on one specific date**, with the syllabus frozen and time strictly finite.

Practically: intervals compress as the exam approaches, and topics whose forecast recall on exam day is already sufficient get **deprioritised** in favour of ones that will have decayed by then.

There is no off-the-shelf implementation. Start from `py-fsrs` and expect to fork it. Budget research time, not install time.

### 6.3 Mock analyzer — marks-lost attribution

"You scored 134" is not actionable. "98 of your 166 lost marks needed no new learning" is.

Partition every lost mark by cause, inferred from time-per-question against the student's own baseline, correctness, and prior mastery:

| Cause | Signature |
|---|---|
| **Conceptual gap** | Wrong, and mastery on that topic was already low |
| **Execution error** | Wrong, but mastery high and time normal |
| **Time exhaustion** | Unattempted, clock ran out before reaching it |
| **Avoidable skip** | Unattempted despite demonstrated competence |

### 6.4 Detector catalogue

| Detector | Reads | Fires when | Tier |
|---|---|---|---|
| `weak_topic` | mastery, attempt count | Below floor with sufficient evidence | 0 |
| `over_attempting` | attempts vs accuracy curve | Negative marking exceeds gain | 0 |
| `plateau` | mastery slope across mocks | Flat despite exposure | 0 |
| `subject_imbalance` | time share vs marks-lost share | Gap exceeds threshold | 1 |
| `confidence_mismatch` | self-rating vs mastery | Rates strong, scores weak, repeatedly | 1 |
| `revision_overdue` | retention, days since revise | Below recall floor | 1 |
| `disengagement` | log frequency vs personal baseline | Drops sharply, stays down | 1 |
| `overload` | hours trend × accuracy trend | Hours rising, accuracy falling | 1 |

**Alert hygiene — without all three, mentors stop reading by week three:**

1. **Minimum evidence** — never fire on fewer than N observations
2. **Personal baseline** — compare a student to their own history, not the cohort
3. **Cooldown** — one flag per type per student per window

Plus: a flag never closed is a bug in the detector, not a stubborn student.

---

## 7 · Data strategy — where it comes from, how it's processed, how it's used

Models are only as good as what they train on, and this product needs a lot of data to learn patterns, strengths, weaknesses and lags. The good news: three of the four sources cost nothing, and the most valuable one arrives before you write a line of the model.

### 7.1 Four sources, in the order you get them

| # | Source | When | Volume | Cost |
|---|---|---|---|---|
| 1 | **Public research datasets** | Today, before any customer | 0.5M – 131M interactions | Free |
| 2 | **Pilot institute's historical files** | Week the pilot signs | ~1M attempts per institute | Free — you ask for it |
| 3 | **Live operation** | Continuously, from P1 | ~45k attempts/institute/month | Free — it's the product |
| 4 | **Synthetic** | For testing only | Unlimited | Free |

---

### 7.2 Source 1 — Public datasets (learn the modelling before you have users)

Knowledge tracing is an established academic field with standard public benchmarks. You can build and evaluate your models today, against published baselines, with no customers.

| Dataset | Domain | Approx size | Why it's useful here |
|---|---|---|---|
| **EdNet** (KAIST / Riiid) | TOEIC **test prep** | ~131M interactions, 780k students | **Closest match to your domain** — test prep, not K-12. Four nested levels of detail (KT1–KT4) |
| **Riiid AIEd Challenge** (Kaggle 2020) | EdNet-derived | ~100M rows | Public solutions and notebooks to learn from |
| **ASSISTments** (2009–2017) | US middle-school maths | ~0.5–1M per release | The classic KT benchmark — nearly every paper reports on it |
| **Junyi Academy** | Taiwanese maths | ~16M | Ships with a topic knowledge graph, like your syllabus tree |
| **Eedi** (NeurIPS 2020) | UK maths diagnostics | ~20M answers | Labels *which misconception* each wrong option represents |
| **KDD Cup 2010** | Algebra tutoring | ~9–20M steps | Older, still widely cited |

**What these give you:** working KT models, published baselines so you know whether your AUC is actually good, and a proper education in the field — all before your first customer.

**What they do not give you:** Indian competitive-exam structure (negative marking, JEE/NEET topic trees), study logs, or any behavioural signal. Public data teaches you the modelling. It does not give you the product.

> ⚠️ **Check the licence before commercial use.** Several of these are research-use or non-commercial licences. Prototyping and learning are fine; shipping a model trained on them inside a paid product may not be. Verify per dataset.

---

### 7.3 Source 2 — The pilot institute's history (your single best source)

This is the one most people miss, and it is the strongest argument for the Tier-0 strategy.

**Every coaching institute has years of mock test results sitting in spreadsheets.** They are not using them for anything beyond printing rank lists. You ask for them as part of the pilot.

**The volume, for one mid-size institute:**

```
300 students × 75 questions × 2 mocks/month × 24 months
= 1,080,000 attempts
```

That is **DKT-range data from a single institute, on day one of the pilot**, in your exact domain, with your exact exam structure — and it costs you nothing but the asking.

It also means your P3 demo runs on *their own students*, which is far more persuasive than any synthetic dataset.

> **Put data rights in the pilot agreement.** You need the written right to use anonymised data to improve the system. Retrofitting this later is close to impossible, and it is a normal, reasonable clause that nobody objects to when raised up front.

---

### 7.4 Source 3 — Live operation (the compounding moat)

Once running, each institute generates continuously:

| Institutes | Attempts/month | Attempts/year |
|---|---|---|
| 1 | 45,000 | 540,000 |
| 5 | 225,000 | 2.7M |
| 20 | 900,000 | 10.8M |

Tier-1 study logs are much lower volume — roughly 9,000/month per institute — and considerably less reliable, since students forget, log optimistically, and bulk-enter a week on Sunday. Weight them accordingly.

**This is the asset that compounds.** Every month of operation widens a gap a competitor cannot close by buying an API key.

---

### 7.5 Source 4 — Synthetic data (testing, never training)

Generate fake students with *known* parameters — student X has mastery 0.3 on Rotational Motion — then check whether your detector finds it.

**This validates the pipeline. It must never train a model.** A model trained on synthetic data learns your assumptions and nothing about students.

---

### 7.6 How much data each model actually needs

| Model | Minimum | Comfortable | Reachable when |
|---|---|---|---|
| Rolling accuracy (rung 0) | 10 attempts/topic | 20+ | Day 1 |
| BKT (rung 1) | ~50 attempts/topic | 200+ | First institute's history |
| Elo / IRT (rung 2) | 30+ attempts per *question* | 100+ | First institute's history |
| DKT / SAKT (rung 3) | ~100k interactions total | 1M+ | First institute's history, or public data |

Note that rows 2–4 are all reachable from **one pilot institute's back catalogue**. This is why §7.3 matters so much.

---

### 7.7 Processing — raw to training set

```
Raw files  →  Canonical events  →  Features  →  Training sets
  (P1)           (attempts)         (P2)         (model work)
```

1. **Ingest** — parse, map columns, resolve identity, map question→topic (Flow A)
2. **Canonicalise** — every institute's format becomes identical `attempts` rows
3. **Engineer features** — per `(student, topic, time)`: rolling accuracy, time-since-last-touch, attempt count, time-per-question vs personal baseline
4. **Construct training sets** — the step people get wrong

#### The split trap — read this twice

Knowledge tracing data is **sequential**. If you shuffle attempts randomly and split 80/20, you will train on a student's March attempt and test on their February attempt. The model has seen the future. Your AUC looks excellent and deployment fails.

**Split by time or by student, never randomly:**

| Split | Tests | Use for |
|---|---|---|
| **By time** — train before date D, test after | Real deployment conditions | The honest number. Report this one. |
| **By student** — train on 80% of students, test on unseen 20% | Generalisation to new students | Cold-start behaviour |

Use both. Quote the time-split number when you report to yourself.

**Standard formulation:**
- *Input:* a student's sequence of `(topic_id, correct)` up to time *t*
- *Predict:* will they answer the next question on topic X correctly?
- *Metric:* AUC on held-out next attempts

---

### 7.8 Data quality problems you will definitely hit

| Problem | Handling |
|---|---|
| Unmapped questions | The review queue (Flow A, step 5). Blocks everything until cleared |
| Students in one mock, gone the next | Sequence models need minimum-length filters |
| Duplicate imports | Idempotency keys on ingest — the same file twice must change nothing |
| A mock where everyone scored near zero | Technical failure, not knowledge. Detect and quarantine outlier papers |
| Topic imbalance | 500 attempts on Kinematics, 12 on Semiconductors. Never report a mastery estimate below the evidence floor |
| Cold-start students | See §16.2 — diagnostic test, imported history, or an explicit provisional mode |
| Bulk-logged study data | A week entered on Sunday is one signal, not seven. Detect and down-weight |

---

### 7.9 Three distinct uses for the data

**1 · Train the models** — the ladder in §6.1. Straightforward.

**2 · Tune detector thresholds — the underrated one.**

Right now a detector says *"flag if mastery < 0.4."* Where did 0.4 come from? You guessed.

Once you have outcome data, you can learn it. Take students who genuinely declined, look at what their mastery was four weeks earlier, and choose the threshold that maximises early detection minus false alarms. Same for every detector.

This converts your hand-tuned rules into calibrated ones, and it is the difference between a console mentors trust and one they mute.

**3 · Validate retrospectively.**

Replay an institute's history and ask: *would we have caught the students who actually failed?* This is the single most convincing number you can put in front of a director — and it is computable on their historical files **before** they have paid you anything.

---

### 7.10 Privacy, consent and contracts

| Concern | Position |
|---|---|
| **Minors** | Most users are under 18. Guardian consent, stated retention period, export and deletion paths |
| **DPDP Act** | India data residency; documented lawful basis for processing |
| **Model training rights** | Explicit clause in the pilot agreement. Ask up front — it is uncontroversial then, and near-impossible later |
| **Anonymisation for training** | Strip name, roll number, phone, DOB. Keep the behavioural signal — models need the pattern, never the identity |
| **Cross-institute training** | Institute A may object to its data improving a model that serves competitor B. Your answer: aggregated model weights, never raw data. Be ready for this conversation before it happens |
| **Gemini payloads** | Separate matter — see §11.2. PII never leaves your system |

---

## 8 · Tier 0 / Tier 1 — the data-entry answer

*"Who is actually going to enter all this data?"* is the question that kills ed-tech pilots. The architecture answers it structurally.

| | Tier 0 — institute already has | Tier 1 — needs student behaviour |
|---|---|---|
| **Inputs** | Mock files, roster, chapter completion | Daily study logs, confidence ratings |
| **Unlocks** | Marks-lost attribution, weak topics, at-risk triage, over-attempting, cohort analytics | Revision scheduling, daily planning, confidence mismatch, disengagement, overload |
| **Surface** | **Director + mentor console — the sellable wedge** | Student app — all adoption risk |
| **Behaviour change** | **Zero** | Substantial |

Tier 0 capabilities never read a study log. They can be built, demoed, and sold on files the institute already owns — so the pilot starts the week it is signed, and the student app arrives somewhere the system has already earned credibility.

**If student adoption is mediocre, the business still works.** That is the point.

---

## 9 · Tech stack — free or near-free

Everything below is free at the scale of a pilot. Costs are called out where they eventually appear.

### 9.1 Core

| Concern | Choice | Cost | Notes |
|---|---|---|---|
| Language | Python 3.12+ | Free | ML libraries are Python-native |
| Framework | **Django 5 + DRF** | Free | Admin gives you the review queue, tree editor, tenant management for free |
| Database | **PostgreSQL 16+** | Free | Window functions *are* the rung-0 feature store |
| Tenancy | Shared schema + `tenant_id` + RLS | Free | Enforced in the DB, not a manager someone forgets |
| Background jobs | **django-q2**, ORM broker | Free | **Replaces Celery + Redis entirely** — one less service, no Redis bill |
| Ingestion | pandas · openpyxl · rapidfuzz | Free | |
| Console UI | HTMX + Alpine.js (CDN) | Free | Server-rendered; no build step, no API layer |
| Charts | Chart.js or ECharts (CDN) | Free | |
| Student app | PWA (vanilla or Svelte) | Free | No app-store fee, no review delay |
| Errors | Sentry free tier | Free | 5k events/month |
| Object storage | Cloudflare R2 free tier | Free | 10 GB, no egress charges |

> **Why django-q2 over Celery:** Celery needs Redis, which needs either a paid instance or a free tier with a request ceiling. `django-q2` uses your existing Postgres as the broker and ships a scheduler. At pilot scale the performance difference is irrelevant and the operational saving is real. Swap to Celery + Redis if you outgrow it — the job interfaces are similar.

### 9.2 Hosting — the honest comparison

| Option | Free allowance | The catch |
|---|---|---|
| **Oracle Cloud Always Free** | 4 ARM cores, 24 GB RAM, permanent | Finicky signup; some regions reclaim idle instances. **Best free option by a wide margin** |
| Render free | 750 hrs/month | **Spins down after 15 min idle → 30–50 s cold start.** Fatal for a live demo |
| Fly.io | Limited allowance | Fine for small services |
| Supabase (Postgres) | 500 MB | **Pauses after 1 week inactivity** |
| Neon (Postgres) | 0.5 GB | Autosuspends, but resumes fast |
| **Netlify / Vercel / GitHub Pages** | Static hosting | **Never sleeps. Use this for the prototype** |

**Recommendation:**
- **Prototype now** → Netlify or GitHub Pages. Zero cost, zero cold start, zero risk.
- **Pilot backend later** → Oracle Always Free, or Render + a cron ping if you accept the cold start.
- **Local development** → Postgres in Docker. Free and fastest.

### 9.3 Costs that eventually appear

| Item | When | Approx |
|---|---|---|
| Domain name | Before the first demo | ~₹800/year |
| Gemini paid tier | Past ~500 students, or when PII matters | See §11 |
| Managed Postgres | When free-tier storage runs out | ~$0–25/month |
| WhatsApp Business API | P8, parent reports | Per-conversation, via Gupshup/AiSensy |

---

## 10 · Deployment topology

```
┌─────────────────── ONE MACHINE ───────────────────┐
│                                                   │
│  nginx ──→ Django/gunicorn ──┐                    │
│                              ├──→ PostgreSQL      │
│  django-q2 workers ──────────┘    (events,        │
│  (ingestion, nightly            features, RLS)    │
│   recompute, planning)                            │
│                                                   │
└───────────────────────┬───────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
   Gemini API    Cloudflare R2      Sentry
   (narration)   (files, PDFs)     (errors)
```

Two paths on one machine: the **synchronous path** serves pages, the **asynchronous path** does everything expensive. Splitting them from day one is what lets a single box carry the first fifty institutes.

**Not serverless:** ingestion runs for minutes and nightly recompute touches every student — both hostile to function timeouts and cold starts. **Not Kubernetes:** unjustifiable at this scale.

**Region:** India (`ap-south-1` / Mumbai equivalent). Most users are minors; DPDP data residency is a requirement an institute's lawyer will ask about, not a latency preference.

---

## 11 · LLM layer — Gemini

### 11.1 Free tier reality

| Fact | Detail |
|---|---|
| Pro models | **Not available on the free tier** since 1 Apr 2026 — Flash and Flash-Lite only |
| Gemini 2.5 Flash limits | 10 RPM · 250,000 TPM · **500 requests/day** |
| Gemini 3 Flash / 3.1 Flash-Lite | 10–15 RPM |
| Google Cloud $300 trial | **No longer applies to Gemini API** since Mar 2026 |
| Data usage | **Free-tier content may be used to improve Google products, including human review** |

### 11.2 The privacy problem, and the fix

Google's terms for non-paid services state that submitted content and generated responses may be used to develop Google products, that human reviewers may process that material, and that you should **not submit sensitive, confidential, or personal information**.

Your users are minors. Their academic performance data is exactly what those terms warn against sending.

**The fix costs nothing: strip PII before the call.**

The narration payload is already a bounded structured object, so removing identity is trivial:

```json
{
  "student_ref": "S-4471",
  "exam": "JEE Main",
  "weeks_to_exam": 34,
  "subjects": [
    {"name": "Physics",   "time_share_pct": 52, "marks_lost_share_pct": 29, "trend": "flat"},
    {"name": "Chemistry", "time_share_pct": 11, "marks_lost_share_pct": 46, "trend": "declining"},
    {"name": "Maths",     "time_share_pct": 37, "marks_lost_share_pct": 25, "trend": "flat"}
  ],
  "flags": [
    {"type": "subject_imbalance", "severity": "high",
     "evidence": {"time_share_pct": 11, "marks_lost_share_pct": 46}}
  ]
}
```

No name. No roll number. No phone, DOB, institute name, or mentor name. `S-4471` is an opaque local reference that means nothing outside your database.

**Re-identification happens locally, after generation.** The model never sees a real name.

Document this in your DPDP notice. It is also a genuinely good answer when a director asks what you send to Google.

### 11.3 Capacity — when the free tier runs out

500 requests/day ÷ 1 daily nudge per student = **~500 students maximum** on the free tier.

| Stage | Students | Free tier? |
|---|---|---|
| Prototype | 0 (pre-written text) | N/A — no calls at all |
| Pilot, one batch | ~40 | Comfortably yes |
| One full institute | ~300 | Yes, with headroom for weekly summaries |
| Two institutes | ~600 | **No — upgrade** |

### 11.4 Paid pricing, when you get there

| Model | Input /1M | Output /1M |
|---|---|---|
| Gemini 2.5 Flash-Lite | $0.10 | $0.40 |
| Gemini 3.5 Flash | $1.50 | $9.00 |

Daily nudge at ~1,500 input + ~200 output tokens:

| Config | 1,000 students | 10,000 students |
|---|---|---|
| Flash-Lite | ~$7/month | ~$69/month |
| Flash-Lite + batch (50% off) | ~$3.50/month | ~$35/month |
| Gemini 3.5 Flash | ~$122/month | ~$1,215/month |
| 3.5 Flash + batch | ~$61/month | ~$608/month |

**Recommendation:** narration from a structured payload is a constrained task — Flash-Lite is very likely sufficient. Validate on real payloads before assuming you need more. Reserve the larger model for weekly summaries and parent reports, where the writing carries more weight.

**Cost levers, in order:** context caching (up to 90% off input) → batch processing (50% off) → state-hash caching (unchanged state never regenerates) → model choice last.

### 11.5 Implementation notes

- **Claim validation is mandatory.** Extract every number and proper noun from the generated text and assert each appears in the payload. A string scan, not a second model call — costs nothing, prevents the one failure mode that would destroy trust.
- **Cache on a state hash.** If `topic_state` and `student_state` are unchanged, do not regenerate. This is the single largest cost lever and it is entirely in your control.
- **Degrade gracefully.** If the API is unavailable or rate-limited, surfaces fall back to insight objects rendered as structured text. The product must never be blocked on narration.
- **SDK:** `google-genai` (Python).

---

## 12 · The prototype

### 12.1 Scope

A **static frontend**. No backend, no database, no live model calls, no auth.

Its job is to make a director believe the system works — not to be the system.

### 12.2 Stack

| Piece | Choice | Cost |
|---|---|---|
| Markup | Plain HTML | Free |
| Styling | Plain CSS (no framework) | Free |
| Interactivity | Vanilla JS | Free |
| Charts | Chart.js from CDN | Free |
| Data | One hardcoded `data.js` | Free |
| Hosting | Netlify / GitHub Pages | Free |

### 12.3 File layout

```
prototype/
├── index.html          # 1. Director command center
├── student.html        # 2. Student 360
├── mock.html           # 3. Mock test intelligence
├── app.html            # 4. Student phone view
├── pilot.html          # 5. The pilot ask
└── assets/
    ├── style.css
    ├── data.js         # all demo data, one file
    └── charts.js
```

### 12.4 Do not call Gemini live in the demo

Three reasons, any one sufficient:

1. **An API key in client-side JavaScript is exposed** to anyone who opens devtools.
2. **Latency in front of a buyer** is dead air you cannot fill.
3. **A weird generation mid-pitch** costs you the room, and you cannot retry gracefully.

Pre-write the narration text into `data.js`. Demo reliability beats live-ness, every time.

### 12.5 Demo dataset — internally consistent seed

Credibility lives here. Fake data that looks fake kills the room; real chapter names and plausible score ranges make a director lean in.

**Institute:** Aarambh Classes, Kota · 312 students · 4 batches

**Hero student:** Aarav Mehta · JEE 2027 · Alpha batch · Target AIR < 5000 · Mentor: Dr. S. Bhatia

**Mock scores (each subject out of 100):**

| Mock | Physics | Chemistry | Maths | Total /300 |
|---|---|---|---|---|
| 8 | 62 | 41 | 68 | 171 |
| 9 | 58 | 38 | 64 | 160 |
| 10 | 65 | 34 | 66 | 165 |
| 11 | 61 | 31 | 60 | 152 |
| 12 | 57 | 28 | 63 | 148 |
| 13 | 54 | 26 | 58 | 138 |
| 14 | 52 | 24 | 58 | 134 |

Net: **−37 marks across 7 mocks.** Chemistry alone accounts for 17 of it.

**The neglect chart — the single most persuasive visual:**

| Subject | Share of study hours | Share of marks lost |
|---|---|---|
| Physics | 52% | 29% |
| Chemistry | **11%** | **46%** |
| Maths | 37% | 25% |

**Mock 14 marks-lost attribution** (166 lost of 300):

| Cause | Marks |
|---|---|
| Conceptual gap | 68 |
| Execution error | 38 |
| Time exhaustion | 34 |
| Avoidable skip | 26 |

> **The line that sells the product:** *"Only 68 of 166 lost marks were things he genuinely doesn't know. 98 are recoverable without learning anything new."*

**Mock 14 detail:** 75 questions · 66 attempted · 40 correct · 26 wrong · 9 blank · (40×4) − 26 = **134**

**Triage list for the director view** — include one recovered student; it proves the loop closes, which is what actually renews a contract:

| Student | Batch | Status | Signal |
|---|---|---|---|
| Aarav Mehta | Alpha | **Critical** | −37 marks over 7 mocks; Chemistry 11% of study time |
| Ishita Rao | Dropper | **Critical** | Hours up 31%, accuracy down 11 pts — overload signature |
| Md. Faizan Ali | Beta | Watch | Attendance fine, zero practice logs in 9 days |
| Kunal Deshpande | Alpha | Watch | Rates Rotational Motion 4/5; scores 31% on it |
| Tanvi Shah | Dropper | Watch | Attempts 82, needs 75 — over-attempting |
| Priya Nair | Beta | **Improving** | Flagged 3 weeks ago; Maths 44% → 67% after mentor contact |

---

## 13 · Build stages

Solo, full-time. Double the estimates if part-time.

| Stage | What | Weeks | Cumulative |
|---|---|---|---|
| **P0** | Syllabus tree, canonical schema, multi-tenant skeleton | 1–2 | 2 |
| **P1** | Roster + mock ingestion, column mapping, identity resolution, question→topic queue | 4–6 | 8 |
| **P2** | Feature store, rung-0 mastery, mock analyzer | 2–3 | 11 |
| **P3** | **Detectors, mentor console, director dashboard — FIRST SELLABLE** | 3–4 | **15** |
| **P4** | Student PWA, study logging | 3–4 | 19 |
| **P5** | Retention model, revision scheduler | 2–3 | 22 |
| **P6** | Daily planner | 2–3 | 25 |
| **P7** | Gemini narration layer | 2–3 | 28 |
| **P8** | Parent reports, cohort analytics, mastery rungs 1–2, partitioning | ongoing | — |

### Per-stage traps

| Stage | Trap |
|---|---|
| P0 | A single global syllabus tree. Version per institute or your second customer forces a rewrite. |
| P1 | Building OMR **scanning**. Institutes already have OMR vendors that export CSV. Build the importer. Saves a month. |
| P2 | Skipping the rebuild-from-events command. Without it you cannot safely change the mastery model later. |
| P3 | Firing flags on thin evidence. A console that cries wolf in week one is ignored by week three. |
| P4 | A log form that takes three minutes. Median capture must be under 40 seconds or you collect nothing. |
| P5 | Adopting FSRS unmodified. The objective function genuinely differs. |
| P6 | Rolling missed work forward indefinitely. A student who skips two days must not face a 14-hour plan — that's the uninstall moment. |
| P7 | Sending PII to the free tier. See §11.2. |

**The only date that matters is week 15.** Everything before it is unpaid build; everything after can be funded by and validated against a live pilot.

---

## 14 · Testing

Three test types carry this system:

| Type | What it does | Why it matters most here |
|---|---|---|
| **Ingestion golden files** | Real (anonymised) institute exports in → expected canonical events out | Every new institute is a new format. Your regression net against the messiest surface. |
| **Detector replay** | Known event stream in → assert a specific flag fires or does not | **Highest-value tests you will write.** A detector that silently stops firing is invisible until a customer asks why nobody was flagged. |
| **Rebuild equivalence** | Drop derived state, replay events, assert identical output | Proves the append-only invariant holds — what makes model upgrades and backfills safe. |

**Tooling:** `pytest` + `pytest-django` + `factory_boy` + `freezegun` (for decay and cooldown logic). All free.

Skip browser end-to-end tests until P4.

---

## 15 · What not to build

| Don't build | Why |
|---|---|
| **OMR sheet scanning** | Institutes have OMR vendors that export CSV. Import their output. Saves ~1 month, zero differentiation lost. |
| **Your own test platform** | You integrate with what they run. Replacing it makes you a competitor to their existing vendor and doubles the sale. |
| **Question banks / content** | Explicit positioning: not a content play. Commodity market, entrenched incumbents, ongoing production cost. |
| **Rank prediction** | Institutes have been burned by vendors selling confident numbers. **Refusing to predict rank is a credibility asset** — say so in the pitch. |
| **Native mobile apps** | Not before a PWA proves students will log at all. |
| **A feature-store product** (Feast etc.) | Your feature store is two Postgres tables and a nightly job. |
| **Kubernetes / microservices** | One machine carries the first fifty institutes. |
| **Deep learning early** | DKT needs six figures of attempts. You will have four. |

---

## 16 · Open problems

Listed honestly — each will consume more time than the feature it sits under.

1. **Question→topic mapping at scale.** Every new paper needs mapping before its results mean anything. Economics only work if it is done once per paper and reused, with LLM-proposed tags **confirmed by a human** rather than trusted.
2. **Cold start.** Weakness detection needs history; a new student has none. Week one must be useful anyway — diagnostic test, imported past mocks, or an explicit provisional mode that says *"still learning your pattern"* rather than inventing confidence.
3. **Self-reported data is unreliable.** Students forget, log optimistically, and bulk-log a week on Sunday. Degrade gracefully on sparse logs; cross-check against attempt data; never let a detector depend solely on self-reporting.
4. **Attribution.** Proving your intervention caused an improvement is genuinely hard — students improve on their own, coaching runs in parallel, everyone regresses to the mean. Staggered rollout across comparable batches is the only honest answer, and it must be **designed into the pilot up front**, not reconstructed after.
5. **Deadline-aware spaced repetition.** No library optimises for recall on a fixed future date with a frozen syllabus. Research-flavoured work.
6. **Institute syllabus divergence.** Per-institute versioned trees with a canonical mapping underneath.
7. **Gemini free-tier dependency.** Terms and limits have changed twice in 2026 (Pro removed from free tier in April; Cloud trial credit withdrawn in March). Keep the narration layer swappable — §2 is what makes that cheap.

---

## 17 · Immediate next step

**Stage 1 of the prototype plan: target and ask.**

Two things block the demo build:

1. **Who are you pitching?** A specific institute, or a generic first meeting? Size and exam mix change every number in `data.js`.
2. **What are you asking for at the end?** Recommended: a **free 6-week pilot with one batch** — not a sale. Low bar, gets you real data, and P3 makes it deliverable the week it is signed.

Once those are set, the build order is: demo dataset (§12.5, mostly done) → director view → student 360 → mock analysis → phone view → pilot page.
