# AI Student Performance System — Project Log

This file is updated after every prompt in this chat. It tracks decisions, status, and next steps for the product/build side of the project.

> Note: Tech stack research/decisions are being tracked in a **separate parallel Claude chat**, not here. This log stays focused on product scope, architecture decisions made in this thread, and build progress.

---

## Project Summary

AI-assisted student performance & preparation system for competitive exam aspirants (JEE, NEET, CAT, GATE, UPSC, CUET). Works alongside coaching institutes — not a replacement for teachers/content. Core focus: preparation management, weakness tracking, revision intelligence, mock test analytics, and AI-driven guidance (not a generic doubt-solving chatbot).

Source doc: `Ai Student Performance System Concept Note.pdf`

**MVP modules (from concept note):**
1. Student onboarding
2. Daily study planning
3. Study logging
4. Weak-topic identification
5. Revision scheduling
6. Mock test analysis
7. AI guidance system
8. Performance dashboard

---

> **This file is backward-looking** (decisions + why). Start at [`README.md`](README.md); for what to do next see [`TASKS.md`](TASKS.md); for the spec see [`TECHNICAL_DOC.md`](TECHNICAL_DOC.md).

## 🔄 GOAL RESTATED — 25 Sep 2026

The product is **a domain LLM for exam preparation**, not a dashboard with AI-generated captions. It works out *what a student misunderstands*, and Gemini's reasoning transcripts train our own model alongside.

**Three earlier positions are now reversed (decisions 41–43 below).** Docs consolidated from 8 files to 5 on the same date — `LLM_ARCHITECTURE.md`, `SYSTEM_DESIGN.md`, `WORKFLOW.md`, `AGENT_HANDOFF.md`, `architecture.html` and `build-plan.html` were deleted after folding their content into `TECHNICAL_DOC.md` v2.0. All recoverable from git history.
>
> **Canonical docs (v0.2):** [`TASKS.md`](TASKS.md) (task tracker) · [`TECHNICAL_DOC.md`](TECHNICAL_DOC.md) (full spec) · [`WORKFLOW.md`](WORKFLOW.md) (diagrams) · [`SYSTEM_DESIGN.md`](SYSTEM_DESIGN.md) (schema + system design, written for review). The earlier `architecture.html` / `build-plan.html` artifacts remain accurate on architecture and reasoning, but where they name Claude, Redis, or paid hosting they are **superseded**.

## Current Status

Concept note read. **Full system architecture is done** — `architecture.html`, published at https://claude.ai/code/artifact/e127c17e-806f-4f68-a98f-f758bd68ddfe (7 layers, 9 flows, 9 build phases, detector catalogue, cross-cutting concerns, hard-problems list).

Chat purpose clarified: this is a **learn-by-building** thread. Primary goal is strengthening skills in scalable product development (system design, algorithms, backend, ML), with the product as the vehicle. Learning path and free resources tracked in `LEARNING_PATH.md`.

**Build plan with tech stack is done** — `build-plan.html`, published at https://claude.ai/code/artifact/fd01e19d-f419-468a-9b68-fd561d49ad2b (stack decision table, 36-week timeline, 9 stages with per-stage tech, deployment topology, LLM cost model, testing strategy, what-not-to-build).

Active track: building a **presentable prototype to demo to coaching institutes**. Stage plan agreed (8 stages, see below); architecture and build plan completed out of order because the user asked for them first.

Next step: Stage 1 — name the target institute and the ask, then cut demo scope.

---

## Decisions Made

1. **This thread is learn-by-building.** Decisions get explained with trade-offs and alternatives; the user makes the calls. Optimizing for understanding over delivery speed.
2. **Build order follows a dependency spine, not the concept note's module numbering.** Logging produces the data that weakness detection consumes; weakness feeds revision scheduling; dashboard and AI guidance are read-layers over all of it. Daily planning (module 2) cannot be built before knowing what signals exist to plan from.
3. **The core problem is Knowledge Tracing + Spaced Repetition** — established academic fields with public datasets and published baselines, not a novel invention. ML work will climb a defined ladder (rolling accuracy → BKT → Elo → IRT → DKT), shipping the simplest rung first and climbing only on evidence that it's failing.
4. **Created `LEARNING_PATH.md`** mapping build phases → skills → free resources.
5. **The LLM narrates; it never computes.** Every number comes from deterministic engines reading the feature store. The model receives typed "insight objects" and turns them into prose, with no write path back into state. Reasons: explainability (a director will ask "why did it flag this student?"), reproducibility, and bounded inference cost via state-hash caching.
6. **Insight objects are the contract** between the deterministic zone and the generative zone — typed, evidenced, every field traceable to a stored feature.
7. **Event tables are append-only; derived state is always rebuildable.** Lets you swap the mastery model and replay history to see what it *would* have flagged.
8. **Tier 0 / Tier 1 data split.** Tier 0 = data the institute already holds (mock files, roster, chapter completion) and powers mock analysis, weak-topic ID, at-risk triage, over-attempting, cohort analytics — with zero student behaviour change. Tier 1 = student-logged data, unlocking revision scheduling, planning, confidence mismatch, burnout. This is the architectural answer to "who enters all this data?"
9. **Build the director/mentor console (P3) before the student app (P4).** It's the first sellable unit and is demonstrable on an institute's historical files before anyone installs anything.
10. **Narration is the last layer built (P7), not the first.** Its entire input is the output of P2–P6.
11. **The buyer is not the user.** Concept note is student-facing; the cheque comes from the institute director. Demos must open on the director's screen (at-risk triage), not the student app.

### Tech stack (decided 2026-09-17 — supersedes "out of scope here")
12. **Python 3.12 + Django 5 + DRF.** Django over FastAPI *specifically for the admin*: the question→topic review queue, syllabus tree editor, tenant onboarding and duplicate-student resolution are each a `ModelAdmin` class instead of a small app to build and maintain. ML libraries (pyBKT, py-irt, FSRS) are Python-native, so one language, one codebase.
13. **PostgreSQL 16+, non-negotiable.** JSONB for evidence arrays and column-mapping profiles, window functions *are* the rung-0 feature store, RLS as the tenancy backstop, native partitioning for `attempts`.
14. **Tenancy: shared schema + `tenant_id` + Postgres RLS.** Not schema-per-tenant (migration pain ~20 institutes), not DB-per-tenant (ops pain from the first).
15. **Celery + Redis** for jobs/beat. **HTMX + Alpine + ECharts** for the console (server-rendered; P3 is tables and drill-downs — ships in weeks, no API layer). **PWA before native** for the student app (Android-dominant market, web push works, no app-store tax pre-adoption).
16. **LLM: `claude-opus-5`, adaptive thinking.** Cost levers in order — prompt caching, then Batch API (50% off, and nightly narration has no latency requirement), then model choice. Haiku 4.5 for the daily-nudge route only if measured on real payloads; keep weekly summaries and parent reports on Opus.
17. **One VPS, Docker Compose, `ap-south-1` (Mumbai).** DPDP data residency is a requirement, not a latency preference — most users are minors. Serverless is a bad fit (multi-minute ingestion, all-student nightly recompute); Kubernetes is unjustifiable at this scale.
18. **Don't build:** OMR scanning (institutes have vendors — import their CSV), own test platform, content/question banks, rank prediction, native apps pre-PWA, a real feature-store product, k8s/microservices, deep learning before ~100k attempts.
19. **~15 weeks solo full-time to first sellable unit (P0–P3).** Everything after P4 is better built against a paying pilot's data than against assumptions.

