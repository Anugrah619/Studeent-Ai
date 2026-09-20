# Student AI — Task Tracker

**Forward-looking.** What to do next, with checkboxes.
For *why* decisions were made, see [`PROJECT_LOG.md`](PROJECT_LOG.md) (backward-looking).

Last updated: 20 Sep 2026

---

## ⚠️ Three separate tracks — don't conflate them

This is the most common source of confusion, so it goes first.

| Track | What it is | Status | Where it lives |
|---|---|---|---|
| **A · Backend build** | The real product. Django + Postgres, stages P0→P8 | 🟡 P0 day 1 of 7 | `app/` |
| **B · Demo prototype** | Static HTML/CSS/JS pitch deck with hardcoded data. **Not connected to the backend at all** | 🔴 not started | `prototype/` (doesn't exist yet) |
| **C · Data acquisition** | Institute outreach, syllabus download, public datasets | 🔴 not started | — |

**The "dashboard" exists in Track B, not Track A.** Track B is a fake frontend you show coaching directors — it never touches the database. Track A is the real system, which will have its own console much later (P3).

Track C has the longest lead time and should be started in parallel with anything.

---

## 📍 Current state — 20 Sep 2026

### What actually exists

```
✅ Django 6.1.1 project scaffolded at app/
✅ 5 empty apps: syllabus, tenancy, events, ingestion, derived
✅ PostgreSQL 16 in Docker, port 5434, healthy
✅ Custom User model locked in before first migration (table: auth_user_custom)
✅ Git repo initialised, .env gitignored
✅ Dev superuser: admin / devadmin123
```

### What does NOT exist

```
❌ Every model except User — no Institute, Topic, Student, Attempt, anything
❌ Any admin registration
❌ Any view, template, URL (besides /admin/)
❌ Any seed data — database contains 1 user row and nothing else
❌ Any frontend, dashboard, or prototype
❌ Any real or mock student data
```

**Honest summary: the project is scaffolded, not started.** Nothing is usable yet.

---

## 🎯 Track A — Backend build

### Stage P0 — Schema & syllabus tree · **1 / 7 days**

- [x] **Day 1 — Scaffold**
  - [x] venv, Django 6.1.1, psycopg 3.3.6, django-environ
  - [x] `config/` + 5 apps with explicit `name`/`label`
  - [x] Postgres 16 container (port 5434 — 5432 and 5433 were taken)
  - [x] **Custom `User` before first migration** ← the one that mattered
  - [x] git init, `.gitignore`, dev superuser

- [ ] **Day 2 — Syllabus models** ← NEXT
  - [ ] `Exam` (code, name)
  - [ ] `SyllabusVersion` (institute, exam, version, is_active)
  - [ ] `Topic` (self-FK parent, name, kind, weight, position)
  - [ ] Migrate, verify tables

- [ ] **Day 3 — Tenancy models**
  - [ ] `Institute`, `Mentor`, `Batch`, `Student`
  - [ ] `Student.user` nullable; `Student.exited_at` (dropout label)
  - [ ] `unique_together` on (institute, batch, roll_no)
  - [ ] Migrate

- [ ] **Day 4 — Event / ingestion / derived models**
  - [ ] events: `Attempt`, `StudyLog`, `ConfidenceRating`, `RevisionEvent`, `ChapterStatus`
  - [ ] ingestion: `TestPaper`, `IngestBatch`, `ColumnMappingProfile`, `QuestionTopicMap`
  - [ ] derived: `TopicState`, `StudentState`, `Flag`, `Intervention`, `PlanBlock`
  - [ ] Indexes — especially `(student, topic, ts)` on Attempt
  - [ ] Migrate

- [ ] **Day 5 — RLS + admin**
  - [ ] RLS policies in a raw-SQL migration
  - [ ] `FORCE ROW LEVEL SECURITY` ← otherwise owner bypasses it silently
  - [ ] Middleware setting `app.institute_id` per request
  - [ ] Register all models in Django admin

- [ ] **Day 6 — Seed data**
  - [ ] Real JEE syllabus tree from the official NTA PDF (~80 topics)
  - [ ] 2 test institutes with **different** trees
  - [ ] A few fake students per institute
  - [ ] Management command: `seed_syllabus`

- [ ] **Day 7 — Prove isolation**
  - [ ] Test: querying as institute A cannot return B's rows
  - [ ] Test: full migrate from empty DB runs clean
  - [ ] P0 done-when checklist all green

### Stages after P0

- [ ] **P1 — Ingestion** (4–6 wks) · mock file upload, column mapping, identity resolution, question→topic queue
- [ ] **P2 — Feature store** (2–3 wks) · rung-0 mastery, mock analyzer
- [ ] **P3 — Detectors + console** (3–4 wks) · ⭐ **first sellable**
- [ ] **P4 — Student PWA** (3–4 wks)
- [ ] **P5 — Revision scheduler** (2–3 wks)
- [ ] **P6 — Daily planner** (2–3 wks)
- [ ] **P7 — Gemini narration** (2–3 wks)
- [ ] **P8 — Reports, cohort analytics, ML rungs 1–2** (ongoing)

---

## 🎨 Track B — Demo prototype

Static frontend for pitching to coaching institutes. **Zero backend.** Hardcoded data only.

**Blocked on two decisions** (see [`TECHNICAL_DOC.md`](TECHNICAL_DOC.md) §17):
1. Who are you pitching — specific institute, or a generic first meeting?
2. What's the ask at the end? *(Recommended: free 6-week pilot with one batch.)*

- [ ] Decide target + ask
- [ ] `prototype/assets/data.js` — demo dataset (spec already written, `TECHNICAL_DOC.md` §12.5)
- [ ] `index.html` — director command center *(open the demo here — buyer's screen)*
- [ ] `student.html` — Student 360, the Aarav Mehta story
- [ ] `mock.html` — mock test intelligence, marks-lost attribution
- [ ] `app.html` — student phone view
- [ ] `pilot.html` — the ask
- [ ] Deploy to Netlify / GitHub Pages (free, never sleeps)

**Rule: never call Gemini live in the demo.** Pre-write narration into `data.js`.

---

## 📊 Track C — Data acquisition

Longest lead time. **Start now, in parallel with everything.**

### C1 · Syllabus & structure (solo, free, ~1 week)
- [ ] Download official NTA JEE Main syllabus PDF
- [ ] Type Physics tree into CSV (`subject, unit, chapter, weight`)
- [ ] Chemistry tree
- [ ] Maths tree
- [ ] Download 10 years JEE Main PYQs + JEE Advanced archive
- [ ] Compute topic weightage from PYQ frequency

### C2 · Institute outreach (weeks — start first)
- [ ] List 15 target institutes (prioritise anywhere you or your friend studied)
- [ ] Draft the ask — *"can I analyse your last 6 months of mocks and show you something free, no obligation"*
- [ ] Send first 5
- [ ] One-page data agreement (anonymisation, **model-training rights**, deletion)
- [ ] First manual analysis in a Jupyter notebook — **no product needed to win the pilot**

### C3 · Public datasets (today, free)
- [ ] Download EdNet (closest domain match — test prep)
- [ ] Download ASSISTments
- [ ] Build rung-0 rolling accuracy
- [ ] Build BKT, evaluate with a **time-based** split (never random — see §7.7)

---

## 🗓️ What "mock data" means — two different things

Frequently confused:

| | Track A seed data | Track B demo data |
|---|---|---|
| **Where** | PostgreSQL, via `seed_syllabus` command | `prototype/assets/data.js` |
| **What** | Real JEE chapter names, 2 fake institutes, a few fake students | Aarav Mehta, 7 mocks, marks-lost split |
| **Purpose** | So the backend has something to query | So a director sees a convincing screen |
| **When** | P0 Day 6 | Track B, before the pitch |
| **Connected?** | **No — these never touch each other** | |

Real student attempt data only arrives in **P1**, via ingestion of a real institute's files.

---

## 🔧 Running the project

```powershell
cd E:\Student_AI\app
docker compose up -d
.\.venv\Scripts\python.exe manage.py runserver
# http://127.0.0.1:8000/admin/   (admin / devadmin123)
```

**Ports on this machine:** 5432 = local Postgres install · 5433 = `stocks_db` container · **5434 = ours**

---

## 📄 Doc map

| File | Purpose |
|---|---|
| `TASKS.md` | ← you are here. What to do next |
| `PROJECT_LOG.md` | Decisions + why, session history |
| `TECHNICAL_DOC.md` | Full spec: architecture, data strategy, Gemini, prototype, stages |
| `SYSTEM_DESIGN.md` | Schema detail + open questions — **give this to your friend for review** |
| `WORKFLOW.md` | 9 Mermaid diagrams |
| `LEARNING_PATH.md` | Skills + free resources per phase |
| `architecture.html`, `build-plan.html` | Superseded where they mention Claude / Redis / paid hosting |

### Known doc drift
- [ ] `TECHNICAL_DOC.md` and `SYSTEM_DESIGN.md` say **Django 5.x**; reality is **6.1.1** (Python 3.14 requires it)
- [ ] Both say Postgres port **5432/5433**; reality is **5434**
