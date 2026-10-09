# Student AI — Study Notes for the Founder

**Purpose:** be strong in the concepts, and ready for any question a coaching-institute director asks.
**As of:** 10 Oct 2026. Every number below was checked against the running system on that date (database, code and tests), not copied from older documents. How each was checked is in the appendix.

> **The older documents are out of date in places.** `README.md`, `TECHNICAL_DOC.md` and `TASKS.md` still say things like "the AI is not built", "24,000 answers", "68 tests" and "500 free requests a day". All of those are now wrong. Where they disagree with these notes, trust these notes and the latest entries of `PROJECT_LOG.md`.

---

## How to use these notes

Read everything once. Then re-read §1, §3, §4, §7, §9 and §10 until you can say them without looking.

**Three rules for the room:**

1. **Numbers come from counting, never from the AI.** If you quote a number, it should be one in §8.
2. **Say what is simulated before they ask.** Directors have been burned by vendors who overclaim. Being the honest one is a selling point.
3. **The line that sells is the counter-evidence** (§4.3). Practise explaining it until it feels natural.

**Contents**
1. The pitch · 2. The problem · 3. How it works, in five steps · 4. The key ideas · 5. What you can show today, and the demo script · 6. Benefits, by who gets them · 7. Real vs simulated · 8. Numbers to remember · 9. Client questions and honest answers · 10. What not to say · 11. What comes next · 12. Glossary · Appendix: how the numbers were checked

---

## 1. The pitch

### One sentence

> **Student AI reads an institute's mock-test answer sheets and tells each teacher which specific wrong idea is costing a student marks. It shows the questions that prove it and the one thing to do about it this week.**

### Thirty seconds

> "Every institute already knows *that* a student is slipping. Take Aarav, one of our demo students. Down 37 marks over seven mocks, Chemistry the problem. Nobody has time to find out *why*.
>
> We look at which wrong option he picked on each question. On our diagnostic paper, every tempting wrong option is labelled with the mistake that leads a student to choose it. The system counts exactly. Then an AI reads the pattern the way a good teacher would.
>
> For Aarav it found one thing. He has one rule in organic chemistry backwards. Five questions, 25 marks. And it found the proof that it's only that rule: on the two questions where the rule was printed in the question, he got them right. So it's a one-session fix, not a weak chapter.
>
> A teacher sees the evidence and agrees or disagrees, and the system learns from that. Today it runs on simulated students. We'd like to run it on your real results."

### If they remember one thing

**"Marks tell you *that*. We tell you *why*, and we show the proof."**

---

## 2. The problem

**Marks and ranks tell you *that* a student is struggling, not *why*.**
A typical report says: *Aarav, Chemistry down, Organic 40%.* The only possible advice is "revise Organic". That is a whole chapter, weeks of work, and it may not touch the real problem.

**The *why* is sitting in the answer sheet.** It is in *which* wrong option the student picked. A good teacher reading Aarav's sheet would notice: *"Every time the group on the ring speeds the reaction up, he picks the meta product. He has the directing rule backwards. One session at the board fixes it."*

**Nobody has time to read sheets like that.** For a batch of 300 students, one JEE Main mock is 300 × 75 = 22,500 answers. One NEET mock is 300 × 180 = 54,000. No teacher reads that for patterns after every mock. So:

- Teacher attention goes to the lowest scorers and the loudest students.
- The fixable mistakes of the middle of the class go unnoticed.
- Students re-read whole chapters to fix one wrong rule, and lose weeks doing it.

| What a marks report says | What a good teacher would say after reading the sheet |
|---|---|
| "Chemistry down. Organic 40%." | "He has the directing-effects rule backwards. It cost him 25 marks on this paper. When the question states the rule, he gets it right. Fix the rule in one session; don't re-teach the chapter." |

**Directors already have marks, ranks and percentiles from their test platform.** That is not the gap. The gap is the *why*, at scale.

---

## 3. How it works, in five steps

The running example is Aarav Mehta (simulated) on our 46-question diagnostic paper, **"Mock 15 — Diagnostic"**.

| # | Step | What happens, for Aarav | Who does it | Is AI involved? |
|---|---|---|---|---|
| 1 | **Record which option was picked** | On question D16 (nitration of toluene), Aarav picks (C) *m-nitrotoluene*. The correct answer is (B) *o- and p-nitrotoluene*. | The institute's test (OMR sheet or online test) records it. Our system stores it. | No |
| 2 | **Each wrong option carries a meaning** | Option (C) is labelled `MIS-ORG-EAS`. In plain words: *"thinks a group that speeds the reaction up sends the new group to the meta position"*. That is the reverse of the truth. | Done once per paper by a subject expert. The AI can draft labels, but a person confirms them. On the demo paper, we wrote and labelled every question ourselves. | Drafting only |
| 3 | **Exact counting** | Aarav made the same mistake on 5 of the 6 questions that offered it: 5 × 5 = 25 marks. The system also finds questions he got **right** in the same chapters where this mistake *couldn't* show up. | Plain code. | **No** |
| 4 | **The AI reads the pattern** | *"One reversed rule, not a weak chapter. Here is the proof. Fix it in one session."* | Google's Gemini AI. It sees "Student S-1", never Aarav's name. | **Yes, for judgement only** |
| 5 | **A teacher checks it, and the system learns** | The teacher opens D16, sees the question, the option chosen and the wrong belief behind it, then clicks *Agree* or *Disagree*. | A teacher. The verdict is saved next to the AI's reasoning. | No |

**Notice the shape.** The AI sits in one box out of five. The steps before it are human expertise and plain counting. The step after it is a teacher. That shape is the answer to *"why should I trust an AI?"*

> On screen, the **"How it works"** page shows these as **four** steps: *Record · Count · Explain · Check*. Step 2 above (each wrong option carries a meaning) is folded into "Record". It is the same process; we split it out here because it is the part competitors can't copy.

---

## 4. The key ideas

Each idea comes with a plain explanation, the Aarav example, and a sentence you can say in the room.

### 4.1 What a misconception is

**In plain words:** a misconception is a *wrong rule a student believes*. It is not a slip, and it is not "weak at the chapter". Because the rule is wrong in a consistent way, it produces the **same kind of wrong answer every time** it is triggered.

**Aarav's misconception:** In organic chemistry, when you add a new group to a benzene ring, the group already on the ring decides where the new one attaches. Aarav has that rule backwards.

**Our list:** we have written **15** misconceptions so far: Physics 5, Chemistry 6, Maths 4. Each has two parts:
- a **description**, written as the student would hold it (*"An activating group sends the incoming group to meta…"*);
- a **remedy**, written as a lesson a teacher can actually run (*"Twenty minutes at the board on nitration of toluene and of nitrobenzene, drawing all three resonance structures…"*).

**Say it like this:** *"A careless mistake is random. A misconception is a wrong rule, so it repeats. Repetition is something we can count."*

### 4.2 Why wrong options carry information

