# Student AI

**An AI tutor-analyst for Indian competitive-exam coaching institutes (JEE / NEET).**

It reads a coaching institute's test results, works out *what each student actually misunderstands* — not just what they scored — and tells a teacher what to do about it.

---

## The goal, stated plainly

Not a dashboard. Not a calculator with nice wording.

**A domain LLM for exam preparation** that does what a genuinely good teacher does when they look at a student's answer sheet:

> *"He didn't get Rotational Motion wrong. He got the **axis** wrong — four times, in the same way. On the two questions where the axis was given to him, he was fine. That's a twenty-minute fix, not a chapter re-read."*

That's reasoning, not arithmetic. It's the product.

And every time Gemini does that reasoning, **we keep the transcript** — so that over months we accumulate a training set and fine-tune our own model on it. Gemini is the teacher; our model is the apprentice.

---

## Where we are today — honest version (10 Oct 2026)

**A working prototype.** The AI diagnosis runs live, on simulated students, and the console shows it.

| ✅ Built and working | 🟡 Built, with a limit | ❌ Not built |
|---|---|---|
| AI diagnosis (Gemini) — found the right mistake for **4 of 4** test students | Runs on **simulated** students, 46 shown on screen | Upload screen for an institute's result files |
| Diagnostic paper: 46 questions, every wrong option labelled with its mistake (15 mistakes) | Diagnosis runs on our own paper, **not yet on the real ones** | NEET or Biology on any screen |
| Real papers loaded: **NEET 2025** (180 q) and **JEE Main 2026, 2 Apr S1** (75 q), checked against NTA's official keys (87–88% agreement, key upheld every time) | 32 cross-check disagreements reviewed by an agent, **not yet by a person** | Training our own model |
| Official JEE Main + NEET 2026 syllabi, linked to NCERT | Demo still uses the old placeholder JEE chapter list | Hosting — runs on this laptop |
| Director console, student page, clickable evidence, question panel, "How it works", "Data & trust" | Gemini free tier is **~20 requests per model per day** | |
| Privacy walls between institutes; no names sent to the AI | | |
| 190 backend + 21 frontend automatic tests, all passing | | |

### What changed the outcome

We used to store only *"student got Q17 wrong, topic = Rotational Motion"* — and from that any model can only say *"revise the chapter."* Recording **which option the student chose**, and what each wrong option means, is what made a real diagnosis possible. **The ceiling was the input, not the model.**

**Studying for a pitch?** Read [`STUDY_NOTES.md`](STUDY_NOTES.md).

---

## How the machine works — one answer, end to end

| # | What happens | Who does it |
|---|---|---|
| 1 | Aarav picks option **(C)** on Q17 | — |
| 2 | Look up what (C) means: *used the centre-of-mass axis instead of the end* | Lookup table |
| 3 | Count: same class of wrong option on 4 of 6 questions | Plain arithmetic |
| 4 | **Judge:** not "weak at rotation" — a specific, repeated axis-identification failure | **Gemini** |
| 5 | **Decide:** what to do, given 34 weeks left and this chapter's exam weight | **Gemini** |
| 6 | Write it for the teacher | **Gemini** |
| 7 | Log the whole thing as a training example | — |

**Steps 1–3 stay as counting.** They must be exactly right, and counting is free, instant and exact.
**Steps 4–6 are the product.** Real judgement.

Keeping them separate isn't a limit on the AI — it's what lets the AI reason over *exact* numbers instead of inventing them, which is what makes its judgement checkable by a human.

---

## Misconception tagging — the part competitors can't copy

Every wrong option gets labelled with **the specific mistake that produces it**:

```
Q17. A uniform rod of mass M, length L rotates about one end…
  (A) ML²/3    ✓ correct
  (B) ML²/12   ✗ MIS-ROT-AXIS   — used the centre-of-mass axis
  (C) ML²/2    ✗ MIS-ROT-DISC   — applied the disc formula to a rod
  (D) ML²      ✗ MIS-ROT-POINT  — treated it as a point mass
```

One student picking (B) once is noise.
**The same student picking `MIS-ROT-AXIS` four times is a diagnosis** — provable, quantifiable in marks, and fixable with targeted practice.

This is the vocabulary the whole reasoning layer speaks, and it's built from our own data. An API key doesn't get you it.

---

## Where the data comes from

