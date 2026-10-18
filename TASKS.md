# Student AI — Task Tracker

**What to do next.** For *why*, see [`PROJECT_LOG.md`](PROJECT_LOG.md). For the full spec, [`TECHNICAL_DOC.md`](TECHNICAL_DOC.md). Start at [`README.md`](README.md).

Last updated: 18 Oct 2026

---

## The goal, so every task below can be checked against it

> A domain LLM for exam preparation that works out **what a student actually misunderstands** — not what they scored — and tells a teacher what to do about it. Gemini does the reasoning; every transcript trains our own model.

A task that doesn't serve that doesn't belong on this list.

---

## Where we are

```
✅ Filing cabinet    tenant isolation verified (incl. ReasoningTrace)
✅ Calculator        counting engine, 8 checks, 5-bucket marks attribution
✅ Content           46-question diagnostic paper · 15 misconceptions · 63 tagged options
✅ Patterns          hero signatures verified at p ≤ 0.01, control fails
✅ The brain         diagnose_misconception live — 4/4 heroes correct
✅ Screens           live API · diagnosis card · question panel · How it works · Data & trust
✅ Real data         official JEE Main + NEET 2026 syllabi (NCERT-linked);
                     NEET 2025 + JEE Main 2026 papers, cross-checked vs NTA keys
✅ Safety net        490 backend + 36 frontend tests
✅ Student API       /api/my/… ; roll-number sign-in with a forced first-password
                     change, verified over real HTTP; students walled off from the
                     console. No student app screens yet (a holding page stands in)
✅ Results upload    paper → blueprint → CSV results, per-student all-or-nothing,
                     idempotent. xlsx not yet; an institute's own paper has no
                     option tags, so no misconception diagnosis for it
✅ Day planner v1    three explicit rules, each block saying which; not the LLM plan_week
🟡 Training data     195 traces, 1 mentor verdict (a test click) — corpus has started
❌ NEET on screen    syllabus and paper loaded, no screen shows Biology yet
```

**Pitch-ready today on the JEE diagnostic demo.** The NEET demo round (below) is what moves the pitch onto a real exam paper.

### ⚠ Demo traps — know these before a meeting
- **Only open the four hero students** (Aarav, Kunal, Tanvi, Ishita). Any other student triggers a *live* Gemini call, and the free tier is ~20 requests per model per day — the card may come back "AI unavailable".
- Lead with **Aarav and Kunal**: Tanvi's and Ishita's cards add weaker secondary findings, so their totals read higher than their headlines.
- The "Mock intelligence" screen has no menu link (`/students/1/mock/7`).
- "Loop closed" and Priya Nair's "44% → 67%" are **seeded examples**, not real outcomes.

---

## ✅ PHASES 1–3 — DONE (25 Sep)

- [x] **1 · Schema** — `Misconception`, `QuestionOption`, question content, `Attempt.chosen_option`
- [x] **2 · Content** — 46 questions, 15 misconceptions, 63 tagged distractors, answer keys independently verified
- [x] **2 · Patterns** — heroes err *consistently*; `manage.py verify_signatures` proves it with an exact binomial test and fails the build if it stops being true
- [x] **3 · `ReasoningTrace`** — cache *and* training corpus, behind RLS
- [x] **3 · Gemini client** — PII-stripped, traced, cached, never fabricates
- [x] **3 · `diagnose_misconception`** — structured output, 2 endpoints
- [x] **3 · AI Diagnosis card** — every state, agree/disagree wired

**Verified, not asserted:**
```
Aarav    MIS-ORG-EAS    5/6 bait (83%) vs 21% cohort   4.1x   p=0.0018   2/2 counter-evidence correct
Control  MIS-ALG-SQUARE 2/3        (67%) vs 14%        4.9x   p=0.051  ✗ fails the bar
PII      payload contains "Aarav": False | "A-1041": False
```

The control is the single strongest clump across all **280 student × misconception cells** — the best that pure noise managed — and it still fails. That contrast is what makes the heroes mean something.

---

## 🔴 NEXT — the NEET demo round (awaiting go-ahead)

Moves the pitch onto a real exam: *"This is the actual NEET 2025 paper — here's what the system found about three students who sat it."*

- [ ] **Render maths** — real questions are stored as LaTeX; the console shows `$\theta$` raw
- [ ] **Biology on screen** — several views hard-code Physics/Chemistry/Maths; NEET has Botany + Zoology
- [ ] **Simulated students sit the real NEET paper** — planted misconceptions, clearly labelled simulated; use only the 157 key-agreed questions
- [ ] **Clickable counter-evidence** — D22/D23 arrive as words in a sentence, not linked question ids
- [ ] Correct the "Data & trust" page — it still says real papers are "being added now"