**In plain words:** a cross on the answer sheet tells you a mark was lost. *Which* wrong option was chosen tells you **why**. A well-written multiple-choice question has wrong options that tempt specific mistakes. If you label each wrong option with the mistake that leads to it, every wrong answer becomes a clue.

**Example (D16):**

| Option | Text | Meaning |
|---|---|---|
| (A) | No reaction under these conditions | — |
| **(B)** | **o- and p-nitrotoluene** | **Correct** |
| (C) | m-nitrotoluene | `MIS-ORG-EAS`: directing rule reversed. **Aarav chose this.** |
| (D) | An equimolar mixture of all three isomers | — |

One student picking (C) once is noise. **The same student picking the same kind of wrong option on 5 of 6 questions is a diagnosis.**

**Say it like this:** *"Most test software keeps a tick or a cross. We keep the option the student actually picked. That's where the 'why' is."*

**Careful:** this only works when the institute's results record *which option* was marked. A score alone is not enough (see Q28 in §9).

### 4.3 Counter-evidence: the most valuable line on the screen

**In plain words:** counter-evidence is the questions a student got **right** in the same chapter, where the wrong rule *could not* show up. Getting those right proves the student is **not** weak at the whole chapter. Something specific *triggers* the mistake.

**Aarav's counter-evidence:**
- **D22** said in the question: *"the –SO3H group is strongly deactivating and meta-directing…"* He got it right.
- **D23** said in the question: *"the –OH group of phenol is strongly activating and directs… ortho and para…"* He got it right.

So when the question **tells** him which way a group directs, he answers correctly. When he has to **work it out himself**, he reverses it. He knows the positions and the chemistry. One rule in his head is backwards.

**Why it is the most valuable line:** it changes the remedy and the cost.

| Without counter-evidence | With counter-evidence |
|---|---|
| "Weak at aromatic chemistry." | "Has one rule backwards. Gets it right when the rule is given." |
| Re-teach the chapter: weeks. | One session at the board on that rule. |
| A claim you have to take on trust. | A claim with its own proof attached. |

It is also what separates us from a generic "weak topics" report. Listing weaknesses is easy. *Narrowing* a weakness down to its trigger is what a good teacher does.

**Who does what:** the system (plain code) finds the candidate questions: same chapter, answered correctly, no option carrying that mistake. The AI reads those questions and explains *what was different about them*.

**Careful, and honest:**
- On our diagnostic paper we **built these questions in on purpose**. On a real institute paper they will occur naturally, but less neatly. When there are none, the card says so plainly: *"No counter-evidence on this paper… the weakness may be chapter-wide."*
- Today D22 and D23 appear **as words in the sentence**, not as clickable links. Making them clickable is in the next round (§11).

**Say it like this:** *"He's not weak at the chapter. When the question tells him the rule, he's right. So he doesn't need the chapter again. He needs one rule fixed. That's the difference between three weeks and one session."*

### 4.4 "The AI never does the maths"

**In plain words:** every number on screen is computed by ordinary code from the recorded answers. That includes scores, marks lost, accuracy and marks at stake. The AI's job is to **explain the pattern**, not to calculate.

**How it's enforced:**
- **Marks at stake** = 5 marks for each wrong answer the AI cites. That is the 4 marks not earned plus the 1-mark penalty. The *system* recounts this figure. The AI's own number is discarded.
- A citation only counts if it matches a wrong answer that this student actually gave on this paper. If the AI cites a question that doesn't match, it is shown as plain text and **counts for nothing**.
- On Aarav's card, the "Data & trust" page shows the sum: **D16 5 + D17 5 + D18 5 + D20 5 + D21 5 = 25 marks at stake. 5 of 5 of the AI's citations matched his answer sheet.**

**Why:** an AI can be fluent and wrong with numbers. Counting is free, instant and exact. Keeping the two apart is what lets a teacher check the AI's judgement against exact facts.

**Careful:** the **headline** is the AI's own sentence, so it can contain a number. On all four diagnoses so far, the headline's number matched the system's count for the main finding.

**Say it like this:** *"The AI never produces a number. It reads exact numbers and explains them."*

### 4.5 Open book, not closed book

**In plain words:** we never ask the AI to *remember* facts. Everything it reasons about is put in front of it: the question, the option chosen, and what each wrong option means. Syllabus, papers and answer keys come from **official documents** (NTA, NCERT). The AI reads and sorts those documents. It is never the *source* of a fact.

**Why it matters, with two real examples from building this:**
- Websites disagreed on whether JEE Main numerical questions carry negative marking. NTA's official bulletin settled it: **they do (−1)**. An AI trained on those websites could have said either.
- We had believed NEET Biology is split "45 Botany + 45 Zoology", because coaching websites say so. **NTA's bulletin does not say that.** It says "Biology (Botany & Zoology), 90 questions". We corrected ourselves.

**Say it like this:** *"An AI answering from memory can be fluent and wrong, and you can't see which. Ours works from the documents, like an open-book exam."*

### 4.6 The cross-check against NTA's official answer key

**In plain words:** when we load a real past paper, the AI solves every question **on its own, without seeing the answer**. We then compare its answer with NTA's official key.
- **They agree:** the question is accepted.
- **They disagree:** a person looks at it. People only review the disagreements, so their time goes where it's needed.

**The answer we store is always NTA's official answer.** The AI's answer is kept only for the check.

**Results so far:**

| Paper | Questions | AI agreed with NTA | Disagreed |
|---|---|---|---|
| JEE Main 2026 · 02 Apr · Shift 1 | 75 | 66 (**88.0%**) | 9 |
| NEET UG 2025 · Booklet Code 45 | 180 | 157 (**87.2%**) | 23 |

**What the 32 disagreements turned out to be:**
- NTA's key was right **every time**.
- **22:** the AI solved the question wrongly.
- **7:** questions built on a figure that the AI could not read reliably. A person should look at the figure.
- **2:** *our own* reading mistakes (a square root in the wrong place, and options scrambled out of a 2×2 grid). The cross-check is the only reason we caught them.
- **1:** wording ambiguous enough that the AI read it differently.

**What 88% means, and what it doesn't:**
- It does **not** mean "our data is 88% accurate". The stored answers are NTA's.
- It means the AI independently reached NTA's answer 88% of the time. The other 12% is exactly where a person needs to look.

**Honest gaps:**
- The 32 disagreements were reviewed by an **AI assistant, not yet by a person**. A person still has to sign them off.
- Agreement confirms the question and its correct answer, **not every wrong option's text**. A spot-check found √ signs lost from two wrong options that still "agreed".
- The solving was done on a lighter Gemini model because of free-tier limits. We plan to re-run the disagreements on a stronger model.

**Say it like this:** *"We never trust the AI's answer. We check it against NTA's key, and a person looks at every disagreement. The check even caught two of our own reading errors."*

### 4.7 Privacy: the AI sees "Student S-1", never a name

**In plain words:** the users are **minors**. Before anything goes to the AI, the system removes everything that identifies a child. The name is reattached only inside our own system, after the AI answers.