| Source | What it gives | When |
|---|---|---|
| **We generate it** | Real JEE past papers (NTA publishes them, free) + misconception-tagged wrong options + fake students whose errors follow *consistent patterns* | **Start here, this week** |
| **Public datasets** | EdNet — 131M real answers from 780k test-prep students. Real human behaviour, not Indian | Free, available today |
| **A real institute** | ~1M real answers in our exact domain, from two years of their past papers | Free to ask, slow to arrange — **start the conversation now** |

> ⚠ **The fake data must contain the patterns we intend to detect.** Our current seed makes wrong answers by ranking on a hidden ability score, which produces students scoring a flat 0% and wrong answers with no structure. A diagnosis engine run over that finds nothing — because there's nothing there.

---

## Training our own model

**Not** building an LLM from scratch — that costs millions and buys nothing.

**Instead:** take a free open model you can download (Qwen, Llama), and show it thousands of examples of Gemini doing our one specific job. It learns that job, and then it's ours — free to run, and nobody else has it. This is called **fine-tuning**.

| Step | What happens | Cost |
|---|---|---|
| 1 | Gemini reasons. **Every call is logged** — input, output, reasoning | Free tier |
| 2 | Accumulate ~5,000 examples | Free |
| 3 | Rent a GPU for a few hours; fine-tune | ~$10–50 |
| 4 | Test: does ours agree with Gemini on unseen cases? | Free |
| 5 | Ours handles common cases, Gemini handles hard ones and keeps teaching | Cheaper over time |

**What makes our dataset better than raw Gemini output:** when a teacher confirms or rejects a diagnosis, a *guess* becomes a *human-verified example*. Nobody else has that.

**The order cannot be skipped:**
```
question content → Gemini can reason → traces accumulate → training becomes possible
```
We are at step zero.

---

## Build order — each step unblocks the next

| # | Build | Why it must come first |
|---|---|---|
| 1 | `Question` model — text, options, correct answer, solution | Nothing works without content |
| 2 | `Attempt.chosen_option` | No distractor analysis without it |
| 3 | Misconception taxonomy | The vocabulary diagnosis speaks |
| 4 | Generate realistic papers, misconception-tagged | Something to reason about |
| 5 | **Regenerate student answers so errors follow patterns** | Random wrongness has no pattern to find |
| 6 | `ReasoningTrace` — log every call | Traces not captured are gone forever |
| 7 | Gemini client + reasoning tasks | The product |
| 8 | Fine-tune harness | Our own model |

---

## Tech stack, in plain terms

| Part | What we use | What it's like | Alternatives, and why not |
|---|---|---|---|
| Storage | PostgreSQL | An organised, searchable filing cabinet | MySQL, MongoDB — Postgres has the strongest built-in privacy walls between customers |
| Backend | Python + Django | The engine room where calculations and rules run | Node, Java — Python owns the AI/data tooling |
| Screens | React + shadcn/ui | Pre-made good-looking building blocks | Vue, Angular — React is best-supported |
| Contract | OpenAPI | A shared recipe book so the screen team and engine team never disagree | Informal agreement — always drifts |
| Reasoning | **Google Gemini** | The experienced teacher doing the judging | GPT, Claude — Gemini has a usable free tier at our size |
| Our model | Qwen / Llama, fine-tuned | The apprentice learning from the teacher | Training from scratch — millions of dollars, no benefit |
| Hosting | Docker | A shipping container — runs identically anywhere | AWS/Azure — more expensive while small, easy to move to later |

Because reasoning and counting are cleanly separated, **Gemini can be swapped for another provider without touching any of the number-crunching.**

---

## Running it

```bash
cd app
docker compose up -d                                   # database
.venv\Scripts\python.exe manage.py runserver           # backend  → localhost:8000
.venv\Scripts\python.exe -m pytest -q                  # 68 tests

cd ../web && npm run dev                               # screens  → localhost:5173
```

Admin: `localhost:8000/admin/` · API docs: `localhost:8000/api/docs/`

---

## The documents

| File | What it's for |
|---|---|
| `README.md` | ← you are here. The goal, the stage, the plan |
| `TECHNICAL_DOC.md` | Full technical spec — architecture, schema, reasoning layer, workflow diagrams |
| `TASKS.md` | What to do next |
| `PROJECT_LOG.md` | Every decision and why |
| `LEARNING_PATH.md` | Skills and free resources |
| `STUDY_NOTES.md` | Founder's pitch preparation — the concepts in plain words, demo script, real vs simulated, verified numbers, 40 client questions with honest answers |
