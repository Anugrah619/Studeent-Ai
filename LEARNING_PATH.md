# Learning Path — AI Student Performance System

Companion to `PROJECT_LOG.md`. This file maps **build phases → skills → free resources**.
Goal: every skill here is learned because a phase of the product needs it, not in the abstract.

> Link status: these are well-established resources, but I have not fetched them to verify
> they are live. If one 404s, tell me and I'll find a replacement.

---

## The Core Insight

The hard part of this product — "which topics is this student weak in, and what should they
revise next?" — is not a novel problem. It is a well-studied academic field called
**Knowledge Tracing** (modelling a learner's latent mastery of skills from their answer
history over time), plus **Spaced Repetition Scheduling**.

This matters enormously for the learning plan: it means the ML track has real theory,
public datasets, published baselines, and a clear ladder from simple to sophisticated.
You are not inventing — you are implementing a literature, which is the best way to learn.

The ladder, simplest to hardest:

| Rung | Method | What it teaches |
|---|---|---|
| 1 | Rolling accuracy per topic | Baselines, sparse-data problems, why naive averages lie |
| 2 | Bayesian Knowledge Tracing (BKT) | Hidden Markov models, latent state, probability |
| 3 | Elo / Glicko rating per topic | Online updates, uncertainty, rating systems |
| 4 | Item Response Theory (IRT) | Separating *student ability* from *question difficulty* |
| 5 | Deep Knowledge Tracing (DKT / SAKT) | RNNs & attention on sequences, when DL is/isn't worth it |

**Build rung 1 first and actually ship it.** Climb only when you can show, with your own
data, that the rung below is failing. That discipline is itself the most valuable ML skill
on the list.

---

## Phase Map

### Phase 0 — Domain & Data Model
*What we build:* the entity model. Topic, Syllabus, StudySession, Question, Attempt,
MockTest, MasteryState, RevisionItem. Schema + migrations.

*Skills:* domain modelling, normalization, keys & constraints, indexing, modelling
time-series/event data, hierarchical data (syllabus trees).

- [Use The Index, Luke](https://use-the-index-luke.com/) — free, the best SQL indexing resource that exists
- [CMU 15-445 Database Systems](https://15445.courses.cs.cmu.edu/) — free lectures + notes; Andy Pavlo is excellent
- [PostgreSQL docs: Data Types](https://www.postgresql.org/docs/current/datatype.html) and [Indexes](https://www.postgresql.org/docs/current/indexes.html)
- Concept to look up: *event sourcing* vs *current-state* tables — directly relevant to study logging

---

### Phase 1 — Backend Core (auth, logging, APIs)
*What we build:* student onboarding, study logging endpoints, auth, the testing spine.

*Skills:* API design, REST semantics, authn vs authz, idempotency, validation, migrations,
layered architecture, testing strategy.

- [The Twelve-Factor App](https://12factor.net/) — short, free, foundational for anything deployable
- [Microsoft REST API Guidelines](https://github.com/microsoft/api-guidelines) — free, opinionated, practical
- [OWASP Top 10](https://owasp.org/www-project-top-ten/) — free; read before writing auth, not after
- [Testing Library / test pyramid — Martin Fowler](https://martinfowler.com/articles/practical-test-pyramid.html)

---

### Phase 2 — Weak-Topic Identification  ← *the intellectual core*
*What we build:* rung 1, then climb.

*Skills:* probability, latent-variable models, evaluation methodology, baselines, the
sparse-data problem, avoiding overfitting on small user counts.

- [Google ML Crash Course](https://developers.google.com/machine-learning/crash-course) — free, fast, practical
- [Andrew Ng, ML Specialization](https://www.coursera.org/specializations/machine-learning-introduction) — audit free
- Bayesian Knowledge Tracing — original: Corbett & Anderson 1994; search "BKT tutorial" for modern writeups
- [Deep Knowledge Tracing (Piech et al. 2015)](https://arxiv.org/abs/1506.05908) — the paper that started the DL wave
- [EdNet dataset (Riiid)](https://github.com/riiid/ednet) — real large-scale student interaction data, free
- [pyBKT](https://github.com/CAHLR/pyBKT) — reference implementation to compare yours against
- Item Response Theory: search "IRT 1PL 2PL 3PL explained" — the Rasch model is the place to start

---

### Phase 3 — Revision Scheduling
*What we build:* what to revise, when, and how much.

*Skills:* scheduling algorithms, priority queues, heaps, cron/background jobs, the
exploration-vs-exploitation trade-off.

- [SM-2 algorithm (SuperMemo)](https://super-memory.com/english/ol/sm2.htm) — free spec of the classic algorithm
- [FSRS](https://github.com/open-spaced-repetition/fsrs4anki) — the modern, ML-fitted successor; read the wiki
- [MIT 6.006 Introduction to Algorithms](https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-spring-2020/) — free OCW, for heaps/graphs/DP
- [NeetCode roadmap](https://neetcode.io/roadmap) — free structured DSA practice

*Note:* exam prep breaks classic spaced repetition — there's a hard deadline (exam day) and
a fixed syllabus. That constraint is a genuinely interesting algorithmic problem and a good
one to think through from first principles.

---

### Phase 4 — Mock Analysis & Dashboard
*What we build:* aggregations, trends, comparisons, the performance dashboard.

*Skills:* OLTP vs OLAP, aggregation pipelines, materialized views, caching strategy,
cache invalidation, query optimization, data visualization.

- [Redis docs: caching patterns](https://redis.io/docs/latest/develop/use-cases/caching/)
- [PostgreSQL materialized views](https://www.postgresql.org/docs/current/rules-materializedviews.html)
- Concept: read-model / CQRS — why the dashboard shouldn't query the write tables directly

---

### Phase 5 — AI Guidance Layer
*What we build:* the LLM-driven guidance, grounded in the student's real data.

*Skills:* LLM integration, structured output, tool use, retrieval, prompt design, evals,
cost & latency control, hallucination containment.

- [Anthropic docs](https://docs.claude.com/) — free
- [Anthropic Cookbook](https://github.com/anthropics/anthropic-cookbook) — free, runnable examples
- Key discipline: **evals before prompts.** How do you know the guidance is good? Answer that first.

---

### Phase 6 — Scale
*What we build:* it survives 10k concurrent students in exam season.

*Skills:* horizontal scaling, load balancing, queues, rate limiting, observability, SLOs,
load testing, failure modes.

- [System Design Primer](https://github.com/donnemartin/system-design-primer) — free, the standard starting point
- [Google SRE Book](https://sre.google/books/) — free online, full text; SLOs chapter is essential
- [MIT 6.5840 Distributed Systems](https://pdos.csail.mit.edu/6.824/) — free labs + papers, genuinely hard
- [Martin Kleppmann's Distributed Systems lectures](https://www.cl.cam.ac.uk/teaching/2122/ConcDisSys/) — free video + notes
- *Designing Data-Intensive Applications* (Kleppmann) — not free, but the single highest-value book here

---

## How We'll Run It

1. Hit a phase → I explain the problem and the 2-3 real approaches, with trade-offs.
2. **You pick.** I'll recommend, not decide.
3. Build it small and working.
4. I point at the specific resource for the concept that phase leaned on.
5. Log the decision + the *why* in `PROJECT_LOG.md`.

Anti-goal: a pile of tutorials completed with nothing shipped.