| The AI is given | The AI is never given |
|---|---|
| A code for the student, e.g. **"S-1"** | Name |
| The exam (JEE Main) and the paper's name | Roll number |
| For each wrong answer: the question text, the option chosen, the chapter, time taken, and what that option is labelled with | Phone, date of birth, contact details |
| For right answers: question number, option, chapter, time | Batch, mentor, institute name |
| What each mistake means, the counted marks, and the counter-evidence questions | |

**Checked on 10 Oct:** all **72** diagnosis requests ever stored. **None** contains a student name, roll number, institute name or mentor name.

**Why it's a hard rule:** on Google's free tier, Google's terms let it use what is sent to improve its products, with human review. That is how we read the terms in Sept 2026. So identity never goes.

**Careful, and honest:**
- The **question text and options do go to Google**. That is what the AI reads.
- "S-1" is a **code, not true anonymity**. Your own system can map it back to the child, and that is the point. Say "the AI never learns who the student is". Don't say "fully anonymous".

**Say it like this:** *"Your students are children, so this is a hard rule, not a setting. The AI sees 'Student S-1' and the answers. Never a name, roll number or phone number."*

### 4.8 Each institute's data is walled off from every other

**In plain words:** every row of data carries an institute tag. **The database itself** refuses to return rows that belong to another institute. This is a rule inside the database, not in our application code, so a programmer can't forget it. It's called *row-level security*.

**Analogy:** a bank vault where the vault door checks your key. It doesn't rely on the clerk remembering which locker is yours.

**Checked on 10 Oct** (`manage.py rls_check`, all passed):
- All **18 of 18** tables holding institute data are locked, plus **3** more locked through their parent table.
- Logged in as **Aarambh Classes**, the database shows 46 students and 26,024 answers. Logged in as **Pinnacle Academy**, it shows 3 students and 0 answers.
- With no institute set, it returns **0 rows**. It fails closed, not open.
- Trying to write a row into another institute's data: **refused**. Trying to edit another institute's student: **0 rows changed**.

**Say it like this:** *"One institute's staff cannot see another's students. That isn't a promise in our code. The database enforces it, and we test it."*

**Careful:** no independent security audit has been done. Don't say "certified" or "bank-grade".

### 4.9 Proving the pattern isn't luck

**In plain words:** any student who makes ten mistakes will show *some* clumping by chance. So we test whether each planted pattern is stronger than luck. For each simulated student with a planted mistake, we ask: on the questions that offered that bait, how often did *they* take it, compared with everyone else?

| Student (simulated) | Mistake | Took the bait | Classmates | Chance of this by luck |
|---|---|---|---|---|
| Aarav Mehta | Directing effects reversed | 5 of 6 (83%) | 21% | about 2 in 1,000 (p = 0.0018) |
| Kunal Deshpande | Wrong axis of rotation | 5 of 6 (83%) | 17% | under 1 in 1,000 (p = 0.0008) |
| Tanvi Shah | Chain rule inner derivative dropped | 5 of 6 (83%) | 21% | about 2 in 1,000 (p = 0.0018) |
| Ishita Rao | Markovnikov rule misapplied | 4 of 5 (80%) | 13% | about 1 in 1,000 (p = 0.0013) |

**The control test:** we search **every other student** for the strongest clump that pure noise produced. The best is Gaurav Sinha: 2 of 3, with p = 0.051. **That fails the bar**, and his errors are spread over four unrelated mistakes. This contrast is what makes the four planted patterns meaningful.

**Honest framing:** we *planted* these patterns in simulated students. This proves the machine finds a real pattern when one exists, and that noise doesn't look like one. **It does not prove how often real students have patterns this clean.** Only a pilot on real results can show that.

### 4.10 Why Gemini, and the plan to train our own model