### Reversals 2026-09-25 (v2.0) — these override decisions 5, 28, 29 and 30
41. **Gemini does the reasoning, not just the phrasing.** Decision 5 ("the LLM narrates, it never computes") was half right. Correct half: computing rolling accuracy with an LLM is bad engineering — arithmetic over 24k rows, 12,480 calls/day for a worse answer than a window function gives free. **Wrong half:** treating diagnosis, causal analysis and planning as "narration". Those are judgement tasks where an LLM is the right tool and a rules engine is far worse. The rule is now: *a number that must be exact and is computable by counting* → deterministic; *a judgement a good teacher makes differently from a bad one* → LLM.
42. **Distillation does apply — decision 30 was wrong.** "Labels are free" holds for knowledge tracing (right/wrong is ground truth). It does **not** hold for reasoning: there is no ground truth for *"what misconception does this pattern reveal?"* Gemini's traces are the training signal. `ReasoningTrace` captures every call, and a mentor confirming a diagnosis converts a teacher-model guess into a human-validated example — which is what makes the corpus worth more than raw Gemini output.
43. **The blocker is content, not architecture.** `Attempt` records right/wrong but **not which option the student chose**; `question_text` is populated on 0 of 525 rows; options and solutions don't exist. The richest prompt constructible today is *"got Q17 wrong, topic Rotational Motion"* — from which no model produces a diagnosis. The apparent ceiling was never the model; it was the input.
44. **Misconception taxonomy is the IP.** Every wrong option tagged with the specific mistake that produces it (`MIS-ROT-AXIS` = used the centre-of-mass axis). One student picking a distractor once is noise; the same misconception across four questions is an evidenced, falsifiable, marks-quantified diagnosis. Built from our own data; an API key doesn't buy it.
45. **Fake data must contain the patterns we intend to detect.** The current seeder ranks questions by latent ability and marks the top *c* correct, producing flat-0% students and structureless wrong answers. A diagnosis engine over that finds nothing because nothing is there. Regenerating answers with *consistent per-student misconception patterns* is the most underestimated task in the plan.
46. **Fine-tune, never train from scratch.** Qwen/Llama 8B on accumulated traces. From-scratch training costs millions and buys nothing.

### Revisions 2026-09-17 (v0.2) — these override 12–19 where they conflict
20. **LLM is Gemini, not Claude.** Cost-driven. Free tier caps at **500 requests/day** (~500 students at one nudge each) and Pro models left the free tier on 1 Apr 2026 — Flash/Flash-Lite only. Paid: Flash-Lite $0.10/$0.40 per 1M (~$69/mo at 10k students, ~$35 batched); 3.5 Flash $1.50/$9.00.
21. **PII must be stripped before every Gemini call.** Google's free-tier terms allow submitted content to train their products *with human review*, and tell users not to send personal information. Users here are minors. Send opaque refs (`S-4471`) + topic names + numbers only; re-identify locally after generation. Costs nothing — the payload is already structured.
22. **django-q2 with the ORM broker replaces Celery + Redis.** Removes a whole service and its bill; Postgres is already there. Swap back if it's outgrown.
23. **Hosting: Netlify/GitHub Pages for the prototype** (never sleeps), **Oracle Cloud Always Free** for the pilot backend (4 ARM cores / 24GB, permanent). Render free spins down after 15 min → 30–50s cold start, fatal in a live demo. Supabase free pauses after a week idle.
24. **Prototype is a static frontend** — plain HTML/CSS/vanilla JS + Chart.js from CDN + one hardcoded `data.js`. No backend, no DB, no auth.
25. **Never call Gemini live in the demo.** API key exposed in client JS, dead-air latency in front of a buyer, and an unrecoverable bad generation mid-pitch. Pre-write narration into `data.js`.
26. **Keep the narration layer swappable.** Gemini's terms changed twice in 2026 (Pro off free tier in April, Cloud trial credit withdrawn in March). Decision 5 (model narrates, never computes) is what makes swapping cheap.
27. **Docs are markdown, not published artifacts**, at the user's request.

### Architecture switch 2026-09-20 — supersedes decision 15 (HTMX)
35. **React + Vite + shadcn/ui + DRF, with OpenAPI as the contract.** Supersedes the HTMX+Alpine choice. Rationale: parallel agent work requires a contract between frontend and backend, and `openapi.yaml` generated by drf-spectacular is that contract. The API is reused by the student PWA in P4 regardless. **Cost accepted: P3 "first sellable" slips ~2–3 weeks.**
36. **The contract must exist before agents do.** Built DRF + 18 endpoints + `openapi.yaml` before spawning anything — agents cannot build against a spec that doesn't exist.
37. **Regenerate the contract after every serializer change:** `manage.py spectacular --file ../openapi.yaml`. Whoever changes it announces it.
38. **Strict, non-overlapping agent file ownership**, with **only the DB agent permitted to run makemigrations/migrate.** That was the single real collision risk.
39. **Agents run 2-then-2, not 4-at-once.** The DB agent mutates schema on the shared Postgres; backend and testing agents would be querying a moving target. Frontend is decoupled (openapi.yaml + MSW mocks) so it runs throughout. Sequencing follows the actual dependency, not the desired parallelism.
40. **`Attempt.status` is an enum**, not a nullable boolean (resolves SYSTEM_DESIGN §8 Q5). `correct|wrong|blank|not_reached` — the analyzer must tell *ran out of time* from *chose to skip*.
28. **Gemini does NOT make the decisions.** Deterministic engines decide; Gemini only describes. Arithmetic case: LLM-decided mastery = ~12,480 calls/day for one institute vs a 500/day free ceiling, ~$90/mo, non-reproducible, unexplainable, unmeasurable — while a window function costs ₹0 and is more accurate. Strategic case: if Gemini decides, the product is a prompt anyone can copy; if our models decide, the moat compounds with data.
29. **"Our own model" = prediction models, not an LLM.** Knowledge tracing (BKT→IRT→DKT), retention/decay, risk. Already the §6.1 ladder. Training an LLM is never on the table.
30. **Distillation doesn't apply here** — labels are free. Every attempt carries ground truth (right/wrong), so there is nothing for a big model to label. Gemini's one legitimate decision role is question→topic mapping: *propose → human confirms → store permanently*, never runtime inference.
31. **Data sources, in order of arrival:** public KT benchmarks (EdNet ~131M is closest — test prep, not K-12; also ASSISTments, Junyi, Eedi, Riiid/Kaggle — **check licences, several are non-commercial**) → **the pilot institute's back catalogue** (~1.08M attempts from 300 students × 2 years, free, exact domain, puts you at DKT scale on day one) → live operation (~45k attempts/institute/month) → synthetic (**testing only, never training**).
32. **Pilot agreement must include model-training data rights.** Uncontroversial if raised up front, near-impossible to retrofit.
33. **Never split KT training data randomly** — it's sequential, and a random split leaks the future into the past. Split by time (the honest number) and by student (cold-start generalisation).
34. **Detector thresholds should be learned, not guessed.** Once outcome data exists, derive the mastery cut-off from students who actually declined. Retrospective replay on an institute's history ("would we have caught the students who failed?") is also the most convincing pre-sale number available.

