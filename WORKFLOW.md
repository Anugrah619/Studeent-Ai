# Student AI — Workflow Diagrams

Visual reference for the whole system. Every diagram below is Mermaid and renders natively on GitHub, or in VS Code with the **Markdown Preview Mermaid Support** extension (free, by Matt Bierner). No account, no service, no connection required.

Companion to [`TECHNICAL_DOC.md`](TECHNICAL_DOC.md), which carries the reasoning and the tech choices.

---

## 1 · Master workflow — end to end

The whole system in one picture. Data moves strictly downward; no layer reaches past the one below it.

```mermaid
graph TD
    subgraph L0["L0 — SOURCES"]
        A1["Mock result files<br/>xlsx · csv · OMR vendor export"]
        A2["Roster<br/>students · batches · mentors"]
        A3["Chapter completion<br/>faculty syllabus tracker"]
        A4["Student app<br/>study logs · confidence ratings"]
    end

    subgraph L1["L1 — INGESTION"]
        B1["Parse + sniff format"]
        B2["Apply column-mapping profile"]
        B3["Resolve student identity"]
        B4["Map question to topic"]
        B5["Validate + emit events"]
    end

    subgraph L2["L2 — CANONICAL STORE (append-only)"]
        C1[("attempts")]
        C2[("study_logs")]
        C3[("confidence")]
        C4[("revision_events")]
        C5[("topics — syllabus tree")]
    end

    subgraph L3["L3 — FEATURE STORE (derived, rebuildable)"]
        D1["topic_state<br/>mastery · retention · exposure"]
        D2["student_state<br/>consistency · load · balance · debt"]
    end

    subgraph L4["L4 — ENGINES (deterministic)"]
        E1["Mastery / knowledge tracing"]
        E2["Retention / spaced repetition"]
        E3["Detector suite"]
        E4["Mock analyzer"]
        E5["Plan packer"]
    end

    subgraph L5["L5 — INSIGHT OBJECTS (typed + evidenced)"]
        F1["risk_flag"]
        F2["weak_topic"]
        F3["marks_lost_attribution"]
        F4["plan_block"]
        F5["revision_due"]
    end

    subgraph L6["L6 — NARRATION (Gemini)"]
        G1["De-identify payload"]
        G2["Generate prose"]
        G3["Validate every claim"]
        G4["Re-identify + cache"]
    end

    subgraph L7["L7 — SURFACES"]
        H1["Director dashboard"]
        H2["Mentor console"]
        H3["Student app"]
        H4["Parent report — WhatsApp"]
    end

    A1 --> B1
    A2 --> B3
    A3 --> B5
    A4 --> B5
    B1 --> B2 --> B3 --> B4 --> B5
    B5 --> C1 & C2 & C3 & C4
    C5 -.topic_id spine.-> C1
    C1 & C2 & C3 & C4 --> D1 & D2
    D1 & D2 --> E1 & E2 & E3 & E4 & E5
    E1 & E2 --> F2 & F5
    E3 --> F1
    E4 --> F3
    E5 --> F4
    F1 & F2 & F3 & F4 & F5 --> G1
    G1 --> G2 --> G3 --> G4
    F1 & F2 & F3 & F4 --> H1 & H2 & H3
    G4 --> H1 & H2 & H3 & H4
```

**Read this:** L5 is the seam. Everything above it is arithmetic on stored events. Everything below it is presentation. Surfaces read insight objects *directly* — narration is an enhancement layer, not a dependency. If Gemini is down, the product still works; it just stops writing sentences.

---

## 2 · The trust boundary — what the model is and is not allowed to do

```mermaid
graph LR
    subgraph DET["DETERMINISTIC ZONE — reproducible, auditable, free"]
        A["Events"] --> B["Engines"] --> C["Insight objects<br/>every field traces<br/>to a stored feature"]
    end

    subgraph GEN["GENERATIVE ZONE — Gemini"]
        D["De-identified<br/>payload"] --> E["LLM"] --> F["Draft prose"]
        F --> G{"Claim<br/>validator"}
    end

    C --> D
    G -->|"every figure<br/>found in payload"| H["Delivered"]
    G -->|"unverifiable claim"| I["Regenerate,<br/>then strip"]
    I -.-> E
    E -.->|"NEVER"| B

    style GEN fill:#fff8e1,stroke:#9A6B12
    style DET fill:#eef2fb,stroke:#2B4A9B
```

**Read this:** the model has no write path back into state. It cannot change a score, raise a flag, or compute a number. This matters more with a cheaper model, not less — and it is what lets you answer a director's *"why did it say that?"* with a rule and its evidence.

---

## 3 · Flow A — Mock result file to actionable insight

The highest-value flow in the system, and the one most often underestimated.