**Why Gemini (Google's AI) today:**
- It has a usable free tier at prototype size, and it reliably returns structured answers.
- **It is replaceable.** All AI calls go through one small module. Switching to another provider doesn't touch any of the counting. That matters: Google changed its terms twice in 2026 (its top "Pro" models left the free tier in April).

**The free tier is tight. We measured it, and it is fine for a prototype, not for a pilot:**
- The limit is **20 requests per model per day**, according to Google's own error message.
- Of **195** AI requests logged so far, **70 succeeded** and **125 failed**. 110 of the failures were Google saying its servers were busy.
- Every finished diagnosis is saved and replayed, so the demo doesn't depend on Google being up. A pilot needs a paid plan.

**Our own model, the plan:**
- **Not built from scratch.** That costs millions and gains nothing.
- Take an existing **open model** (free to download, e.g. Qwen or Llama, ~8 billion parameters) and **fine-tune** it. Fine-tuning means showing it thousands of examples of this one job until it can do the job itself.
- The best examples are **teacher-confirmed**: the AI's diagnosis plus a real teacher's "agree" or "disagree". Nobody else has those for JEE/NEET. That's the long-term moat.
- The plan's first milestone is about **5,000** examples for this one task.

**Where we are, honestly:** 14 successful AI diagnoses, all on the four planted students (most are repeat runs on Aarav while we tuned the instructions). **Zero real teacher-confirmed examples.** One "agree" was recorded, by us, while testing. Our own model is a **plan**, not a product.

**Say it like this:** *"Today Google's Gemini does the judgement. Every judgement is saved, and every time your teacher agrees or disagrees, that becomes a checked example. Those examples are how we'll train our own model. We'll start from an existing open model, not build one from scratch."*

### 4.11 Where the marks went: the five buckets (no AI)

This is a separate, rule-based screen ("Mock intelligence"). For each paper it sorts every lost mark into one of five buckets:

| Bucket | Meaning | What fixes it |
|---|---|---|
| Conceptual gap | Wrong, and the student was already weak on that topic | Teaching |
| Execution error | Wrong, though the student is strong on the topic and took normal time | Drilling |
| Time exhaustion | Never reached; the clock ran out | Paper strategy |
| Avoidable skip | Skipped, though the student has shown they can do it | Paper strategy |
| Not enough evidence | Too few past attempts on that chapter to say | **No call made** |

**Aarav, Mock 14 (simulated):** he lost 166 marks. The system can explain 90 of them. **61 of those 90 can be recovered without learning anything new**: 56 went to the clock (he attempted 46 of 75 questions) and 5 to slips. Only 29 went to genuine gaps. The other 76 marks come from chapters he has barely attempted, so they're shown in grey as "not enough evidence". The system refuses to guess.

**Say it like this:** *"Where the system doesn't have enough evidence, it says so instead of guessing. A director knows which students haven't opened a chapter yet, and would catch us if we pretended."*

---

## 5. What you can show today, and the demo script

### 5.1 The screens

| Screen | How to get there | What it shows | AI? |
|---|---|---|---|
| **Director console** | Home page | Institute summary strip, "Students who need you this week" (flags with evidence), "Recently closed" | No (rule-based flags) |
| **Student 360** | Click a student, or "Student 360" in the menu (opens Aarav) | **AI diagnosis card** at the top, then mock trend, study time vs marks lost, open flags, topic mastery, day plan | Diagnosis card only |
| **Question panel** | Click an evidence chip (e.g. "D16") on the diagnosis card | The question, every option, the one chosen, the correct one, the belief behind the wrong option, the remedy | No |
| **Mock intelligence** | **No menu link.** Type `/students/1/mock/7` (Aarav, Mock 14) | The five buckets of lost marks (§4.11) | No |
| **How it works** | Menu | The four steps, live on Aarav's data | Step 3 only |
| **Data & trust** | Menu | Real vs simulated table, open book, the answer-key cross-check, privacy side by side, "who counted what" | Shows the AI's headline next to the system's sum |

**Not on any screen yet:** the two real past papers (formulas show as raw code until we add formula display), anything NEET or Biology, a student app, parent reports, a results-file upload.

### 5.2 Before the meeting (one-time setup, about 10 minutes)

1. Start **Docker Desktop**.
2. Terminal 1:
   ```
   cd E:\Student_AI\app
   docker compose up -d
   .venv\Scripts\python.exe manage.py runserver
   ```
3. Terminal 2:
   ```
   cd E:\Student_AI\web
   npm run dev
   ```
4. Open `http://localhost:5173`. Log in with the demo mentor account `aarambh.bhatia`. The demo password is set in `seed_demo`; ask the developer, and keep it local. The top of the screen should say **Aarambh Classes**.
5. Rehearse once. Open Aarav, Kunal, Tanvi and Ishita. Each AI card should show a **"Cached"** badge and a trace number: Aarav #67, Kunal #56, Tanvi #61, Ishita #64.
6. You don't need internet for the demo. Everything runs on the laptop, and the four diagnoses are saved.

### 5.3 The demo script (core: about 10 minutes)

| # | Click | Say | Watch out |
|---|---|---|---|
| 1 | **Director console** (home) | "This is the director's Monday screen. Top strip: students on the roster, the average on the latest paper (about 98 of 184 on our diagnostic paper), and revisions overdue. Below: students who need you this week. Every row carries the evidence that raised it." | All of this is simulated. There are 80 open flags because the data is synthetic and the thresholds haven't been tuned on real data. **Don't quote "Loop closed 100%"**: it is one seeded example. |
| 2 | Point at **Aarav Mehta's** row: *"Down 37 marks over 7 mocks. Chemistry is 11% of study time but 46% of marks lost."* | "This is roughly what good analytics gives you today: *that* he's slipping, and *where*. It doesn't tell you *why*." | This story is simulated. |
| 3 | Click **Aarav** (opens Student 360) | "Right under his name, above every chart, is the AI diagnosis." Read the headline: *"Reverses electrophilic aromatic substitution directing effects when not explicitly stated — 25 marks lost."* Then translate: "In plain words: the group on a benzene ring decides where a new group attaches, and he has that rule backwards. 25 marks at stake. One session to fix." | The "Cached" badge is a feature: "Same answers always give the same saved diagnosis. Consistent, and no repeat cost." |
| 4 | Click evidence chip **D16** | "Every claim cites its questions. Here's D16: nitration of toluene. Correct is (B). He chose (C), meta. And here's the belief behind that option, in the student's own terms, and the remedy a teacher can run. Your teacher doesn't have to trust us. They can open every question." | |
| 5 | Point at **"Why this is a trigger, not a topic gap"** | Read the counter-evidence: *D22 and D23… the directing effect was stated in the question… answered correctly.* "This is the most important line on the page. When the question tells him the rule, he's right. So he doesn't need the chapter re-taught. He needs one rule fixed. That's three weeks versus one session." | D22 and D23 aren't clickable yet. |
| 6 | Point at **"Do this week"** and the **Agree / Disagree** buttons | "One instruction a teacher can act on tomorrow. And the teacher has the last word. That verdict is saved next to the AI's reasoning, and those checked examples are what we'll train our own model on." | **Don't click** unless you mean it. It records a real verdict. |
| 7 | Menu → **How it works** | At the four boxes: "Record, Count, Explain, Check, and who does each. The AI is in exactly one box. The first two are plain code. The last is your teacher." Scroll to step 2: "Every number is counted, never guessed." | |
| 8 | Menu → **Data & trust** | Top table: "We label what's simulated, what's ours and what's real." Say the honest sentence from §7. Privacy panel: "Left is your record: Aarav Mehta, roll A-1041. Right is what the AI is given: S-1." "Who counted what": "Five questions, five marks each, 25. All five of the AI's citations matched his answer sheet." | The past-papers row says "being added now" with no figures. That page was written before the import finished. Say: "Two real papers are now loaded, JEE Main 2026 and NEET 2025, and cross-checked against NTA's key at 88% and 87%. They aren't on screen yet because we haven't added formula display." |
| 9 | Close | "Everything you've seen runs on simulated students. What we can't show you is *your* students. That's what we're asking for." | |

**Optional extras (2–3 minutes each):**

| Click | Say |
|---|---|
| Student switcher → **Kunal Deshpande** | "A different student, subject and mistake: he uses the textbook moment-of-inertia formula whatever axis the question names. Same structure, same kind of proof. 25 marks." |
| Type `/students/1/mock/7` | The five buckets (§4.11): "61 of the 90 marks we can explain are recoverable without learning anything new. And look at the grey: the system refuses to judge 76 marks from chapters he's barely attempted." |
| Log out, log in as `pinnacle.rao` (Pinnacle Academy) | "A different institute. Three students, none of Aarambh's. Aarav's page won't load here: to this institute he doesn't exist. The database enforces that." |

### 5.4 Traps to avoid in a live demo

| Trap | Why | What to do |
|---|---|---|
| Opening any student **other than** Aarav, Kunal, Tanvi or Ishita | Their diagnosis isn't saved, so the page makes a **live AI call**. It can take up to two minutes or fail on the free tier, and it uses up quota. | Stay on the four. If you do open another, the card shows a clean message, not a crash. |
| The trend chart caption says *"each subject is marked out of 100 across 8 mocks"* | False for the diagnostic paper, which is out of 184. Aarav's 134 on Mock 15 is out of 184, not 300. | Talk about **Mocks 8–14 (out of 300): 171 → 134**. |
| **Tanvi's** and **Ishita's** cards show extra low- or medium-confidence findings (totals of 40 and 35 marks across 3–4 findings) | Each extra finding rests on one or two questions. It's honest labelling, but harder to explain in a hurry. | Lead with **Aarav** and **Kunal**: one clean finding each. |
| "Recently closed": Priya Nair, *"Accuracy 44% → 67% after mentor contact"* | Seeded story, not a real outcome. | Don't quote it. |
| Clicking **Agree/Disagree** | It writes a real verdict into the training record. | Show the buttons, don't click. |

---

## 6. Benefits, by who gets them

**Be concrete.** "Saves time" is weak. Say *what* it saves and *why*.

### The director (the buyer)
- **Knows who needs attention this week, and why**, from one screen. Every flag carries its evidence, so a mentor's call to a student has something specific to say.
- **Spends faculty hours where they pay.** "Re-teach Organic to 60 students" becomes "one session on one rule". Because every diagnosis uses the same labels, students who share a mistake can be grouped for one session. *(The grouping screen isn't built yet.)*
- **A different story for parents and the market:** "we tell your child exactly what's wrong and fix it", not just ranks.
- **A result he can hold us to.** "Of the students flagged, how many recovered after a mentor acted." *(To be measured in the pilot. There is no real figure yet.)*
- **No new data entry for students.** The core diagnosis runs on result files the institute already produces. *(The importer isn't built; in a pilot we load the files.)*

### The mentor or teacher
- **A 30-second read per student:** the wrong belief, the marks it costs, one action. *(Designed for 30 seconds; not yet measured with real teachers.)*
- **Checkable in a minute:** every claim opens to the actual question and the option the student chose.
- **A remedy they can run**, e.g. *"draw the three resonance structures for toluene and nitrobenzene at the board"*, instead of "revise the chapter".
- **No sheet-reading.** Spotting the pattern across 46 questions × 44 students is the system's job.
- **Their judgement counts.** Agree or disagree is saved and becomes training material.
- **It is allowed to say "no clear pattern"**, so teachers don't chase patterns that aren't there. *(Designed in. Not yet shown live on a student without a pattern.)*

### The student
- **Fixes one wrong rule instead of re-reading a chapter.** For Aarav that's one session for 25 marks on this paper.
- **Hears what they already know.** Counter-evidence says "you get it right when the rule is given". That's motivating; "weak in Organic" is not.
- **Practice aimed at their exact mistake** later. *(Practice generation is planned, not built.)*
- *(No student app yet. Today the benefit reaches the student through the teacher.)*

### The parent
- **A specific conversation:** "one rule, about 25 marks on this paper, one session to fix", instead of "needs to work harder".
- **Their child's identity never goes to the AI**, which matters because the child is a minor.
- *(No parent report yet. It is planned.)*

---

## 7. Real vs simulated

| Item | Status | Detail |
|---|---|---|
| Students | **Simulated** | 49 in total: 46 in the demo institute "Aarambh Classes" (44 active, 2 marked as left) and 3 in "Pinnacle Academy", which exists to prove the walls between institutes. Four have planted mistake patterns: Aarav, Kunal, Tanvi, Ishita. |
| Their answers | **Simulated** | 26,024 in total. 24,000 on seven practice mocks (Mocks 8–14) record **right or wrong only**: no option chosen, no question text. 2,024 on the diagnostic paper record **the option chosen**. Only these 2,024 feed the AI diagnosis. |
| Study logs, confidence ratings, revisions, and the flag stories (Aarav's −37 and "11% vs 46%", Priya's 44% → 67%) | **Simulated** | Generated to make the screens realistic. |
| Mocks 8–14 papers | **Placeholder** | Labels and chapters only. No question text. |
| **Mock 15 — Diagnostic** (46 questions, 184 marks) | **Our own** | Written by us in JEE style (Physics 15, Chemistry 16, Maths 15). Answer keys checked by hand. |
| 15 misconceptions; 63 labelled wrong options (on 40 of the 46 questions) | **Our own** | Written by us. |
| Syllabus the demo uses | **Placeholder** | An older JEE Main chapter list (56 chapters) typed from memory. The official one is loaded but not yet switched on for the demo. |
| Official syllabi: JEE Main 2026 (54 chapters) and NEET UG 2026 (71 chapters) | **Real (NTA)** | Every chapter traced to a page of NTA's PDF. NCERT-linked: 51 of 54 and 68 of 71. Not yet used by the demo screens. |
| JEE Main 2026 · 02 Apr · Shift 1 | **Real**: NTA's paper and NTA's key | 75 questions loaded and cross-checked (88%). Not on screen. |
| NEET UG 2025 · Code 45 | **Real NTA key.** The paper copy is from a public mirror (Physics Wallah), because NTA doesn't openly publish NEET papers. | 180 questions loaded and cross-checked (87%). We proved the booklet code: the copy matches NTA's Code 45 key on 179 of 180 answers; other codes match only 38–43. Not on screen. |
| AI-drafted labels for wrong options on the real papers | **Draft** | 657 drafts, **none confirmed**, and none used in any diagnosis. |
| The AI's diagnoses | **Real AI output, on simulated answers** | Produced by Google Gemini and saved. 4 of 4 planted patterns found. |
| Teacher verdicts | **None real** | One "agree", clicked by us while testing. |
| Rule-based flags (81) | **Real rules, simulated data** | 8 kinds of check (weak topic, revision overdue, plateau, and so on). |
| Walls between institutes | **Real, verified** | §4.8 |
| Hosting | **None yet** | Runs on the laptop. |
| Results-file upload | **Not built** | Designed, not built. |

### The exact honest sentence

> **"The students and their answers in this demo are simulated. We built them with realistic mistake patterns so you can see what the system finds. The diagnostic paper and its mistake labels are our own. The syllabi and the two past papers are official NTA material. The AI's diagnoses are real: the AI produced them on those simulated answers. The one thing we can't show you yet is your own students, and that's what we're asking for."**

---

## 8. Numbers to remember

Only verified numbers. **If you're unsure of a number in the room, don't say it.**

| Number | What it is |
|---|---|
| **49** | Simulated students in total. **46** in the demo institute; **44** sat the latest paper. |
| **26,024** | Simulated answers. Only **2,024** of them (the diagnostic paper) record which option was chosen. |
| **46 questions · 184 marks** | "Mock 15 — Diagnostic". Physics 15 / Chemistry 16 / Maths 15. +4 / −1. |
| **15** | Misconceptions written so far (Physics 5, Chemistry 6, Maths 4; no Biology yet). |
| **63** | Wrong options labelled with a misconception, on 40 of 46 questions. |
| **4 of 4** | Planted patterns the AI identified correctly, each with the right counter-evidence. |
| **5 of 6 vs 21%** | Aarav took his mistake's bait on 5 of 6 chances; his classmates did on 21% of chances. About a 2-in-1,000 chance by luck. |
| **25 marks** | Aarav's marks at stake: 5 questions × 5 marks. |
| **5 marks** | The cost of one wrong answer on a +4/−1 paper: 4 not earned plus 1 deducted. |
| **171 → 134** | Aarav's scores over Mocks 8–14, out of 300 (simulated). |
| **75 questions · 88.0%** | JEE Main 2026 (02 Apr, Shift 1). AI agreed with NTA's key on 66. |
| **180 questions · 87.2%** | NEET UG 2025 (Code 45). AI agreed with NTA's key on 157. |
| **32 → 0** | Disagreements, and how many turned out to be NTA errors. |
| **54 / 71** | Chapters in the official JEE Main 2026 / NEET UG 2026 syllabi. **51 / 68** are linked to NCERT. |
| **18 of 18** | Tables with institute data that are locked by the database (plus 3 locked indirectly). |
| **0 of 72** | AI requests that contained a student name, roll number, institute or mentor name. |
| **20** | Google free-tier requests per model per day. |
| **190 + 21** | Automated tests (engine + screens), all passing on 10 Oct. |
| **~5.5 seconds** | Typical (median) time for a live AI diagnosis. The range was 2 s to about 2 min when Google was busy. |

---

## 9. Client questions and honest answers

### A. What it is

**1. "In one line, what does it do?"**
It reads your mock results, specifically which option each student picked, and tells your teachers which wrong idea is costing each student marks. It shows the proof and gives one thing to do about it.

**2. "Isn't this just ChatGPT?"**
No. ChatGPT only sees what you paste into it. Our AI does one step out of five. The other four are ours:
- recording which option each student picked;
- the labels that say what each wrong option means;
- exact counting, including which questions the student got *right* where the mistake couldn't show;
- a teacher checking the result.

The AI is given exact facts, never asked to remember or calculate, and never told who the student is. Its claims must cite real answers, and the system recounts every number. Pasting answer sheets into ChatGPT would also mean sending children's names to it.

**3. "How is this different from what Allen, Aakash or PW already give students?"**
I won't speak for their products; I'd rather not guess. What I can say is what a marks-and-ranks report does and doesn't do. It tells a student their score, rank, percentile and chapter-wise accuracy. It doesn't:
- say *which wrong idea* produced their wrong answers;
- prove it from their own answer sheet;
- show where the idea *doesn't* fire;
- tell the teacher what single session to run.

That's the layer we add, on top of whatever test platform you use.

**4. "We already have a test platform."**
Good, keep it. We're not a test platform and don't want to be. We need its result export, ideally including which option each student marked. We add the "why" on top.

**5. "Can it predict ranks?"**
No, and deliberately. A rank depends on lakhs of other candidates, on that year's paper, and on NTA's percentile system across shifts. None of that is in your mock data. Any rank we printed would be a guess with a decimal point. We'd rather tell you which marks are recoverable and how, because your teachers can act on that. *(The "AIR < 5000" you may see on a student is just a target the institute records. Nothing computes it.)*

**6. "Does it work for NEET?"**
The groundwork is in, but we haven't shown it working on NEET yet:
- NTA's official NEET UG 2026 syllabus is loaded: 71 chapters, 68 linked to NCERT.
- One real NEET 2025 paper is loaded and cross-checked against NTA's key (87%).

What's missing: no simulated NEET students yet, no confirmed Biology misconceptions, and Biology isn't on the screens yet. That's our next round (§11). NEET suits this method very well: all 180 questions are multiple choice, so every wrong answer carries meaning.

**7. "What about numerical questions with no options?"**
The option method needs options. In JEE Main, 15 of the 75 questions are numerical (5 per subject), so the method covers the other 60. NEET is entirely multiple choice. Diagnosing numerical answers is possible later, by mapping common wrong values to mistakes, but it isn't built.

**8. "JEE Advanced? Boards? CUET?"**
JEE Advanced is in the product's intended scope, but the prototype doesn't cover it; its question formats are more varied. We haven't worked on Boards or CUET.

### B. Trust and accuracy

**9. "What if the AI is wrong?"**
It can be, which is why there are five protections:
1. Every claim cites the questions it rests on, and a teacher can open each one.
2. All numbers are counted by code, not by the AI.
3. A citation that doesn't match an actual wrong answer is shown as plain text and counts for nothing.
4. The AI labels its confidence. Weaker findings resting on one question are marked "low confidence".
5. The teacher has the last word: agree or disagree, and that is recorded.

**10. "How do you know it found the *right* misconception?"**
We planted known mistake patterns in four simulated students. The AI named the correct one for **all four**, each with correct counter-evidence. We also checked the reverse: the strongest "pattern" that random noise produced, across every other student, fails our statistical bar.

**11. "Why should we trust a prototype?"**
Don't trust it; check it. Every claim opens to the question behind it. The numbers are counted, not generated. Every diagnosis is saved with a number, so it can be reproduced. Where something is simulated, the screen says so. It has 190 automated checks on the engine and 21 on the screens. And we're asking for a pilot precisely so you can judge it on your own students before you pay anything.

**12. "Your students are fake. How do I know it works on real ones?"**
You don't yet, and neither do we. That's the honest answer. What we've shown is that when a pattern exists, the system finds it and proves it, and that noise doesn't pass as a pattern. What we haven't shown is how often real students have patterns this clean. A pilot on results you already have answers exactly that, before you change anything in your classes.

**13. "Can the AI make things up?"**
We set it up so it can't make up *facts*. It works open-book from the actual question, options and answers, and from official NTA and NCERT documents. It is never asked to recall a syllabus or an answer from memory. Its *judgement* can still be wrong (see Q9). That's why the evidence is attached and a teacher checks it.

**14. "How accurate are your past papers and answer keys?"**
The stored answers are NTA's own official keys, not the AI's. As a check, the AI solved every question independently. It agreed with NTA on 88% (JEE Main 2026) and 87% (NEET 2025). In all 32 disagreements NTA was right. Two of them were our own reading errors, caught only because of this check. A person still needs to sign off those 32.

**15. "What if the student just guessed?"**
One wrong option once is noise, and we never diagnose from one answer. A guesser spreads across the options. A misconception picks the same *kind* of wrong option again and again. Aarav took that specific bait on 5 of 6 chances; his classmates took it 21% of the time.

**16. "What if the labels on the wrong options are wrong?"**
Then the diagnosis inherits the mistake. That's why a subject expert writes or confirms the labels, and why the teacher can disagree. On the real past papers the AI has drafted 657 labels. None are confirmed yet, and none are used in a diagnosis until a person confirms them.

**17. "Will it invent a pattern when there isn't one?"**
It's explicitly told it may say "no clear pattern; this looks like scattered carelessness", and the screen has a designed state for that. In our data, the strongest pattern pure noise produced fails our statistical bar. Honestly, we haven't yet shown you the AI saying "no pattern" live on a student. That's on the list.

### C. Data, privacy and security

**18. "Is our students' data safe? Is it sent to Google?"**
- **Names, roll numbers and contact details never leave our system.** The AI sees "Student S-1". We checked all 72 AI requests stored so far, and none contains a name, roll number, institute or teacher name.
- **What does go to Google** is paper content: the questions and the options chosen, because that's what the AI reads.
- **Each institute's data is walled off** inside the database itself.
- **Hosting:** today it runs on our own machine. For a pilot we plan to host it in India.

**19. "Will our own question papers go to Google?"**
The questions involved in a diagnosis, yes: the ones a student got wrong and a few they got right. With no student identity. If that's a concern for your papers, tell us. A paid Google plan has different data terms from the free tier, and we'll show you the exact terms. Later, our own model would run on our own servers.

**20. "Who owns the data?"**
You do. Your students' records are yours, and we'd put that in writing in the pilot agreement, including what happens to the data if you leave. We'll also ask, in writing, for permission to use anonymised, teacher-checked examples to improve our model. We'd rather raise that now than surprise you later. *(No agreement template exists yet. Decide your terms before the meeting.)*

**21. "Can other institutes see our data?"**
No. The database refuses to return another institute's rows. We test that: one institute sees its 46 students and 26,024 answers, the other sees 3 and 0. A request with no institute set gets nothing. Writing into another institute's data is refused.

**22. "Where is the data stored?"**
Today, on our own machine. It isn't hosted anywhere yet. The plan is servers in India, because the users are minors and India's data-protection law (DPDP) matters here.

**23. "Are you DPDP compliant? What about parental consent?"**
We've designed for it: identity never goes to the AI, data is walled per institute, and hosting is planned in India. We haven't had a formal legal review. Consent and data terms are part of preparing a pilot with you. *(Don't claim compliance.)*

**24. "Will you use our data to train your AI?"**
Only with your written permission, only anonymised, and mainly the examples your teachers have checked. That permission would be in the pilot agreement.

### D. Operations

**25. "Who is going to enter all this data?"**
Nobody new. The diagnosis starts from result files your test platform or OMR vendor already produces. Students don't need to log anything for it. The one-time work is per paper: labelling what each wrong option means. The AI drafts that and a subject teacher confirms it, and in a pilot we do it with you. To be honest, the upload screen for result files isn't built yet. For a pilot we'd load your files ourselves. *(Some optional extras, like study time versus marks, need student-logged data. In the demo that data is simulated.)*

**26. "What do you need from us?"**
1. Past mock results, ideally including **which option each student marked**.
2. The question papers and answer keys for those mocks.
3. The student roster.
4. One or two subject teachers to review diagnoses and click agree or disagree.
5. A short written data agreement.

**27. "How long to set up?"**
Honestly, we haven't set up a real institute yet, so I won't give you a number I can't stand behind. The work is loading your results, labelling the wrong options of each paper once, and giving your teachers logins. Once we've seen your files, we'll give you a written timeline.

**28. "Our results only have scores, or right and wrong."**
Then the counting, the five buckets and the flags still work, but the AI diagnosis needs to know which option was marked. Many OMR and online systems record it. Let's check your export together.

**29. "Who labels the wrong options for our papers?"**
Once per paper: the AI drafts a label for each wrong option and a subject teacher confirms or corrects it. It's stored permanently, so it pays off for every student who sits that paper. In a pilot we do it with your teachers. We haven't timed this on a real paper yet.

**30. "How much teacher time does it take?"**
Each card is designed to be read in about 30 seconds: headline, cost, one action. Agreeing or disagreeing is one click. The labelling work is per paper, not per student. We'll measure real times in the pilot.

**31. "Does it replace teachers?"**
No. It does the reading and counting nobody has time for, and hands the teacher a claim with proof. The teacher decides, and the teacher's decision is what the system learns from.

**32. "Our papers aren't +4/−1."**
The marks-lost counting reads each paper's own marking scheme. The diagnosis card's "marks at stake" currently assumes +4/−1. Other schemes need a small, planned change.

**33. "How fast is it?"**
A live diagnosis typically takes about five seconds. When Google's servers were busy it took up to about two minutes. Once made, it's saved and opens instantly, and the same answers always return the same saved result. The plan is to run all diagnoses overnight after each mock.

**34. "What if Google changes its prices or terms?"**
It already has, twice this year, which is why the AI sits in one replaceable module. Switching providers doesn't touch any of the counting. Longer term, our own model reduces the dependence.

**35. "Is it online? Can teachers log in from home? Can it handle 2,000 students?"**
Not online yet; today it runs on our machine. We haven't load-tested it. The counting runs inside the database, which handles this size routinely. The AI step grows with the number of students, so cost and a paid plan are what we'd size for your numbers.

**36. "Can students or parents see it? Does it work in Hindi?"**
Not yet. It's teacher-facing first by design: a teacher should check a diagnosis before a student hears it. Student and parent views are planned. Screens and labels are in English; we haven't built or tested Hindi.

### E. Commercial

**37. "What does it cost?"**
We haven't set a price, and that's deliberate. We'd rather run a pilot on your data first and price on the value you actually see. The pilot is free for you. Our running costs are low because counting costs nothing and the AI is only used for the judgement step.
*(If pressed, don't invent a number in the room. Say you'll send a written proposal after the pilot.)*

**38. "What's the pilot, and what do we get?"**
- **We need:** your past mock results with options marked, the papers and keys, a teacher or two, and a short agreement.
- **You get:** a diagnosis for each student, the five-bucket breakdown per paper, and a look back: *would this have caught the students who later slipped?*
- No obligation.

**39. "What results can you promise?"**
None yet, honestly. The number we want to be held to is: of the students flagged in the pilot, how many recovered after a teacher acted. To know it was us and not luck, we'd start with some batches first and compare them with the rest.

**40. "What happens to our data if you shut down?"**
It's yours. We'd put return and deletion terms in the agreement. To be honest, a data-export feature doesn't exist yet. *(Decide the commitment before you make it.)*

---

## 10. What NOT to say

| Don't say | Why | Say instead |
|---|---|---|
| "It works on real students" / "It's proven" | Every student is simulated. | "It finds planted patterns and passes the noise test. A pilot proves it on real students." |
| "Our AI" / "our own model" | Today the AI is Google's Gemini. Our own model is a plan. | "We use Google's Gemini for the judgement step. Our own model is the next stage." |
| "It predicts ranks / selection" | It doesn't, and shouldn't (Q5). | "It tells you which marks are recoverable and how." |
| "88% accurate" | Misleading. The stored answers are NTA's. | "The AI independently matched NTA's key on 88%. We check the rest." |
| "Fully anonymous" / "Nothing goes to Google" | Question content does go, and S-1 is a code your system can map back. | "No name, roll number or contact detail ever goes to the AI." |
| "DPDP compliant" / "bank-grade" / "certified secure" | No legal review or security audit has been done. | "Designed for it; a formal review is part of pilot preparation." |
| "Works for NEET today" | NEET isn't on the screens yet. | "The NEET syllabus and a real NEET paper are in. The NEET demo is next." |
| "Covers the whole syllabus" | 15 misconceptions, three subjects, a handful of chapters, no Biology. | "15 misconceptions so far, growing with every paper." |
| "Upload your Excel and it works" | The importer isn't built. | "For the pilot, we load your files." |
| "100% of flagged students recovered" / Priya's 44% → 67% | Seeded examples. | Nothing. Don't quote outcomes. |
| "Saves teachers X hours" | Not measured. | "Designed to be read in 30 seconds. We'll measure it with you." |
| "NEET is 45 Botany + 45 Zoology" | NTA doesn't state that. | "NEET has 90 Biology questions." |
| "Official NEET paper from NTA" | The paper copy is from a public mirror. The key is NTA's. | "NTA's official key; the booklet code was proven against it." |
| "Teachers have confirmed it" | No real teacher has reviewed it yet. | "It's built so teachers confirm it, and that's what the pilot starts." |
| "Thousands of training examples" | 14 diagnoses, all on simulated students. | "Every diagnosis is saved. The training set starts with your pilot." |
| "It's live / in the cloud" | Runs on a laptop. | "Hosting in India is part of pilot preparation." |
| Any fact about Allen, Aakash or PW | We haven't verified any. | Talk only about what a marks-and-ranks report does (Q3). |
| "The AI is never wrong" | It can be. | "It can be wrong, so every claim comes with its proof and a teacher decides." |

---

## 11. What comes next

### The decision in front of you

There are two options:
- **(a) Pitch now** with the current prototype and the two explainer pages, framed honestly with §7.
- **(b) First run the "NEET demo round".** This matters most if your first clients are NEET-focused.

### The NEET demo round (pending your go-ahead)

| Piece | Why |
|---|---|
| **Formula display** | Real questions are stored with formulas written in a typesetting code (LaTeX), and the screens show that code raw. That has to be fixed before real questions can be shown. |
| **Biology on the screens** | The screens currently assume Physics, Chemistry and Maths. NEET needs Botany and Zoology. |
| **Simulated students sit the real NEET 2025 paper** | So the diagnosis runs on a real NEET paper, not our own. |
| **Clickable counter-evidence** | D22 and D23 should open their questions, like the evidence chips do. |
| Also | A person signs off the 32 cross-check disagreements. Subject experts confirm the drafted misconception labels for the real papers. |

### After that

1. **A pilot with one institute.** The ask is in Q26 and Q38. Build the results-file importer around their actual files.
2. **Hosting in India, and a paid AI plan.** The free tier is 20 requests per model per day and was frequently busy.
3. **More AI tasks**, each checked the same way: why a student's scores declined; a weekly plan; practice questions aimed at one specific mistake; reading a new paper automatically; weekly summaries for mentors and parents.
4. **Our own model**, once enough teacher-checked examples exist (the plan says about 5,000). Fine-tune an existing open model on this one task first.
5. **Student app and parent reports**, later. Teacher-first by design.

### The pilot ask, in one breath

> "Give us past mock results for one batch, with the options students marked, plus the papers and keys. Give us one or two teachers to check what we find. We'll show you, student by student, which wrong ideas cost them marks, and whether we'd have caught the students who later slipped. No cost, no obligation."

---

## 12. Glossary

| Term | Plain meaning |
|---|---|
| **AI / LLM** | A language model: software trained on huge amounts of text that can read and write. Gemini and ChatGPT are examples. |
| **Gemini** | Google's AI. We use it for the judgement step only. |
| **Misconception** | A wrong rule a student believes. It produces the same kind of wrong answer repeatedly. |
| **Distractor** | A wrong option in a multiple-choice question, written to tempt a particular mistake. |
| **"Took the bait"** | Chose the wrong option labelled with a given misconception. |
| **Label / tag** (e.g. `MIS-ORG-EAS`) | The code saying which misconception a wrong option represents. |
| **Diagnosis** | The AI's judgement for one student on one paper: the headline, the findings, the counter-evidence and one action. |
| **Finding / hypothesis** | One claimed misconception, with its evidence and a confidence level (high, medium or low). |
| **Evidence chip** | A clickable question number (e.g. "D16") on the diagnosis card. It opens the question. |
| **Counter-evidence** | Questions the student got right in the same chapter, where the mistake couldn't show. It proves the problem is a specific trigger, not the whole chapter. |
| **Marks at stake** | Marks the student would gain by fixing the mistake: 5 per affected question on a +4/−1 paper. |
| **Trace** | The saved record of one AI request: what was sent, what came back, the model used and the time taken. Aarav's is #67. |
| **Cached** | Already made and saved. The same answers return the same diagnosis, instantly and at no cost. |
| **Open book** | The AI works only from documents put in front of it, never from memory. |
| **Cross-check** | The AI solves a past paper blind, then its answers are compared with NTA's official key. |
| **PII** | Personally identifiable information: names, roll numbers, phone numbers and the like. Never sent to the AI. |
| **Pseudonym** ("S-1") | A code used instead of a name. Only our system can map it back. |
| **Tenant** | One customer institute. |
| **Row-level security** | A rule inside the database that only returns rows belonging to the logged-in user's institute. |
| **Simulated / seeded data** | Made-up students and answers, generated for the demo. |
| **Hero student** | One of the four simulated students given a planted mistake pattern. |
| **Control student** | The non-hero whose errors clump the most by chance. Used to show that noise doesn't pass as a pattern. |
| **p-value** | The chance of seeing a clump this strong by luck alone. Smaller means less likely to be luck. Our bar is 1 in 100 (0.01). |
| **Flag / detector** | A rule-based alert, e.g. "revision overdue" or "weak topic". There are 8 kinds. |
| **Five buckets** | How lost marks are sorted: conceptual gap, execution error, time exhaustion, avoidable skip, and not enough evidence. |
| **Fine-tuning** | Teaching an existing open AI model one specific job by showing it many examples. Not building a model from scratch. |
| **Open model** | An AI model anyone can download and run, e.g. Qwen or Llama. |
| **Free tier / quota** | Google's free usage allowance: 20 requests per model per day. |
| **NTA** | National Testing Agency, which sets JEE Main and NEET and publishes the official keys. |
| **NCERT link** | Each syllabus chapter linked to its NCERT textbook chapter. |
| **OMR** | The bubble answer sheet, read by machine. |
| **DPDP** | India's Digital Personal Data Protection Act. |
| **LaTeX** | A code for writing mathematical formulas. It needs a renderer to display properly. |
| **Automated tests** | Small programs that check the system still behaves correctly after every change. |

---

## Appendix: how the numbers were checked (10 Oct 2026)

Re-run these before an important meeting. If the database is ever re-seeded, the numbers can change.

| What | How |
|---|---|
| Students, answers, papers, misconceptions, labelled options, flags | Direct counts in Postgres: `docker exec student_ai_db psql -U sai -d student_ai -c "<sql>"` |
| Diagnostic paper details | `ingestion_testpaper` id 17: 46 questions, 184 max marks, +4/−1. Subject split traced through the syllabus tree. |
| Cross-check results | `ingestion_questiontopicmap.verification` for papers 18 and 19, plus each paper's stored provenance record (sources, checksums, booklet-code proof). |
| Syllabus chapters and NCERT links | `syllabus_topic` rows of kind "chapter" for syllabus versions 5 (JEE) and 6 (NEET). |
| 4 of 4 diagnoses | Stored AI outputs in `reasoning_reasoningtrace` (traces 67, 56, 61, 64), rendered through the same code the screens use. **No AI was called.** Confirmed that today's data still matches these saved diagnoses, so the hero pages make no live call. |
| Planted patterns and the control | `manage.py verify_signatures --institute aarambh`: PASS. |
| Privacy | Searched all 72 stored diagnosis requests for every student name, roll number, institute name and mentor name: 0 found. |
| Walls between institutes | `manage.py rls_check`: all checks passed. |
| Free-tier limit | Google's own error text stored in failed traces: "limit: 20", per model, per day. |
| Tests | `cd app && .venv\Scripts\python.exe -m pytest -q` gave 190 passed. `cd web && npm test` gave 21 passed. |
| Marks-lost buckets for Aarav | The mock-analysis code run for Aarav on Mock 14 (paper 7) and Mock 15 (paper 17). |