---

## Open Questions

1. **Who is the demo for?** Specific institute, size, which exams? Blocks Stage 1.
2. **Exam-deadline scheduling** — classic spaced repetition assumes indefinite retention. Exam prep has a hard deadline and fixed syllabus. No off-the-shelf implementation; expect to modify FSRS rather than adopt it. (Architecture §8.)
3. **Cold start** — weakness detection needs history, but a new student has none. Options: diagnostic test, import past mocks, or an explicit provisional mode. (Architecture §12.2.)
4. **Question→topic mapping** — the gate on the whole ingestion flow. Strategy ladder defined (institute tags → paper blueprint → LLM-proposed + human-confirmed), but the per-paper cost is unvalidated.
5. **Attribution** — proving an intervention caused an improvement needs staggered rollout designed into the pilot up front, not reconstructed after.
6. Tech stack — deliberately out of scope here; tracked in the parallel chat.

---

## Session Log

### 2026-09-30 — backend agent: the diagnosis card's evidence becomes clickable (branch `agent/backend-4`)

Four contract gaps the frontend hit while building the AI Diagnosis card, all of them the same shape: the model's output was being published raw, so anything the model could not be trusted to compute was either missing or wrong.

- **`GET /api/questions/{id}/` — new.** Tenant-scoped, retrieve-only. Stem, solution, every option with `is_correct`, and the misconception each wrong option carries (code, the belief in the student's voice, and the remedy). With `?student=`, also `options[].chosen`, `chosen_label`, `status`, `marks`, `time_spent`. Deliberately **no list route**: a paper's questions are reached through the diagnosis that cites them, and an endpoint that pages every question an institute owns is a data-export surface nobody asked for.
- **`evidence[]` on each hypothesis.** `evidence_questions` was `["D16"]` — a label unique only *within one paper*, so no client could build a URL from it. That was the whole reason the chips were dead, not an oversight in the UI. Each citation is now resolved server-side against the student's own attempts to `{question_id, label, chose, marks_at_stake}`, where `question_id` is what the new endpoint answers on and **null means the citation did not resolve** — render those as text, not as a link to nowhere. `evidence_questions` is kept verbatim (it is what the model wrote) and documented as display-only.
- **`total_marks_at_stake`, and the overlap question settled.** Hypotheses **cannot** overlap: a student picks one option per question, one option carries at most one misconception, so a wrong answer is evidence for exactly one finding. (Six of the forty tagged questions *offer* two misconceptions across their distractors, but only the chosen one fires.) So the total is a clean sum over distinct cited questions — and the 28-vs-20 contradiction the console was papering over was never overlap: **the headline quotes the leading hypothesis, the sum covers all of them.** Said so in the help_text.
- **Arithmetic moved back to Tier A.** `marks_at_stake` per hypothesis is now `5 x resolved citations` rather than whatever the model returned. On every trace recorded so far the two already agreed, which is the point — the guard costs nothing today and stops a card whose chips and total disagree in front of a director.
- **`counter_evidence` is never blank and never null.** The prompt already told the model to say plainly that there is none; the contract now guarantees it, with two *different* substituted sentences — "no counter-evidence on this paper, the weakness may be chapter-wide" when none was available, and "the model did not state it, treat this finding as un-narrowed" when some was. Collapsing the second into the first would report a silence as a finding.
- **`paper_id` / `paper_name`** echoed back, so the payload is self-describing and cacheable under its own key rather than the console remembering what it asked for.
- **The 422 and 503 bodies are prose now.** This panel is read over a mentor's shoulder by the person deciding whether to buy the product, and `GEMINI_API_KEY is not set` in front of them costs more than the outage does. Four sentences, no jargon; the technical string is logged instead. The two 422 cases are now distinct exception classes (`NoOptionsRecorded`, `NoMisconceptionTags`, both still `ValueError`) so the API can explain *which* without matching on message text.
- `ReasoningTrace.output` still holds the model's raw JSON, untouched by any of this. A training example that has been quietly corrected is not a training example.
- 142 tests green · `openapi.yaml` regenerated, `--fail-on-warn` clean · verified against a live diagnosis (Aarav / Mock 15: D16 → question 923 → "Nitration of toluene…", chose (C) m-nitrotoluene, `MIS-ORG-EAS`).

### 2026-09-25 — content agent: question bank + misconception taxonomy (branch `agent/content`)
- **Question bank 15 → 46**, so "Mock 15 — Diagnostic" reads as a paper rather than a sample. Split Physics 15 / Chemistry 16 / Maths 15 (Chemistry carries the extra because two hero signatures live there). Every key verified by hand; every chapter checked against the seeded syllabus tree.
- **Taxonomy 6 → 15 misconceptions**, taking in the rest of `TECHNICAL_DOC.md` §4's starter list: field/force sign errors, average vs instantaneous velocity, relative-velocity frame, catalyst-shifts-equilibrium, σ/π miscount, hybridisation-from-formula, roots kept after squaring, inverse-trig range, modulus sign cases. `description` is now written **in the student's voice as the belief they hold**, and `remedy` as a lesson a teacher can actually run — both fields go straight into the model's prompt, so they are what let it explain *why*.
- **Counter-evidence is now a designed feature, not an accident.** Questions carry `counter_to`: same chapter, trigger removed (directing group stated, axis is the tabulated one, alkene symmetric, substitution handed over), and **no option tagged with that code**. The seeder makes the hero answer those correctly. That is what produces "on the two questions where the directing group was stated, he was correct — this is a specific trigger, not a topic gap". The seeder refuses to run if a question claims to be counter-evidence for a code it also baits.
- **Signature strength made deterministic.** The old per-question hit-rate coin flip left only a ~14% chance all four heroes cleared five-of-six, so a later bank edit could silently produce a demo with no detectable pattern. Replaced with a fixed miss count (drawn from the *easiest* baited questions, since a hero who gets the hard one right and the easy ones wrong invites the obvious objection).
- **New `manage.py verify_signatures`** proves the pattern from the database with raw SQL, not from the generator. Per hero: bait-take rate vs the cohort rate on the same questions, exact binomial p-value, lift, share of wrong answers, counter-evidence hits. Also measures the *adversarially chosen* control — the non-hero whose errors clump hardest across all 280 student × misconception cells. Exits non-zero on failure and runs automatically at the end of `seed_questions`, so "seeded" and "provable" are one step.
- Also fixed: `--reset` crashed on `Attempt.test_paper` being PROTECT; option labels are now shuffled at seed time (the bank is written correct-answer-first for readability, but a paper where every answer is (A) is not believable); question ids zero-padded so `ordering` sorts them as a paper.
- Result: Aarav 5/6 EAS (21% cohort, p=0.0018), Kunal 5/6 axis (17%, p=0.0008), Tanvi 5/6 chain (21%, p=0.0018), Ishita 4/5 Markovnikov (13%, p=0.0013); all 2/2 on counter-evidence. Strongest control 2/3 at p=0.051 with errors spread over four unrelated beliefs. 89 tests green.

### 2026-09-16
- Read and summarized `Ai Student Performance System Concept Note.pdf`.
- Set up this log file to be updated after every prompt going forward.
- Re-read this log in a fresh chat; established that this thread is primarily for **learning and skill-strengthening**, targeting scalable-product skills (system design, algorithms, backend, ML), with free study resources requested alongside each build step.
- Identified the dependency spine across the 8 MVP modules; flagged that the concept note's module ordering is not a valid build order.
- Identified **Knowledge Tracing** as the named academic field behind the weak-topic module, and **spaced repetition (SM-2 / FSRS)** behind revision scheduling.
- Created `LEARNING_PATH.md`: phase→skill→resource map across 7 phases (data model, backend core, weakness detection, revision scheduling, analytics, AI guidance, scale).

### 2026-09-17
- New goal raised: a **presentable prototype for demoing to coaching institutes**. Agreed an 8-stage plan (target & ask → cut scope → fake dataset → screens → AI copy → polish → demo script & objections → pilot proposal).
- Flagged the buyer/user mismatch (decision 11) and two pitch corrections: reframe burnout detection as *disengagement/retention*, and never promise rank prediction.
- User redirected: architecture first, prototype after.
- **Built `architecture.html`** and published it as an artifact. Contents: compute/narrate boundary · 7-layer system map · entity model · Flow A (mock ingestion) · Flow B (plan generation) · Flow C (risk loop) · Flow D (AI query + claim validation) · engine ladders (mastery rungs 0–3, deadline-aware retention, marks-lost attribution) · Tier 0/1 data split · 9-phase build DAG · cross-cutting concerns table · hard-problems list.
- Recorded decisions 5–11 above from that architecture work.
- **Built `build-plan.html`** and published it. Contents: stack decision table (choice + why + the alternative that lost) · 36-week timeline with the week-15 "first sellable" marker · all 9 stages with per-stage build list, named tech, traps and done-when criteria · deployment topology diagram · LLM model/cost table with the three cost levers · testing strategy (ingestion golden files, detector replay, rebuild equivalence) · what-not-to-build.
- Recorded decisions 12–19 (tech stack). **Note:** this supersedes the earlier "tech stack tracked in the parallel chat" scoping — the user asked for tech detail here.
- Verified current Claude model IDs and pricing against the live API reference rather than memory: Opus 5 `claude-opus-5` $5/$25 per 1M, Sonnet 5 `claude-sonnet-5` $2/$10, Haiku 4.5 `claude-haiku-4-5` $1/$5. `budget_tokens` is rejected on current models — use `thinking: {type:"adaptive"}`.
- **Four direction changes from the user:** prototype = general frontend not a whole app · stack must be free/near-free · **Gemini instead of Claude** · markdown files instead of published artifacts.
- Searched current Gemini terms rather than writing from memory. Two findings that changed the design: **500 requests/day free-tier ceiling** (caps free usage at ~500 students), and **free-tier content may be used for training with human review** — Google's own terms say not to submit personal information, and these users are minors. Answer: strip PII before the call, re-identify locally (decision 21).
- **Wrote `WORKFLOW.md`** — 9 Mermaid diagrams (master workflow, trust boundary, ingestion, planning, risk loop + alert hygiene, de-identified narration, tier split, build DAG, prototype scope). Renders on GitHub natively; VS Code needs the free *Markdown Preview Mermaid Support* extension. No service or connection required — this was an explicit user question.
- **Wrote `TECHNICAL_DOC.md` v0.2** — supersedes the HTML docs where they conflict. Adds: free-tier stack table with honest catches per host, Gemini section (limits, privacy fix, capacity ceiling, paid pricing), full prototype spec incl. file layout, and an **internally consistent demo dataset** (Aarav Mehta, mocks 8–14 summing correctly to −37, 11% study time vs 46% marks lost in Chemistry, 166 lost marks partitioned 68/38/34/26).
- Recorded decisions 20–27.
- Walked the 9 build stages in brief, then **P0 in depth** — tech terms explained (schema, PK/FK, index, ORM, migration, append-only, canonical, multi-tenancy, RLS, adjacency list vs ltree, JSONB), 11-step workflow, Django model sketches, done-when, traps.
- User proposed "Gemini makes the main decisions, train our own model side-by-side." **Corrected the first half, confirmed the second** → decisions 28–30.
- Added **§2.1 (train vs prompt)** and **§7 (data strategy)** to `TECHNICAL_DOC.md`; renumbered §8–§17 and fixed cross-references.
- Answered the content-data question: **we need a map, not a library.** Only three things needed (syllabus tree, question→topic tags, topic weightage) — all structure, not content. Sources: NTA, jeeadv.ac.in, NCERT, official PYQ archives. Coaching modules and commercial books are copyrighted and unnecessary. **Gemini is a processor, not a source** — it will hallucinate a syllabus, but is excellent at parsing the official PDF into a tree and tagging questions.
- Answered the behavioural-data question: **cannot be bought, which is why it's the moat.** But mock files already contain behaviour when per-question timing exists (pacing, sunk-cost, selection strategy, stamina, over-attempting) — all Tier 0. Also ask institutes for attendance and **dropout/result records, which are the training labels for the risk model**.
- Gave concrete week-1 data plan across three tracks (institute outreach first — longest lead time; syllabus tree; public datasets). Key point: **the first analysis can be done by hand in a notebook** — no product needed to validate the thesis or win the pilot.
### 2026-09-23 — status check, no code changes
- User asked for the current stage and what to push, explicitly **without me running any git commands**. Read `.git/config`, `.git/HEAD` and the ref files directly instead (read-only, no git invoked).
- Found a branch situation worth recording: **HEAD is on `main` at `d2985bf`** (carries everything), while **`master` is stale at `370bde5`** and `origin/main` is also at `370bde5`. So the DB-agent merge is already on GitHub and the backend + frontend work is not. `master`, `agent/db` and `agent/frontend` are all redundant locally now.
- Remote is `https://github.com/Anugrah619/Studeent-Ai.git`.

### 2026-09-20 (later) — P0 data model + architecture switch
- **Built the full data model** across five apps. 21 project tables. Django auto-split migrations to resolve the circular app dependency (syllabus↔tenancy) — expected and fine.
- **Resolved SYSTEM_DESIGN §8 Q5 in favour of the enum:** `Attempt.status` is `correct|wrong|blank|not_reached`, not a nullable boolean. The mock analyzer needs to distinguish *ran out of time* from *chose to skip* — those need opposite advice.
- **Built `seed_demo`** — 2 institutes, 49 students, 24,000 attempts across 7 mock papers, 8,265 study logs, 1,242 confidence ratings, 2,898 revision events, 2,530 topic states, 132 plan blocks. Fixed random seed, so runs are reproducible. Hero students follow the §12.5 scripts; **verified Aarav Mehta's seven mocks sum to exactly 171→134 (−37), Chemistry −17.** Latent per-chapter ability drives which questions go wrong, so weak-topic detection is genuinely findable in the data rather than random.
- **ARCHITECTURE CHANGE (decisions 35–38 below).** User asked for 4 parallel agents with Swagger as source of truth. Flagged three conflicts honestly (migration-chain collisions; no API existed for OpenAPI to describe; shadcn is React and contradicts the HTMX decision) and put the fork to them. **User chose: switch to React + shadcn + DRF, worktree isolation.**
- **Built the API contract before spawning anything** — DRF 3.18.1 + drf-spectacular + CORS, `apps/api/` with serializers/viewsets, 18 endpoints, `openapi.yaml` generated (1402 lines). Agents cannot work against a contract that doesn't exist.
- **First commit** `d888732` on `master` (84 files, `.env` correctly excluded).
- Worktree isolation via the Agent tool **failed** — the harness cached "not a git repository" from session start, before `git init`. Worked around with manual `git worktree add`. But discovered `.venv` is gitignored, so Python agents in fresh worktrees would each need a full reinstall — and more importantly the DB agent mutating schema while the backend agent queries the same Postgres would cause transient failures. **Sequenced 2-then-2 instead of 4-at-once** (decision 39).
- Spawned **frontend** (own worktree, decoupled via openapi.yaml + MSW) and **db** (main tree, alone on the Python side). Backend + testing wait for the DB agent.
- Added `.mcp.json` with the official shadcn MCP server (needs a Claude Code restart to load; the shadcn CLI works regardless).

### 2026-09-20
- User asked what tracks the daily plan, and whether anything actually works yet. **Correct on both counts:** no task file existed (the P0 day plan lived only in chat), and the project is scaffolded but not started. Audited and confirmed: only `tenancy.User` has a model, 0 admin registrations, 0 views, `/admin/` is the only URL, DB has 10 Django framework tables and 1 row (the superuser). **No seed data, no mock data, no dashboard.**
- **Created `TASKS.md`** as the forward-looking tracker. `PROJECT_LOG.md` is now explicitly the backward-looking record.
- Clarified in `TASKS.md` the distinction most likely to cause confusion: **three parallel tracks** — A backend build (`app/`, P0→P8), B demo prototype (static, hardcoded, never touches the DB), C data acquisition (institute outreach, longest lead time). The "dashboard" belongs to Track B, not Track A. Also clarified that Track A seed data (syllabus tree, P0 day 6) and Track B demo data (`data.js`, §12.5) are completely separate things.
- Logged known doc drift: `TECHNICAL_DOC.md` / `SYSTEM_DESIGN.md` still say Django 5.x and port 5432/5433; reality is Django 6.1.1 on 5434.

### 2026-09-18
- **P0 Day 1 built.** Scaffold complete at `app/`. Environment realities found on this machine: **Python 3.14.3** (→ forces Django 6.x, not the 5.x in the docs), Docker Desktop installed but daemon stopped (launched it), **port 5432 has a local Postgres and 5433 has a `stocks_db` container → our DB is on 5434**. Installed: Django 6.1.1, psycopg 3.3.6 (cp314 binary wheel exists, no compile), django-environ 0.14.0. Created `config/` + five apps (`syllabus`, `tenancy`, `events`, `ingestion`, `derived`) with explicit `name`/`label` in each `apps.py`. **`AUTH_USER_MODEL = "tenancy.User"` set before the first migration** — verified: table is `auth_user_custom`, not `auth_user`. Postgres 16 container healthy. `git init` done at repo root; `.env` ignored, `.env.example` tracked, no venv/pycache leakage. Dev superuser `admin` / `devadmin123` (local only).
- **Created `SYSTEM_DESIGN.md`** for the user's collaborator to review — full Django schema with indexes/constraints, tenancy + RLS design, ingestion flow detail, volume estimates, what's deliberately not designed yet, and **8 open design questions** where review is most valuable (ltree vs adjacency, matview vs table, RLS belt-and-braces, partitioning key, `Attempt.correct` nullable vs enum, syllabus versioning granularity, mapping scope, under-designing check).

### 2026-09-30 — the console meets the live API

Three agents landed: backend (evidence linking), testing (58 reasoning tests),
frontend (live-API wiring). Merged to `main`. 147 backend tests, 11 frontend,
zero xfail.

**Five bugs found on first live contact, all the same shape: the mocks agreed
with the console instead of with the server.**

1. **`risk_score` is 0–1, the console banded it 0–100.** Verified in the
   database: max 0.696, so *zero* students banded as at-risk and the entire
   institute chipped "On track" — on the one screen whose job is to say who is
   not. Invisible because the fixtures shipped 0–100 values, so the console
   agreed with itself perfectly. The worst bug of the session.
2. Three hardcoded denominators ("of 300", "/100") against a paper out of 184.
3. `human_verdict` sends the literal `"unreviewed"`, not null — read as truthy,
   the card told teachers "You disagreed" about diagnoses they had never seen.
4. `trace_id` is an integer; the hand-written type guessed string, so `String()`
   gave `""` and the trace chip never rendered.
5. The "Demo dataset · 14 of 312 seeded" badge showed against a live server
   serving 46 real students — false in the direction that makes a real answer
   look staged.

**The `@action` routes flipped from bare arrays to paginated envelopes.** An
assumption that has now been wrong in *both* directions, so the client accepts
either rather than being hard-coded a third time.

**Three bugs the testing agent documented as strict xfails, now fixed:**
- The reasoning cache key ignored `prompt_version` — a v2 prompt would have kept
  serving v1 answers with nothing on screen to say so. Today's three rounds of
  prompt iteration only escaped it by passing `force=True` every time. `model` is
  deliberately excluded: a capacity fallback is incidental, not a change of intent.
- `from_cache` was always False (inferred from latency; a cache hit returns the
  original trace carrying the live call's latency).
- Wrong-answer stems matched on question label alone, so a diagnosis spanning two
  papers quoted a question the student never sat and cited it as evidence.

**Diagnosis verified on all four heroes: 4/4 correct misconception**, each with
distinct, correct counter-evidence. For Ishita it independently rediscovered why
a symmetric-alkene question was in the paper — the design intent, from the stem
alone. `gaps.ts` went from 16 entries to 2.

### 2026-09-30 (later) — the loop closes

Question detail panel landed: an evidence chip now opens the question behind
the citation. Verified live end-to-end —

```
diagnosis -> chip "D16 chose C" -> question 923
  "Nitration of toluene with a HNO3/H2SO4 mixture gives predominantly:"
      (B) o- and p-nitrotoluene      <- correct
      (C) m-nitrotoluene             <- he chose this   MIS-ORG-EAS
  BELIEF: "An activating group sends the incoming group to meta; a
           deactivating group sends it to ortho/para..."
  REMEDY: "Twenty minutes at the board on nitration of toluene and of
           nitrobenzene, drawing all three arenium-ion resonance structures"
```

That is the product: a claim, the evidence for it, the student's actual wrong
belief stated as they hold it, and what fixes it.

**A sixth mock-vs-server mismatch, same shape as the five before.** Fixtures
named paper 17 "AIT Mock 14" out of 300; the server calls it "Mock 15 —
Diagnostic" out of 184. Mock mode showed a paper that does not exist with the
wrong denominator. Fixed, and the diagnostic paper is now a named constant in
the fixtures so it cannot drift silently again.

**I also gave an agent a wrong field name** (`stem` for `question_text`) and
only caught it because my own verification script threw KeyError. The API was
right; my description of it was wrong. Corrected mid-flight. This is the
argument for the OpenAPI contract existing at all — prose descriptions of an
API drift, generated types do not.

Seven contract observations from building the panel, worth acting on:
- `options[].chosen` has three meanings across two values: null = not asked,
  false = either "not this option" or "no attempt exists". Only student_id +
  status disentangle it.
- 404 collapses "no such question" and "no such student in this institute".
- No max_marks on QuestionDetail, so "-1 mark" cannot become "-1 of 4".
- `remedy` optional while `description` is required — the actionable half is
  the optional one.
- `difficulty` unions BlankEnum.
- blank / not_reached branches are unreachable from a chip and undemoable.

### 2026-10-06 — first human review: "the platform looks good"

The user ran the full stack in a browser and judged it good. This closes the one
open question no automated test could answer — whether the running product reads
as convincing to a person, not just whether it functions. Up to now everything
had been verified in jsdom and through the API only.

Asked for a plain-language recap of how it works, what was built, and what comes
next. No code changes this prompt. The two dev servers from the last session were
stopped when that session ended; restart with `docker compose up -d`,
`manage.py runserver`, and `npm run dev`.

### 2026-10-07 — audit: how much of the educational data is real

User asked how JEE/NEET data, papers, mocks, syllabus, competition and syllabus
diversity were used. Checked the seed sources rather than answering from memory
(Docker was down; the data is fully defined by the seed files anyway).

**Honest finding: the data layer is almost entirely placeholder. The *analysis*
is real; the *educational content* it runs on is not.**

| Data | State |
|---|---|
| Exams | JEE Main only. **NEET does not exist** — appears in one prompt line and one code comment. No Biology. |
| Syllabus | 56 JEE Main chapters typed from memory, file header says PLACEHOLDER, never checked against the NTA PDF |
| Chapter weights | Guesses (4/8/12), not counted from past papers |
| Syllabus diversity | Per-institute versioned trees are built and working, but both institutes were seeded with the identical tree — capability exists, never exercised |
| Real past papers | **Zero.** Nothing downloaded from NTA |
| Mocks 8–14 | 7 papers × 75 questions with **no question text** — labels and right/wrong only |
| Diagnostic paper | 46 hand-written JEE-style questions, answer keys checked — the only real content |
| Student answers | 100% synthetic (24,000 + ~2,000 diagnostic) |
| Competition / rank / percentile | **None.** "AIR < 5000" is a text label never computed against |
| Public datasets (EdNet etc.) | Planned, never downloaded |

Acceptable for a prototype demonstrating the analysis. Not acceptable for a
pilot, or for any claim to a director about JEE/NEET coverage. Logged as the
next real gap: before any pitch, either fix it or state it plainly.

### 2026-10-07 (later) — scope set: JEE Main + NEET, real public data

**Product scope:** JEE Main, JEE Advanced, NEET. **Prototype:** NEET + JEE Main.
Real coaching data arrives only after a sale, so until then the product must run
on real *public* data — official syllabi, NCERT, past papers and answer keys.

User expected Gemini to "have all the data". Corrected: an LLM has a *memory* of
this material, unreliable exactly where it matters (exact wording of past
questions, answer keys on hard problems, marking rules, cutoffs). Live example
found while researching: published sources disagree on whether JEE Main
numerical questions carry negative marking — Gemini learned from that same web.

**Rule adopted: open book, not closed book.** Official documents are the source
of truth; Gemini is the reader, sorter, tagger and explainer working *from* those
documents, never from memory. Automatic check that makes this scale: Gemini
solves each past-paper question independently and is compared with NTA's official
answer key — agreement is accepted, disagreement goes to a human. People review
only the disagreements.

Verified facts (Sep 2026 searches): NEET UG 2026 — 180 compulsory MCQs, 720 marks,
+4/−1, Physics 45 · Chemistry 45 · Biology 90 (Botany 45 + Zoology 45), pen and
paper; NTA released the 2026 syllabus 8 Jan 2026. JEE Main 2026 — 75 questions,
25 per subject (20 MCQ + 5 numerical), 300 marks, +4/−1; negative marking on
numericals is reported inconsistently — take it from the official bulletin. NTA
publishes past papers and official answer keys (2021 onward) via its exam portals.

Proposed plan, awaiting go-ahead: (1) real syllabi + NEET + NCERT links,
(2) question factory over real past papers with answer-key cross-check,
(3) real chapter weights from counts, (4) realistic practice students on real
questions, (5) premium features — NCERT links, target-college ranks, practice
sets aimed at one mistake. Idea raised for the user to decide: free past-paper
practice for individual students, to collect real student data before any
institute signs.

### 2026-10-07 (later) — three agents started on real data

Goal restated by the user: this is a **prototype for a pitch**. What exists is
good; the aim is to show the product working and explain it convincingly. If
the real-data work turns out to be too much, fall back to the current prototype
and invest in explaining it well.

**Storage decided — three shelves**, documented in `data/README.md`:
1. `data/raw/` — official PDFs as downloaded + `manifest.json` (source, date,
   checksum). **Not in git.**
2. `data/extracted/` — what was read out of each PDF, with the cross-check
   result. **Not in git.**
3. `data/syllabus/` — official chapter trees with NCERT links. In git (it is
   structure, not content).
Then into the database, which is what the product reads. Exam content is kept
out of git because the GitHub repo is publicly readable.

**Agents running:**
- **Syllabus** — official JEE Main 2026 + NEET UG 2026 syllabi, every chapter
  traced to a PDF page, linked to NCERT; NEET added as an exam; loaded as a *new*
  syllabus version so the existing demo stays bound to version 1.
- **Question factory** — one real NEET paper + one JEE Main 2026 shift with
  official answer keys; Gemini reads and independently solves; compared with the
  official key; disagreements go to review. Owns the Gemini quota.
- **Frontend** — "How it works" and "Data & trust" pages for the pitch, built on
  live API data, honest about what is simulated.

Shared-tree rule this round: agents in the main tree may not switch branches or
commit (earlier rounds lost time to agents moving each other's HEAD).

### 2026-10-07 (later) — syllabus agent landed (verified)

Official trees built from NTA's own PDFs (4 files, all official links, no
mirrors), every chapter traced to a page. Verified in the database:

```
JEE_MAIN v1  active  56 chapters  NCERT 0    <- old placeholder, demo still bound here
JEE_MAIN v2  —       54 chapters  NCERT 51   <- official 2026
NEET_UG  v1  —       71 chapters  NCERT 68   <- official 2026, new exam
all four demo batches still on JEE_MAIN v1 — prototype untouched
```

**What the placeholder got wrong** (evidence it had to go): 43 of 56 chapter
names exactly right; 2 examined units missing (Experimental Skills, Practical
Chemistry); 3 units wrongly split into 7, one chapter ("Circles") invented as a
split; 6 misnamed; 9 of 12 unit groupings invented. All 56 weights were guesses.

**Two facts corrected:**
- **NEET Botany 45 / Zoology 45 is NOT stated by NTA.** The bulletin says only
  "Biology (Botany & Zoology), 90 questions". I had stated 45/45 as fact on the
  strength of coaching websites. Treat it as unconfirmed until checked against an
  official paper. Biology chapters are tagged Botany/Zoology: 17 by content, 14
  by coaching convention (flagged).
- **JEE Main numerical questions do carry −1** for a wrong answer — settled by the
  official bulletin (pp.17–18, 21), after websites disagreed.

**NCERT:** 51/54 JEE and 68/71 NEET chapters linked to the current rationalised
books (2026-27 reprint), each link checked against the chapter PDF's first page.
The 3 unlinked: p-Block Elements (no chapter in any current NCERT book, yet still
examined), Experimental Skills and Practical Chemistry (lab manuals).

**Blockers before any batch switches to the official trees:** views and
`seed_demo` hard-code Physics/Chemistry/Maths ("Mathematics" officially; NEET
adds Botany/Zoology); seeders look up the active syllabus without an exam filter.

**Rule broken, minor:** the agent made 5 Gemini calls while testing the API (a
diagnosis without `?paper=` misses the cache). Traces 68–72 kept — they are real
traces, and failures are training data too.

### 2026-10-07 (later) — frontend agent landed: explainer pages

`agent/frontend` @ `8fce1c6`, verified: typecheck clean, 21 tests pass. Not yet
merged — waiting for the question factory so one commit carries the whole round.

- **How it works** (`/how-it-works`) — the four steps (record · count · AI reads
  the pattern · teacher checks), each labelled with who does it and each shown
  on Aarav's live data: his full answer sheet, the counting, the live diagnosis
  with counter-evidence D22/D23 shown answered right, and the real question
  panel. If the AI is unreachable, steps 1–2 still render — they need no AI.
- **Data & trust** (`/trust`) — what's real vs simulated, open book, the
  answer-key cross-check (labelled "being built now", no figures shown), privacy
  shown side by side (Aarav's record vs the "S-1" the AI sees), and the system's
  own sum next to the AI's headline.
- Nav now scrolls below 1280px; previously the header overflowed at tablet width
  and the nav vanished below 768px.
- **Seventh mock-vs-server mismatch** fixed (mock summary pointed at Mock 14 /300
  instead of paper 17 /184). One left: Aarav's mock score history stops at Mock 14.

**Gap to fix first (for the pitch):** the counter-evidence questions D22/D23 come
back as words in a sentence, not linked ids — the line that sells the product is
the one line that cannot open its proof.

### 2026-10-08 — question factory landed: two real papers in (verified)

```
JEE Main 2026 · 02 Apr · Shift 1 · Official   75 q   66 agreed (88.0%)   9 disagreed    8 diagrams
NEET UG 2025 · Code 45 · Official            180 q  157 agreed (87.2%)  23 disagreed   24 diagrams
every question linked to a chapter of the official syllabus; demo data untouched
```

**No official answer key was wrong.** Of 32 disagreements: 2 were our reading
errors (JEE Q21 square-root placement, NEET Q44 options scrambled out of a 2×2
grid) — both caught *only* because of the cross-check, and would otherwise have
shown wrong content to a director. The rest are the model solving wrongly, or
figure questions a person should eyeball. This is the open-book rule paying off:
the AI's answers are checked against the official key, never trusted.

**Sourcing:** JEE paper and key both official NTA. NEET key official, but NTA
does not openly publish NEET papers — the paper is a Physics Wallah mirror. Its
booklet code was *proven*, not assumed: matches code 45 on 179/180 against NTA's
key, other codes at chance (38–43).

**Corrections to what I told the user:**
- **Free tier is 20 requests per model per day**, not ~500, and 503 "busy"
  responses appear to count against it. Processing thousands of questions on the
  free tier is not realistic; a small paid budget or batch processing is.
- Agreement proves the question and its correct option, not every wrong option
  (a spot-check found √ signs lost from two wrong options that still agreed).

**Findings worth keeping:** Gemini orders schema fields alphabetically, so the
solver wrote its answer before its working — forcing working first took the same
model from 6/10 to 8/10. LaTeX inside JSON was silently corrupted (`\theta`
arrived as a tab) in 23 of 30 early questions; repaired deterministically.

**Open:** a person must review the 32 disagreements; re-solve them on a full Flash
model when capacity returns; misconception drafts (657) are unconfirmed and of
mixed quality; **the console has no maths renderer, so real questions show raw
LaTeX** — must fix before showing them in a pitch.

Round committed in one commit: syllabus, factory, explainer pages merged.

### 2026-10-10 — plain-language status recap

User asked for a simple "how it works now / what next". No code changes. Pending
decision unchanged: run the NEET demo round (maths rendering, Biology on screens,
simulated students on the real NEET 2025 paper, clickable counter-evidence) or
pitch with the current prototype plus the explainer pages.

### 2026-10-10 (later) — `TECHNICAL_DOC.md` re-baselined to v3.0 against the code

User asked for the whole codebase and every `.md` file to be read, and the
technical doc updated to match what the project actually does. Four read-only
audit agents ran in parallel (backend core · content/AI pipeline · frontend ·
docs-and-history); I then re-verified every number I put in the doc myself.

**The doc was 15 days stale** (v2.0, 25 Sep): it still said "Tier B not started",
"question content is the blocker", "21 tables", "68 tests", "console has never
touched the live API". All five were false. Rewritten as v3.0 with a status
legend (built / built-with-a-limit / model-only / not started).

Verified facts now in the doc: **25 tables** (Django registry) · **28 paths / 29
operations** in `openapi.yaml` · **190 backend tests, all passing** (run this
session) · 21 frontend tests (counted, not run) · 15 misconception codes.

What the audit found that was **not** in any document before:
- **The question factory** (`manage.py factory …`) — the largest built subsystem
  — was in no spec. Now §8.1.
- **Mock-file ingestion (§8 in v2.0) is not built.** No parser, no column
  mapping, no student matching — only the two models. v2.0 presented it as the
  workflow. Now §8.2, marked not built.
- **Only 1 of 6 Tier B tasks runs.** The other five are enum constants.
- **Free tier is ~20 requests per model per day**, not 500.
- **Taxonomy is fragmenting:** the factory proposed "new" codes for 496/514 NEET
  and 153/162 JEE distractors (~490 distinct drafts) against a 15-code vocabulary.
- **Invariants are weaker than stated:** append-only is convention (DB role can
  UPDATE/DELETE); syllabus immutability is not enforced; `ingestion_questionoption`
  has no RLS policy; django-q2 is not installed (no scheduler at all).
- **A real bug:** the Intervene dialog says it closes the flag; the server
  deliberately does not, the UI never calls `/resolve/`, and only the MSW mock
  closes it. An eighth mock-vs-server mismatch, same shape as the first seven.

**One audit finding was wrong and was not carried into the doc:** the frontend
agent flagged `import { cn } from "cn"` as a bug. It is shadcn's own official `cn`
package, deliberately. Worth remembering that agent reports are claims to check.

**Not changed, and still stale:** `README.md` (says "Not built: the brain", 68
tests, 21 tables, "0 of 525") and `TASKS.md` (says the Gemini key is the next
step, 89 tests, "never touched live API"). The three docs now disagree, and
`TECHNICAL_DOC.md` is the one that matches the code. Also stale: code comments
that cite old TECHNICAL_DOC section numbers (§6.1–6.4, §8, §12.5, §14), and the
log's own "Current Status" block (still reads "Next step: Stage 1", 17 Sep).

### 2026-10-10 (later) — pitch preparation: study notes + git audit

User wants to be "strong in the concepts" and ready for any client question.
Two agents started:
- **Study notes** → `STUDY_NOTES.md`: how it works in five steps, key ideas
  explained simply, demo script, benefits by audience (director / teacher /
  student / parent), real vs simulated, verified numbers, 30+ client questions
  with honest answers, what not to claim, roadmap, glossary. Told to verify every
  number against the live database rather than the docs, and not to call Gemini.
- **Git audit** (read-only) → what's committed, pushed, left to commit; that
  `.env`, `data/raw/`, `data/extracted/` were never in history; and what exists
  only on this machine (real papers, DB contents) — i.e. what is lost if the
  laptop dies.

### 2026-10-10 (later) — git audit landed; data backed up

**Code is safe:** local `main` = GitHub `main` = `ab01c30`, 33 commits, nothing
unpushed. `app/.env`, `data/raw/`, `data/extracted/` were never in any commit;
full-history scan for API keys found none.

**The real risk was the data:** real papers, extracted questions and the whole
database existed only on this laptop, with no dump anywhere. The 195 Gemini
reasoning traces (the demo's offline cache) and the one mentor verdict could not
be recreated at all. `seed_demo --flush` would also wipe the traces, since they
cascade from students. **Backed up** to `E:\Student_AI_backups\` (outside the
repo): DB dump verified restorable (34 tables), plus `data/raw` and
`data/extracted` — 58 MB. Still on the same disk: needs copying off-machine to
protect against the laptop itself.

**My mistake, recorded:** 19 of 33 commits carry a `Co-Authored-By: Claude`
trailer. 9 predate the user's no-attribution rule; **10 came after it — all made
by subagents, because I never passed the rule into their briefs.** Already public.
Rewriting needs a force-push to a public repo — the user's decision. Saved as a
memory so every future agent brief carries the rule.

Other findings: `data/raw/manifest.json` (provenance + checksums, no exam
content) is ignored with the rest of `data/raw/` — worth committing via
`/data/raw/*` + `!/data/raw/manifest.json`. Five merged agent branches are stale.
The concept-note PDF and a work email are in public history.

### 2026-10-10 (later) — study notes landed; docs brought in line

`STUDY_NOTES.md` (733 lines) written for pitch preparation: the pitch, the
problem, five steps, key ideas, a 9-step demo script, benefits by audience,
real-vs-simulated, verified numbers, 40 client questions, what not to say,
roadmap, glossary. Every number checked against the live database; no Gemini
calls (hero diagnoses read from stored traces).

**What the notes agent corrected — including things I had said:**
- **46** students on screen, not 49 (49 spans both institutes).
- Of 26,024 answers, only **2,024** record the chosen option and can feed a
  diagnosis; the 525 questions in Mocks 8–14 have no text.
- **No upload screen exists** — so "it works from the results you already have"
  is the design, not a built feature. In a pilot we load the files ourselves.
- **Opening any non-hero student triggers a live Gemini call** — a real demo trap
  on a ~20/day free tier.
- Tanvi's and Ishita's totals (40, 35) exceed their headlines (25, 20) because of
  weaker secondary findings; lead with Aarav and Kunal.
- The 32 cross-check disagreements were reviewed by an agent, **not a person**.
- "Loop closed 100%" and Priya's 44%→67% are seeded, not real outcomes.
- The "Data & trust" page understates reality ("being added now").

`TECHNICAL_DOC.md` was rewritten to **v3.0** (re-baselined against the code) by
someone outside this chat — most likely the user's parallel session; kept as is.
`README.md` status, `TASKS.md` status/next steps/demo traps, and the
`gemini.py` free-tier comment (said 500/day) updated to match reality.
