# Student AI — Task Tracker

**What to do next.** For *why*, see [`PROJECT_LOG.md`](PROJECT_LOG.md). For the full spec, [`TECHNICAL_DOC.md`](TECHNICAL_DOC.md). Start at [`README.md`](README.md).

Last updated: 25 Sep 2026

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
✅ Safety net        190 backend + 21 frontend tests
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