**Before any pilot:** a person reviews the 32 cross-check disagreements; back up `E:\Student_AI_backups\` off this machine; replace demo passwords.

---

## 🟡 PHASE 4 — The rest of the reasoning layer

- [ ] `analyse_decline` · `plan_week` · `read_paper` · `answer_forensics` · `generate_practice`
- [ ] Cache on a state hash — unchanged state must never regenerate
- [ ] Batch overnight generation (50% cheaper, and nudges aren't latency-sensitive)

---

## 🟣 Student API, login and results upload — done 18 Oct; what is left

Built and tested end to end. The calls I made where the answer was yours are listed first so you can overturn them; each is reversible.

**Decisions made (overturn any of these)**
- [x] **Student login** — roll number + a password the institute provides, and a forced change at first sign-in (your call). Staff issue it with `POST /api/students/{id}/account/`; the temporary password is random, shown once, stored hashed. Issue and reset are two verbs so a repeat cannot overwrite a password a student already chose.
- [x] **A revision is marked done once.** `done_at` goes null → a time and never moves (a conditional `UPDATE … WHERE done_at IS NULL`). It is the one field in the event log written after insert; the alternative is a separate completion row, which changes the six readers of `done_at`. Documented in `TECHNICAL_DOC` §7 and §12.
- [x] **Plan ticks stay in `PlanBlock.completed`**, and the planner never deletes a ticked block (`replace=true` rebuilds only the un-ticked ones; tested). Cheaper than a completion-event table and enough while nothing else deletes plan blocks.
- [x] **A student still does not see** `risk_score`, flags, interventions, or the misconception behind a wrong option. A test pins each. Adding any later is additive.
- [x] **The planner is rules, not a model**: overdue revisions, then the weakest *taught* chapters, then one taught-but-untouched chapter, sized to what the student actually logs; no start times, because nothing says when a student studies.

**Built since the last list**
- [x] Results-file upload — `POST /api/papers/`, `…/blueprint/`, `/api/ingest/results/`, `/batches/`, `/mappings/` (CSV; encodings and delimiters Excel really produces; saved column mappings; `dry_run`)
- [x] Student logins: issue, reset, forced change, `login_status` on the student payloads, `provision_student_accounts` for a whole batch
- [x] `my/revisions/{id}/complete/`, `my/plan/{id}/uncomplete/`, `my/plan/generate/`, `my/attempts/`, `my/questions/{id}/`
- [x] Mentor-side: `students/{id}/study-logs|confidence|revisions`, `flags/{id}/interventions/`
- [x] Throttles on login, password change, credentials, student writes, plan generation and uploads
- [x] The four diagnosis gaps the frontend had recorded: `student_ref`, the `tally`, resolved `counter_evidence_questions` (D22/D23 are now clickable on real traces), a real `human_verdict` enum; `source` on papers and questions

**Still open**
- [ ] **xlsx upload.** Needs `openpyxl` parsing zip files from strangers — your call to add the dependency. The API says "Save As → CSV" until then.
- [ ] **Diagnosis for an institute's own paper.** Its blueprint has chapter + key only, no option text or misconception tags, so `diagnosis` answers 422. Tagging distractors is the factory's job, or a person's.
- [ ] **Re-marking after a key correction.** A key cannot change under recorded answers (it is refused); there is no deliberate re-mark step yet.
- [ ] **Bulk logins over HTTP.** One password hash is ~1 s, so a batch is the command, not a request. A background job runner would let a director press a button.
- [ ] **Per-process throttle counters.** Swap Django's default cache for a shared one before running more than one worker. Per-account lockout is left out on purpose (it lets anyone who knows a roll number lock that student out).
- [ ] An LLM `plan_week` (Phase 4) to reorder and word the rules-based plan.

**Frontend**
- [x] Change-password screen and gate, a holding page for students (a console of 403s is not a fallback), typed against the new contract; the mock layer enforces the same rule as the server
- [ ] **Screens for staff**: issue/reset a student's login, create a paper, upload a blueprint and results. All API-only today.
- [ ] Sign-in field label: "Username" → "Username or roll number" (`routes/Login.tsx` is mid-redesign, so not touched)
- [ ] Move Student 360's Day plan onto `GET /api/students/{id}/plan/`; a mentor still sees an empty plan
- [ ] Delete the `gaps.ts` entries the server now answers (`COUNTER_EVIDENCE_UNRESOLVED`, `DISTRACTOR_TALLY_NOT_EXPOSED`, `STUDENT_REF_NOT_EXPOSED`, `QUESTION_PROVENANCE`, `MOCK_SCORES_ORDER`) together with the code that compensates for each; `ProvenanceExhibit` can count `usePapers()` by `source`
- [ ] The real student app

---

## 🟢 PHASE 5 — Our own model

Cannot start before ~5,000 traces exist. That's Phase 3 running for a while.

- [ ] Export traces to a fine-tuning dataset
- [ ] Fine-tune Qwen/Llama 8B on `diagnose_misconception` alone
- [ ] Evaluate: agreement with Gemini on held-out cases → then agreement with **mentors**, the real metric
- [ ] Route common cases to ours, hard cases to Gemini

---

## 🔧 Defects — fix alongside

| Severity | What | Where |
|---|---|---|
| **High** | Mock analyzer books *"mastery unknown"* as *"conceptual gap"* — 10,705 marks rest on a NULL, understating the headline the product sells on. Needs a fifth bucket; changes the contract | `events/services/mock_analysis.py` |
| Medium | `weak_topic` shows a *lifetime* marks total next to a 20-attempt decayed mastery | `derived/services/features.py` |
| Medium | `accuracy_30d` null for 86% of rows, degenerate 0/1 where present | `derived/services/features.py` |
| Low | Neglect chart labels detach from short bars | `web/src/components/charts/` |
| ~~—~~ | ~~Console has never touched the live API~~ — fixed 30 Sep | `web/` |

---

## 📊 Data acquisition — runs in parallel, start now

Longest lead time. Doesn't block Phase 1–3 but blocks everything being *real*.

- [ ] Download 10 years of JEE Main papers from `nta.ac.in`
- [ ] Download **EdNet** (131M real test-prep answers) for training and sanity-checking
- [ ] List 15 local coaching institutes; ask 5 for six months of past mock results — *"free analysis, no obligation"*
- [ ] One-page data agreement covering anonymisation and **model-training rights** — uncontroversial if raised up front, near-impossible to add later

---

## Running it

```bash
cd app
docker compose up -d
.venv\Scripts\python.exe manage.py runserver     # localhost:8000
.venv\Scripts\python.exe -m pytest -q            # 68 tests

cd ../web && npm run dev                         # localhost:5173
```

Ports on this machine: 5432 local Postgres · 5433 `stocks_db` · **5434 ours**