```mermaid
graph TD
    S1["1 · Institute uploads file<br/>xlsx / csv / OMR export"] --> S2["2 · Parse + sniff format"]
    S2 --> S3["3 · Apply saved column mapping<br/>one profile per institute"]
    S3 --> S4["4 · Resolve student<br/>roll no exact → name fuzzy → human queue"]
    S4 --> S5{"5 · Question mapped<br/>to a topic?"}

    S5 -->|"yes"| S6["6 · Emit attempt events<br/>append-only, idempotent"]
    S5 -->|"no"| R1["Review queue<br/>Django admin"]
    R1 --> R2["Human confirms once"]
    R2 -->|"mapping stored permanently"| S6

    S6 --> S7["7 · Update feature store<br/>mastery · retention · baselines"]
    S7 --> S8["8 · Run analyzers<br/>marks-lost attribution + detectors"]
    S8 --> S9["9 · Insight objects → console"]

    style S5 fill:#eef2fb,stroke:#2B4A9B,stroke-width:2px
    style R1 fill:#fff8e1,stroke:#9A6B12
```

**Read this:** step 5 is the gate. An unmapped attempt is a number with no meaning, so nothing downstream works without it. Mapping is a **one-time cost per question paper** that pays out on every future student who sits it — which is why it belongs in a permanent table with human confirmation, never as a runtime inference.

---

## 4 · Flow B — Four queues become one day's plan

```mermaid
graph LR
    Q1["Due revisions<br/><i>retention below floor</i>"] --> P["Priority scorer<br/>marks-at-risk × urgency × decay"]
    Q2["Weak topics<br/><i>low mastery, high yield</i>"] --> P
    Q3["Syllabus remaining<br/><i>vs exam deadline</i>"] --> P
    Q4["Mock follow-ups<br/><i>errors from last test</i>"] --> P

    P --> K["Constraint packer<br/>greedy first"]
    C1["Available minutes today"] --> K
    C2["Coaching class schedule"] --> K
    C3["Subject rotation · session cap"] --> K

    K --> O["Today's plan<br/>every block carries a reason code"]

    style K fill:#eef2fb,stroke:#2B4A9B,stroke-width:2px
```

**Read this:** the planner is a constrained packing problem, not a scheduling UI. Ship the greedy scorer — a weighted sort that fills slots until minutes run out is roughly 80% as good as constraint programming and takes a day rather than a month.

**The reason code is a retention feature, not a log line.** Unexplained plans get abandoned in week two.

---

## 5 · Flow C — The risk loop has to close

```mermaid
graph LR
    A["Feature store<br/>nightly + on-event"] --> B["Detector suite<br/>personal baselines"]
    B --> C["Flag<br/>severity + evidence + suggested action"]
    C --> D["Mentor console<br/>routed to a named human"]
    D --> E["Intervention logged<br/>with a date"]
    E --> F["Outcome measured<br/>did the flag resolve?"]
    F -->|"tunes thresholds"| A

    style C fill:#eef2fb,stroke:#2B4A9B,stroke-width:2px
    style F fill:#e8f5ee,stroke:#0E7C57,stroke-width:2px
```

**Read this:** detection is the easy half. The return arrow is the product — it tunes detector thresholds against ground truth, and it produces the only number that renews a contract: *"of 23 students flagged last term, 17 recovered after mentor contact."*

Without it you have a system that generates worry, not outcomes.

### Alert hygiene — the three rules that keep mentors reading

```mermaid
graph TD
    A["Detector wants to fire"] --> B{"Enough evidence?<br/>≥ N observations"}
    B -->|"no"| X["Stay silent"]
    B -->|"yes"| C{"Deviates from this<br/>student's own baseline?"}
    C -->|"no"| X
    C -->|"yes"| D{"Cooldown expired?<br/>one flag per type per window"}
    D -->|"no"| X
    D -->|"yes"| E["Raise flag"]

    style X fill:#f5f5f7,stroke:#7A8499
    style E fill:#e8f5ee,stroke:#0E7C57
```

Three wrong answers is noise, not a trend. A console that cries wolf in week one is ignored by week three — and you do not get a second chance with that mentor.

---

## 6 · Flow D — Narration, de-identified

Updated for Gemini. The de-identification step is **not optional** on the free tier.

```mermaid
graph TD
    A["Insight objects<br/>for one student"] --> B["Context builder<br/>bounded payload"]
    B --> C["STRIP PII<br/>no name · no roll no · no phone<br/>no DOB · no institute name"]
    C --> D["Opaque ref only<br/>student_ref: S-4471"]
    D --> E["Gemini API"]
    E --> F["Draft prose"]
    F --> G{"Claim validator<br/>every number + noun<br/>present in payload?"}
    G -->|"fail"| H["Regenerate once,<br/>then strip the claim"]
    H -.-> E
    G -->|"pass"| I["Re-identify locally<br/>substitute real name"]
    I --> J["Cache on state hash"]
    J --> K["Deliver"]

    style C fill:#fdecea,stroke:#B3352B,stroke-width:2px
    style G fill:#eef2fb,stroke:#2B4A9B,stroke-width:2px
```

**Read this:** Google's free tier may use submitted content to improve its products, with human review, and its terms tell you not to submit personal information. Your users are minors. Stripping PII before the call is what makes the free tier usable at all — and it costs nothing, because the payload is already a bounded structured object.

Re-identification happens locally, after generation. The model never sees a real name.

---

## 7 · Tier 0 vs Tier 1 — what works without student adoption

```mermaid
graph LR
    subgraph T0["TIER 0 — institute already has this"]
        I1["Mock result files"]
        I2["Roster + batches"]
        I3["Chapter completion"]
    end

    subgraph T1["TIER 1 — needs student behaviour"]
        I4["Daily study logs"]
        I5["Self-rated confidence"]
    end

    I1 & I2 & I3 --> C0["WORKS ON DAY ONE<br/>· marks-lost attribution<br/>· weak topic identification<br/>· at-risk triage<br/>· over-attempting detection<br/>· batch + cohort analytics"]
    I4 & I5 --> C1["UNLOCKED BY LOGGING<br/>· revision scheduling<br/>· daily planning<br/>· confidence mismatch<br/>· disengagement + overload"]

    C0 --> S0["Director + mentor console<br/><b>THE SELLABLE WEDGE</b>"]
    C1 --> S1["Student app<br/>all adoption risk lives here"]

    style T0 fill:#eef2fb,stroke:#2B4A9B
    style C0 fill:#eef2fb,stroke:#2B4A9B
    style S0 fill:#e8f5ee,stroke:#0E7C57,stroke-width:2px
```

**Read this:** this is the architectural answer to *"who is actually going to enter all this data?"* — the question that kills ed-tech pilots. Tier 0 capabilities never read a study log, so they can be built, demoed and sold on files the institute already owns. The student app then arrives somewhere the system has already earned credibility, instead of asking for trust up front.

---

## 8 · Build order — the dependencies pick the sequence

```mermaid
graph LR
    P0["P0<br/>Schema +<br/>syllabus tree"] --> P1["P1<br/>Ingestion"]
    P1 --> P2["P2<br/>Feature store"]
    P1 --> P4["P4<br/>Student app"]
    P2 --> P3["P3<br/>Detectors +<br/>CONSOLE"]
    P2 --> P5["P5<br/>Revision"]
    P4 --> P5
    P5 --> P6["P6<br/>Planner"]
    P3 --> P7["P7<br/>Narration"]
    P6 --> P7
    P7 --> P8["P8<br/>Reports +<br/>scale"]

    style P3 fill:#e8f5ee,stroke:#0E7C57,stroke-width:3px
```

**Read this:** P3 is reachable without P4 — that is the point of the tier split, and the reason the console is built before the student app. P7 sits deliberately late: narration's entire input is the output of P2 through P6, so building it earlier means prompting a model about data that does not exist yet.

---

## 9 · Prototype scope — what the demo actually covers

The demo is a **static frontend**. No backend, no database, no live model calls.

```mermaid
graph TD
    subgraph DEMO["PROTOTYPE — static HTML/CSS/JS, hardcoded data"]
        V1["Director command center<br/>312 students · 5 need you this week"]
        V2["Student 360<br/>one hero student's full story"]
        V3["Mock test intelligence<br/>marks-lost attribution"]
        V4["Student app view<br/>phone frame · daily plan"]
        V5["The pilot ask<br/>what you get, what we need"]
    end

    subgraph REAL["REAL SYSTEM — not built for the demo"]
        R1["Ingestion pipeline"]
        R2["Feature store"]
        R3["Detector engine"]
        R4["Gemini narration"]
        R5["Auth · tenancy · jobs"]
    end

    D["data.js<br/>one hardcoded dataset,<br/>internally consistent"] --> V1 & V2 & V3 & V4

    REAL -.->|"what the demo<br/>implies exists"| DEMO

    style DEMO fill:#eef2fb,stroke:#2B4A9B,stroke-width:2px
    style REAL fill:#f5f5f7,stroke:#7A8499,stroke-dasharray: 5 5
```

**Read this:** the prototype's job is to make a director believe the system works, not to be the system. Pre-write the narration text into `data.js` — do **not** call Gemini live in a demo. An API key in client-side JavaScript is exposed to anyone who opens devtools, and a weird generation in front of a buyer costs you the room.

Demo reliability beats live-ness. Every time.
