# Agent Handoff

**The coordination contract between agents.** Agents run **sequentially**: each finishes, records what it added here, and only then does the next start.

Read this before you begin. Write your section before you finish.

---

## Running order and why

```
1. DB        ← schema, RLS, admin.        Everything depends on it.
2. BACKEND   ← detectors, engines, API.   Needs the schema settled.
3. TESTING   ← pytest, contract tests.    Needs something to test.

   FRONTEND  ← runs throughout, decoupled via openapi.yaml + MSW mocks.
               Own worktree. Touches nothing under app/.
```

The DB agent mutates schema on the **shared** Postgres (port 5434). If the backend agent queried while that happened it would be aiming at a moving target — hence sequential, not parallel.

## Ownership — strict, non-overlapping

| Agent | Owns | Must not touch |
|---|---|---|
| **db** | `app/apps/*/models.py`, `*/migrations/`, `*/admin.py`, `apps/tenancy/middleware.py` | `app/apps/api/`, `web/`, `app/tests/` |
| **backend** | `app/apps/api/`, `app/apps/*/services/` | any `models.py`, migrations |
| **testing** | `app/tests/`, test config | everything else (read-only) |
| **frontend** | `web/` (in worktree `E:\Student_AI_agents\frontend`) | anything under `app/` |

**Only the DB agent runs `makemigrations` / `migrate`.**

## Shared contract

`openapi.yaml` at repo root — generated, never hand-edited.
Regenerate after any serializer change:

```
cd app && .venv\Scripts\python.exe manage.py spectacular --file ../openapi.yaml
```

If you change it, say so loudly in your handoff section.

## Environment

- Python 3.14 · Django 6.1.1 · DRF 3.18.1 · venv at `app/.venv`
- Postgres 16, Docker container `student_ai_db`, **port 5434**, db `student_ai`, user `sai`
- Seeded: 2 institutes, 49 students, 24,000 attempts, 7 mock papers, 2,530 topic states
- **Do not flush or re-seed** — the next agent depends on this data

---

# 1 · DB AGENT

> Status: **done** · branch `agent/db` · `manage.py check` clean, `makemigrations --check` reports no drift, all 3 new migrations applied to the shared DB.

### What I added

**Migrations (all applied):**

| Migration | What |
|---|---|
| `tenancy/0003_row_level_security` | RLS on 20 tables, the `student_ai_rls` role, `app_current_institute()`, grants + default privileges |
| `events/0004_attempt_index_review` | drops `idx_attempt_paper` (duplicate), adds `idx_attempt_stu_paper` |
| `derived/0003_flag_idx_flag_open` | partial index `idx_flag_open` |

**New code:**

- `apps/tenancy/rls.py` — **the only module that touches `app.institute_id`.** Exports `tenant_scope()`, `bypass_rls()`, `set_tenant()`, `clear_tenant()`, `current_tenant()`. Import from here; do not issue `SET ROLE` / `set_config` by hand.
- `apps/tenancy/middleware.py` — `TenantMiddleware`, registered in `config/settings.py` directly after `AuthenticationMiddleware`. **This is the only change I made outside my ownership boundary.**
- `apps/tenancy/management/commands/rls_check.py` — the proof, and a drift detector. Non-zero exit on failure, so it belongs in CI.
- `admin.py` for all five apps — every model registered (23 admins).

**Model changes:** only `Attempt.Meta.indexes` and `Flag.Meta.indexes`. **No field was added, removed, renamed, or retyped.**

### Schema changes the backend agent must know about

**None that break anything.** No column changed. Every query in `apps/api/views.py` still runs — I executed them all under EXPLAIN and via the live API. Two indexes changed, which is invisible to the ORM.

### RLS — how tenant isolation now works

**The shape:**

```
20 tables            ENABLE + FORCE ROW LEVEL SECURITY
policy               tenant_isolation, FOR ALL, TO PUBLIC
                     USING/WITH CHECK (institute_id = app_current_institute())
app_current_institute()   STABLE fn -> NULLIF(current_setting('app.institute_id', true), '')::bigint
```

17 tables carry `institute_id` directly. Three more are covered indirectly: `tenancy_institute` (`id = app_current_institute()`), `syllabus_topic` (EXISTS against `syllabus_syllabusversion`), `derived_intervention` (EXISTS against `derived_flag`).

**Three things had to be true, and the third is the one that is easy to miss:**

1. `ENABLE` — turns policies on.
2. `FORCE` — applies them to the table *owner*. Django connects as the owner; without this the policies exist, look right in `\d+`, and do nothing.
3. **A role that is neither SUPERUSER nor BYPASSRLS.** `FORCE` does not help against those. Our `DATABASE_URL` role `sai` is `Superuser, Bypass RLS` — so with only (1) and (2), isolation would still have been silently off. The middleware issues `SET ROLE student_ai_rls` (NOLOGIN, NOSUPERUSER, NOBYPASSRLS) per tenant request and `RESET ROLE` in a `finally`.

**How a request gets scoped** — `TenantMiddleware`, after `AuthenticationMiddleware`:

| Caller | What happens |
|---|---|
| mentor | `SET ROLE student_ai_rls` + `app.institute_id = mentor.institute_id` |
| student | same, from `student.institute_id` |
| authenticated, neither, not superuser | role dropped, institute set to `''` → **sees nothing** |
| Django superuser | **not scoped.** The admin is cross-tenant back-office by design |
| anonymous | not scoped — DRF defaults to `IsAuthenticated`, admin needs a staff login, so no tenant data is reachable |

Non-superuser *staff* users **are** scoped, so an institute-side back-office account sees only its own institute in `/admin`.

#### ⚠ THE PART THAT WILL BITE YOU: no request, no tenant

`current_setting('app.institute_id', true)` returns NULL when nothing set it, `institute_id = NULL` is NULL, NULL is not TRUE, so **every tenant table reads as empty**. The symptom is "the database looks empty", not an error.

I chose fail-closed over a permissive `IS NULL OR ...` fallback deliberately: a permissive fallback converts "middleware didn't run" — a config mistake — into a silent cross-tenant leak, which is the exact failure RLS exists to prevent.

**What this means for you, concretely:**

**`seed_demo`, `recompute_features`, `run_detectors`, `manage.py shell`, and pytest all work unchanged, today, with no code and no context manager.** They connect as `sai`, which is SUPERUSER/BYPASSRLS, so RLS never engages and they see all rows. That is the intended design for the async/job path: nightly recompute and rebuild-from-events are *supposed* to be cross-tenant.

Two rules:

1. **Do not change `DATABASE_URL` to a non-superuser role** without reading `apps/tenancy/rls.py` first. The moment you do, every management command returns zero rows.
2. **A job that is genuinely per-tenant should opt in**, which also gets you RLS as a safety net:

   ```python
   from apps.tenancy.rls import tenant_scope

   for inst in Institute.objects.all():
       with tenant_scope(inst.id):
           recompute(...)          # cannot touch another institute, even by bug
   ```

   `tenant_scope` drops privileges for the block and restores them on exit, so it works from a BYPASSRLS connection too. `bypass_rls()` is the inverse for deliberate cross-tenant work.

Run `manage.py rls_check` if anything looks empty — it prints the connection's role and whether it bypasses.

#### Your question: should `TenantScopedMixin` in `views.py` stay? — **YES, keep it.** (SYSTEM_DESIGN §8 Q3)

Not as belt-and-braces theatre. It is doing three things RLS cannot:

1. **It is the only thing scoping superusers.** Superusers bypass RLS entirely by design. `TenantScopedMixin.institute_id()` falls back to `?institute=<id>` for them, and `scoped()` returns `.none()` when that is absent. Delete the mixin and a superuser's API call silently returns every institute's students.
2. **It survives an auth change.** The middleware reads `request.user`, which is populated by Django's session middleware. If you add JWT or token auth, DRF authenticates *inside* the view — `request.user` is still `AnonymousUser` when the middleware runs, so the connection never gets scoped. The mixin still works. **If you add token auth, tell me: the middleware has to move into a DRF authentication class or a DRF-aware hook.**
3. **Different failure modes.** RLS returns zero rows; the mixin's explicit `.filter()` keeps the intent visible where developers read, which is the argument §8 Q3 makes for it.

Two sources of truth is a real cost, and the design doc worries about it correctly. The mitigation is that they are not independent: both derive the institute from the same user, and `rls_check` asserts the database half. What you must **not** do is delete the mixin on the grounds that "RLS handles it" — for superusers and for any non-session auth, it does not.

One thing in the mixin I would change (yours to fix): `institute_id()` returns `self.request.query_params.get("institute")` — a **string** — for superusers, while returning an int for mentors. It is passed to `.filter(institute_id=...)` where Django coerces it, so it works, but `StudentViewSet.topic_states` compares it against nothing and `marks_lost` passes it straight through. Coerce to `int` or `None`.

### Proof it works

`cd app && .venv\Scripts\python.exe manage.py rls_check`

```
== connection ==
    connected as 'sai'  superuser=True  bypassrls=True
    -> this role bypasses RLS outright, which is why the app drops to 'student_ai_rls' per request.
      The test below does the same thing with SET ROLE.

== 1. coverage ==
[  ok  ] 17/17 tables with institute_id are RLS-enabled, FORCEd, and carry tenant_isolation
[  ok  ] syllabus_topic                   covered by an indirect policy (no institute_id column)
[  ok  ] derived_intervention             covered by an indirect policy (no institute_id column)
[  ok  ] tenancy_institute                covered by an indirect policy (no institute_id column)

== 2. read isolation ==

    app.institute_id = 1  (Aarambh Classes)
        tenancy_student                     46   (unscoped 49)   rows[f29ab109]
        tenancy_batch                        4   (unscoped 5)   rows[f8ef5bba]
        events_attempt                   24000   (unscoped 24000)   rows[9414c56d]
        events_studylog                   8265   (unscoped 8265)   rows[6473a27a]
        ingestion_questiontopicmap         525   (unscoped 525)   rows[e764780a]
        derived_topicstate                2530   (unscoped 2530)   rows[393aee6f]
        derived_flag                         6   (unscoped 6)   rows[dd1efb33]
        syllabus_topic                      71   (unscoped 142)   rows[dd7d59b6]

    app.institute_id = 2  (Pinnacle Academy)
        tenancy_student                      3   (unscoped 49)   rows[e4e3cd95]
        tenancy_batch                        1   (unscoped 5)   rows[e4da3b7f]
        events_attempt                       0   (unscoped 24000)   rows[-]
        events_studylog                      0   (unscoped 8265)   rows[-]
        ingestion_questiontopicmap           0   (unscoped 525)   rows[-]
        derived_topicstate                   0   (unscoped 2530)   rows[-]
        derived_flag                         0   (unscoped 6)   rows[-]
        syllabus_topic                      71   (unscoped 142)   rows[a38859f4]

[  ok  ] tenancy_student                per-tenant [46, 3] of 49
[  ok  ] tenancy_batch                  per-tenant [4, 1] of 5
[  ok  ] events_attempt                 per-tenant [24000, 0] of 24000
[  ok  ] events_studylog                per-tenant [8265, 0] of 8265
[  ok  ] ingestion_questiontopicmap     per-tenant [525, 0] of 525
[  ok  ] derived_topicstate             per-tenant [2530, 0] of 2530
[  ok  ] derived_flag                   per-tenant [6, 0] of 6
[  ok  ] syllabus_topic                 per-tenant [71, 71] of 142

== 3. unset setting fails closed ==
[  ok  ] with app.institute_id unset every tenant table reads 0 rows

== 4. write isolation ==
[  ok  ] cross-tenant INSERT refused: new row violates row-level security policy for table "tenancy_student"
[  ok  ] UPDATE of institute-1 student 1 while scoped to institute 2 touched 0 rows
[  ok  ] the same row is visible to institute 1 (count=1), so 4b was isolation and not a missing row

RLS verified: tenants are isolated, unset fails closed, cross-tenant writes are rejected.
```

**Read the `syllabus_topic` row carefully — it is why a count test alone is not proof.** Both institutes see 71 topics. A naive "the numbers differ" assertion would have passed a policy of `USING (true)` on that table. The `rows[...]` column is an md5 over the visible primary keys: `dd7d59b6` vs `a38859f4`, i.e. same cardinality, disjoint rows. `rls_check` asserts four things per table — the per-tenant counts partition the unscoped total, the visible row sets are distinct, at least one tenant sees fewer rows than unscoped, and while scoped to A no row with a different `institute_id` is reachable at all.

**End-to-end over HTTP** (not just SQL) — same session, two mentors:

```
mentor @ Aarambh (inst 1)    GET /api/students/?active=true  status=200 count=44
mentor @ Pinnacle (inst 2)   GET /api/students/?active=true  status=200 count=3
connection after the request: current_user=sai  app.institute_id=None     <- reset cleanly
```

**The drift detector works.** I created a stray `_drift_probe(id, institute_id)` table and re-ran:

```
[ FAIL ] _drift_probe                     enabled=False forced=False policy=False
[ FAIL ] 17/18 tables with institute_id are RLS-enabled, FORCEd, and carry tenant_isolation
CommandError: RLS is NOT enforcing isolation.
```

So **if you add a tenant-scoped table, `rls_check` will fail until I give it a policy.** New tables *do* automatically inherit the `student_ai_rls` grants (verified — `ALTER DEFAULT PRIVILEGES` is in the migration), but **not** the RLS policy. That is deliberate: grants failing open is an inconvenience, policies failing open is a breach.

### Index findings

Measured against the seeded 24,000 attempts with `EXPLAIN (ANALYZE, BUFFERS)`.

**Added 1, removed 1, left 97 alone.** Net index count on `events_attempt` is unchanged at 9.

**① REMOVED `idx_attempt_paper` — provably dead.** A duplicate-detection query over `pg_indexes` found exactly one pair in the whole schema with identical definitions:

```
 tablename      | idx_a                                 | idx_b             | wasted
 events_attempt | events_attempt_test_paper_id_b4af65e4 | idx_attempt_paper | 184 kB
```

`Attempt.Meta` declared `Index(fields=["test_paper"])`, which is byte-for-byte what Django already creates for the FK. `pg_stat_user_indexes` settles which one loses: **111 scans vs 0**. Both were maintained on every insert, and indexes on this table already weigh **99% of the heap** (2744 kB of index against 2776 kB of data) — on an append-only table taking 900k rows/month at target scale, a free duplicate is not affordable.

**② ADDED `idx_attempt_stu_paper (student_id, test_paper_id)`** — for `marks_lost` and the per-question `attempts` list, the two mock-analysis endpoints.

```
current:  Index Scan using events_attempt_test_paper_id  (actual rows=75)
            Index Cond: (test_paper_id = 7)
            Filter: ((student_id = 29) AND (institute_id = 1))
            Rows Removed by Filter: 3225
            Buffers: shared hit=55                            Execution Time: 0.536 ms

with it:  Bitmap Index Scan on idx_attempt_stu_paper  (actual rows=75)
            Index Cond: ((student_id = 29) AND (test_paper_id = 7))
            Heap Blocks: exact=2
            Buffers: shared hit=2 read=2                      Execution Time: 0.181 ms
```

**14x fewer buffers, 3x faster.** Being honest about one thing: **the planner does not yet choose it.** It estimates the `test_paper_id` path at 141.54 against 183.43 for the new one, because the seed inserted attempts paper-by-paper, so `test_paper_id` is almost perfectly correlated with physical row order and a wide scan looks cheap. The estimate is wrong by ~3x in wall time even now.

The reason to add it anyway is arithmetic, not taste. `Rows Removed by Filter: 3225` is *every other student who sat that paper* — 43 students x 75 questions. That number is `students_in_institute x 75` and grows linearly, while the composite path stays flat at 75. At the design's 300 students per institute it is 22,500 rows read to return 75 — a 300:1 read amplification — and the cost model flips somewhere around 130 students. The index is correct now and the planner catches up on its own.

**③ ADDED `idx_flag_open` — partial, and specified in SYSTEM_DESIGN §3.6 but never built.**

```sql
CREATE INDEX idx_flag_open ON derived_flag (institute_id, severity, raised_at DESC)
    WHERE resolved_at IS NULL;
```

This is the mentor console's landing query. Verified it serves the severity-filtered form with **no sort step at all**:

```
Index Scan using idx_flag_open on derived_flag  (cost=0.13..8.17 rows=2) (actual rows=2)
  Index Cond: ((institute_id = 1) AND (severity = 'critical'))
  Buffers: shared hit=2
```

At 6 seeded flags Postgres correctly prefers a seq scan, so this is a scale-forward index — stated plainly rather than dressed up. Partial on purpose: a flag that is never closed is a bug in the detector, so the open set stays roughly constant while the resolved set grows forever.

**④ Left alone, with reasons** (the brief said remove what provably will not be used — these are not that):

- **13 single-column FK indexes that are prefix-redundant** with an explicit composite (`events_attempt_student_id` vs `idx_attempt_stu_top_ts`, `tenancy_student_institute_id` vs `(institute_id, batch_id)`, and 11 more). Django creates these automatically. I tested dropping the biggest one: the planner fell back to the composite gracefully, **18 buffers vs 16, 0.145 ms vs 0.121 ms** — a real but tiny penalty. They are *usable*, just narrower, so "provably won't be used" is false. Dropping them cleanly is also not possible: `institute` is defined on the abstract `TenantScoped` base and Django forbids overriding an abstract base's field, so `db_index=False` would have to apply to all 17 tenant models at once. Not worth the coupling for ~170 kB.
- **`events_attempt_topic_id`** (0 scans) — load-bearing anyway: `Attempt.topic` is `on_delete=PROTECT`, and the delete-time check is `WHERE topic_id = X`, which without this index is a seq scan of the whole table.
- **`events_attempt_ingest_batch_id`** (0 scans) — same, plus it is the rollback path (`IngestBatch`: "everything it produced can be traced back or rolled back").
- **`idx_log_stu_top_ts`** (448 kB, 0 scans) — the documented feature-store hot path for the per-(student, topic) rollup, which is your job and does not exist yet.

**⑤ Not an index problem — a query problem. The dashboard needs rewriting (yours).**

`DashboardViewSet.summary`'s `batch_mock_avg` reads **every attempt the institute has ever recorded**:

```
Seq Scan on events_attempt  (actual rows=24000)
  Filter: ((test_paper_id IS NOT NULL) AND (institute_id = 1))
  Buffers: shared hit=343                        Execution Time: 8.7 ms
```

I tried to fix it with an index — `(institute_id, test_paper_id) INCLUDE (marks)`, then `VACUUM ANALYZE` so an index-only scan was available. **The plan did not change.** It cannot: the query genuinely wants every row. It is O(institute history) on the most-visited page, so at 20M rows it is a multi-second query on every dashboard load.

The fix is to ask for one paper instead of all of them:

```sql
WHERE a.institute_id = 1
  AND a.test_paper_id = (SELECT id FROM ingestion_testpaper
                         WHERE institute_id=1 ORDER BY held_on DESC LIMIT 1)
```
```
Aggregate (actual rows=1)  Buffers: shared hit=56   Execution Time: 0.687 ms
```

**12x faster, and it stops growing with history.** Two separate bugs while you are in there: the field is named `batch_mock_avg` but it is a `SUM` over every student, not an average; and `revision_debt_pct` divides a sum of debts by a student count and calls the result a percentage.

**⑥ RLS costs almost nothing — except on `syllabus_topic`.** The `institute_id = app_current_institute()` policies collapse to a `One-Time Filter` evaluated once per statement, not per row:

```
->  Result  (cost=0.29..8.31 rows=1)
      One-Time Filter: (app_current_institute() = 1)
      ->  Index Scan Backward using idx_attempt_stu_top_ts on events_attempt
```

That is the payoff for declaring the function `STABLE`. Measured overhead on the hot path: **0.058 ms → 0.047 ms**, i.e. noise.

`syllabus_topic` is the exception, because it has no `institute_id` and its policy is an `EXISTS`:

```
Seq Scan on syllabus_topic  (cost=0.00..220.68 rows=71)
  Filter: (hashed SubPlan 2)
  Rows Removed by Filter: 71
```

The subplan is hashed (evaluated once), but the *filter* still runs against every topic row in the database, and it pushes the three-level subject rollup from a Hash Join into Merge Join + Nested Loop + Memoize: **22 buffers / 0.5 ms → 58 buffers / 1.5 ms**. Cost is linear in total topics across all tenants — 142 today, ~4,000 at 20 institutes.

**The fix is to denormalise `institute_id` onto `Topic`.** I prototyped it in a rolled-back transaction: the topic scan node drops from cost 232.54 to 53.28 (**4.4x**) and the SubPlan disappears. **I did not ship it**, for three reasons: the wall-clock difference is under 1.5 ms at current and near-term scale; the transaction-local `UPDATE` bloated the table enough that the buffer counts are not honestly comparable, so I only have a cost-model number; and changing a model mid-handoff, in a sequential pipeline where you are about to build against it, is the wrong trade for a millisecond. **Trigger to revisit: when total `syllabus_topic` rows pass ~2,000, or when the subject rollup shows up in slow-query logs.** It would also make `Topic` a proper `TenantScoped` model, which is tidier than it is now.

### Answers to SYSTEM_DESIGN §8 open questions

#### Q1 · Adjacency list or `ltree`? → **Keep the adjacency list. Not close.**

The question assumes an arbitrary-depth tree. It is not one:

```
 kind    | count        max_depth
 chapter |   112        ---------
 unit    |    24                3
 subject |     6
```

**Depth is exactly 3, always**, and it is enforced by the schema — `Topic.KIND` enumerates `subject | unit | chapter` and nothing else. `Exam → Subject → Unit → Chapter` is a fixed taxonomy, not a general hierarchy.

That collapses the entire case for `ltree`, whose value is arbitrary-depth subtree queries. At fixed depth 3, "everything under Physics" is two `LEFT JOIN`s — which is what `views.py` already writes as `topic__parent__parent__name`:

```
two LEFT JOINs:   Execution Time: 0.127 ms   Buffers: 12
recursive CTE:    Execution Time: 0.352 ms   Buffers: 16   (27 rows under Physics)
```

The recursive CTE — the supposed pain the doc worries about — costs **0.35 ms** on the real tree, and it is O(subtree), so 20x the syllabus makes it ~0.5 ms. Against that, `ltree` costs a non-core extension, a materialised path that must be rewritten across the whole subtree on every reparent (and the syllabus editor's whole job is reparenting), and `parent_id` kept anyway for referential integrity. **Revisit only if depth stops being fixed** — e.g. if sub-chapters or concept-level nodes get added below `chapter`.

#### Q2 · `TopicState` as a table or a materialized view? → **Table. The doc's lean was right, for a better reason than performance.**

Performance first, since it is measurable. Full rebuild of the rung-0 aggregate from the event log:

```
HashAggregate (actual rows=2530)  Group Key: student_id, topic_id
  ->  Seq Scan on events_attempt (actual rows=24000)
  Execution Time: 7.8 ms
```

24k attempts → 2,530 rows in **7.8 ms**. Linear, so 20M attempts → ~6.5 s producing ~720k rows. A nightly wholesale rebuild is trivially affordable either way, so performance does not decide it.

**Two things decide it, and both are disqualifying for a matview:**

1. **A matview can only hold what one `SELECT` can compute, and `TopicState` holds things SQL cannot produce.** `mastery` is time-decayed and deliberately **null below an evidence floor**; `retention` is an FSRS-style forecast against a fixed exam date; `self_rating` comes from `ConfidenceRating`; `last_revised` from `RevisionEvent`. Rung 0 (rolling accuracy) is expressible in SQL — that is the window function in §4 — but rungs 1–3 (BKT → IRT → DKT) are Python model output. Choosing a matview means throwing it away at the first rung upgrade, which the design explicitly plans for.
2. **A matview has no incremental path.** §1.3 requires on-event updates touching only the affected `(student, topic)` rows. `REFRESH MATERIALIZED VIEW` is wholesale; `REFRESH ... CONCURRENTLY` needs a unique index and roughly doubles the work.

The one thing a matview was supposed to buy — a simple, always-correct wholesale rebuild — you get anyway, because 6.5 s is cheap. Keep the table; keep the nightly full rebuild as the correctness backstop.

#### Q4 · Partition `attempts` by month, by institute, or not yet? → **Not yet. When you do, by month (`RANGE(ts)`), and for maintenance, not for queries.**

The seed cannot settle this by itself (3 months, one institute: 6900 / 6900 / 10200), so the argument is from the query mix plus the design's own volume arithmetic (45k/institute/month → ~21.6M over two years).

**Partitioning would not speed up a single query in `views.py` today**, and that is the finding:

- Every hot endpoint (`topic_states`, `marks_lost`, `attempts`, `mock_scores`, `subject_breakdown`, the mastery window) enters on `student_id`. That is an index lookup returning a few hundred rows. Partition pruning saves nothing an index is not already saving.
- The one query that *does* scan broadly — the dashboard aggregate — wants **every paper ever held**, so monthly pruning would not prune it either. And it should be rewritten to one paper (see ⑤), after which it is an index lookup too.
- Partitioning by **institute** is the worse of the two: adding customer #21 becomes a DDL change, partitions are uneven, and RLS already forces `institute_id` into every request-path query, so the planner has the predicate regardless. One institute is ~5% of rows at target scale — an index handles that.

**What partitioning actually buys at 20M rows is maintenance**, and that is a real benefit worth taking eventually: `VACUUM` and index builds scoped per partition rather than per table, and a monthly partition can be detached and archived when a cohort's exam is two years past. `RANGE(ts)` monthly matches that, and matches the retention/decay access pattern where recent data is hot.

**Concrete trigger:** partition when `VACUUM`/autovacuum on `events_attempt` or an index rebuild becomes an operational problem — roughly when the table passes ~10M rows, as §3.6 already says. Not before. Note one migration cost to plan for: `events_attempt`'s primary key would have to include `ts`, since Postgres requires the partition key in every unique constraint.

#### Q7 · `QuestionTopicMap` per-paper or global per-institute? → **Per-paper. The data makes a global map actively wrong, not merely unnecessary.**

This one looked like it supported the global map, and then reversed on inspection:

```
distinct question_id values: 75        rows: 525        papers: 7
question_id 'Q17' appears in 7 papers  -> looks like heavy recurrence
```

Every `question_id` appears in all 7 papers. But:

```
question_id | distinct topics it maps to across papers
 Q17        | 7
 Q11        | 7
 Q12        | 7
```

**Q17 maps to seven different topics.** `question_id` is a *position label* (`Q1`..`Q75`), not a content identity. Q17 of Mock 8 and Q17 of Mock 14 are different questions that happen to sit in the same slot. A global map keyed on `question_id` would be wrong for **100%** of rows — and silently, producing confident mastery numbers attributed to the wrong chapters. The existing `UniqueConstraint(test_paper, question_id)` is doing exactly the right thing.

A global map is only coherent on a **content hash of the question text**. And:

```
rows: 525    rows with question_text populated: 0
```

There is no content to hash. Institutes export answer keys and score sheets, not question text — that is precisely why §5's mapping ladder puts "LLM reads question text" *last*, behind institute chapter tags and paper blueprints.

**Recommendation:** keep per-paper as the storage key. If content-based reuse is wanted later, add it as a *cache in front*, never as a replacement: a nullable `question_hash` column populated when text is available, used to pre-fill `topic` with `proposed_by='hash'` for a human to confirm. That keeps the one-human-confirmation-per-question invariant, which is what makes the economics work, and it degrades to today's behaviour when text is absent — which is currently always.

### ▶ What the BACKEND agent can build now

**Every model is stable.** No field will move under you. Build against them.

1. **The rung-0 mastery service** (`apps/derived/services/`). The aggregate is measured at 7.8 ms for the full 24k-row rebuild; the window function from SYSTEM_DESIGN §4 is the shape. Wrap per-tenant recompute in `tenant_scope(inst.id)`.
2. **`recompute_features`** — must be idempotent and must rebuild `TopicState` + `StudentState` from events alone. Nothing in `derived/` may be the only copy of anything.
3. **Detectors** (`weak_topic`, `over_attempting`, `plateau` are the Tier-0 three). `idx_flag_open` is in place for the console query. Populate `Flag.evidence` and `Flag.rule_version` — the admin renders `evidence` as pretty JSON and it is how a director's "why was this flagged?" gets answered.
4. **Fix the dashboard query** (finding ⑤) — 12x, with the SQL given.
5. **Fix `TenantScopedMixin.institute_id()`** to return `int | None` rather than a bare query-param string.

**Avoid:** `makemigrations` / `migrate` (mine); any `.save()` or `.update()` against `Attempt`, `StudyLog`, `ConfidenceRating`, `RevisionEvent` — they are append-only and the admin refuses to edit them, which is the standard your services should hold to as well.

### ▶ What the TESTING agent can test now

- **RLS.** `manage.py rls_check` is the integration proof and exits non-zero — wire it into CI directly. For pytest, use `tenant_scope(inst.id)` and assert the three properties separately: partition (counts sum to the unscoped total), **disjointness** (`Model.objects.exclude(institute_id=inst.id).count() == 0` while scoped), and **fail-closed** (no scope → `.count() == 0`). Do not assert only "the counts differ" — see the `syllabus_topic` 71/71 case above.
  - ⚠ pytest creates a **fresh test database**, and `tenancy/0003` runs there, so RLS is live in tests. The test role is `sai` (BYPASSRLS), so tests see everything *unless* they enter `tenant_scope`. That is the behaviour you want, but it means an RLS test that forgets `tenant_scope` will pass vacuously.
- **Append-only.** Assert `Attempt` has no update path: `AttemptAdmin.has_change_permission()` is `False`, and a correction must arrive as a new row.
- **Rebuild equivalence.** Delete all of `derived/`, replay, assert identical output. This is the highest-value test in the project (`TECHNICAL_DOC.md` §14) and the schema now supports it fully.
- **Admin smoke test.** All 23 changelists and detail pages return 200 — I verified it manually; it belongs in a test. It catches `list_editable`/`list_display` config errors that `manage.py check` does not, and it caught three real N+1s here.
- **Fixtures.** 2 institutes / 49 students / 24,000 attempts / 7 papers / 525 mappings / 2,530 topic states / 6 flags. **Institute 2 (Pinnacle Academy) has 3 students and zero events** — useful as an empty-tenant case, useless as a second data set.

### ⚠ Gaps and known issues

1. **`auth_user_custom` has no RLS policy.** `User` carries no `institute_id` and no API endpoint lists users, so there is no current exposure — but a future "list my institute's mentors" endpoint would need a policy via `EXISTS` on `tenancy_mentor`/`tenancy_student`. Flagging it so it is a decision, not an oversight.
2. **`syllabus_exam` is intentionally global** (JEE_MAIN, NEET). Shared reference data, no policy, correct as-is.
3. **Superusers bypass RLS entirely.** By design (§ the admin is cross-tenant back-office) but it means a compromised superuser account sees every tenant. Production should give directors *staff, non-superuser* accounts, which are scoped.
4. **The middleware depends on session auth.** `request.user` must be populated before the view runs. Add JWT/token auth and the middleware silently stops scoping — the mixin would be the only thing left. Tell me if you add it.
5. **`syllabus_topic`'s RLS policy costs an EXISTS per query** — measured, bounded, and the denormalisation fix is specified above with a trigger.
6. **The `student_ai_rls` role is cluster-wide**, created by the migration and deliberately *not* dropped on reverse — dropping a role fails noisily if anything still depends on it. Reversing `tenancy/0003` removes policies and grants, leaving the role.
7. **`idx_attempt_stu_paper` is not yet chosen by the planner** at 44 students/paper. Explained in ② with the crossover arithmetic. Not a bug; do not "fix" it by dropping the index.
8. **Deliberately deferred:** partitioning (Q4 — not yet), `Topic.institute_id` denormalisation (⑥ — has a trigger), the 13 prefix-redundant FK indexes (④ — Django's abstract-base field rules make it a bad trade).

---

# 2 · BACKEND AGENT

> Status: **terminated early on a session rate limit — work salvaged, verified and merged by the main session (`9b0d328`).**
>
> Everything below was verified by running it, not by reading it.

### What was built and confirmed working

| Component | File | Verified by |
|---|---|---|
| Feature store | `apps/derived/services/features.py` | `recompute_features` → 2,625 rows, 482ms |
| Detector engine | `apps/derived/services/detectors.py` | `run_detectors` → 75 flags from 392 evaluations |
| Mock analyzer | `apps/events/services/mock_analysis.py` | imported by `views.py`, schema regenerated |
| Auth | `apps/api/auth.py` | `/api/auth/{csrf,login,logout}/`, `/api/me/` |

**Evidence floor works:** mastery reported on 1,920 topic states, **withheld on 656 (25%)** below the 4-attempt floor. Null rather than a confident number from too little data.

**Alert hygiene works:** 5 raises suppressed by cooldown on the seeded hero flags (`an open flag of this type already exists`).

**Aarav Mehta's `subject_imbalance` evidence, from the database:**
```json
{"marks_trend": -37, "weakest_unit": "Organic Chemistry",
 "time_share_pct": 11, "marks_lost_share_pct": 46}
```

### Contract changed — 18 → 22 endpoints
Added `/api/auth/csrf/`, `/api/auth/login/`, `/api/auth/logout/`, `/api/me/`.
`MarksLost` and `DashboardSummary` both gained fields. `openapi.yaml` regenerated.

DRF's browsable-API login moved from `api/auth/` to `api-auth/` — it would have shadowed the JSON login the console posts to.

### ⚠ Not finished (rate limit hit mid-task)
- The dashboard Seq Scan fix was **in progress** — `_EMPTY_SUMMARY` and latest-paper fields exist, but the 12x improvement is unverified. Re-measure before trusting it.
- No handoff notes were written by the agent itself; this section is reconstructed from the diff and from running the code.

### ▶ What the TESTING agent can test now
- `rls_check` as a pytest case — isolation, fail-closed, cross-tenant write refusal
- Rebuild equivalence: drop `TopicState`, rerun `recompute_features`, assert identical
- Detector replay: known event stream → assert a specific flag fires with specific evidence
- Alert hygiene: assert cooldown suppresses a second raise
- Contract tests: every response validated against `openapi.yaml`

### ⚠ Known issue — seed data realism
41 of 75 `weak_topic` flags read "**0% over N attempts**". Real students do not score 0% over 16 attempts on a chapter. This is an artefact of `seed_demo`: it sorts questions by latent ability and marks the top *c* correct, so the weakest chapters are *deterministically* always wrong. Harmless for testing detector logic, but **it would undermine a live demo** — a director will notice. Needs noise injected into the status assignment.

---

### What I added

### Contract changes
_(Did `openapi.yaml` change? Which endpoints? The frontend agent needs to know.)_

### ▶ What the TESTING agent can test now

### ⚠ Gaps and known issues

---

# 3 · TESTING AGENT

> Status: **waiting on backend agent**

### What I added

### What passes / what fails

### ⚠ Bugs found
_(Route these back — say which agent owns each.)_

---

# 4 · FRONTEND AGENT

> Status: **terminated early on a session rate limit — work salvaged, resynced and merged (`dc00c5a`, `b3e23ec`).**

### What was built
82 files in `web/`. Vite + React + TS + Tailwind + shadcn/ui (21 UI primitives).

- **Routes:** `DirectorConsole`, `Student360`, `MockIntelligence`, `NotFound`
- **Charts:** `NeglectChart` (time-share vs marks-lost), `MockTrendChart`, `MarksLostBar`, `Sparkline` — each wrapped in a `Figure` that offers a table view
- **Director:** `KpiStrip`, `TriageTable`, `EvidenceList`, `InterveneDialog`, `ClosedLoopPanel`
- **Student:** `HealthHeader`, `TopicMasteryGrid`, `DayPlanPanel`, `StudentFlagsPanel`
- **MSW** with seeded deterministic fixtures — the console runs with **no backend at all**

Verified: `typecheck` clean, `build` succeeds, **5/5 tests pass** (including "every chart offers a table view" and "logging an intervention closes the flag and drops the row").

### The drift it caught — contract-first working as intended
Types were generated from the **18-endpoint** schema. After the backend's additions, `npm run build` **failed to compile** on two fixtures missing new required fields. That is the system behaving correctly: drift surfaced as a compile error rather than as a blank panel in front of a buyer. Resynced in `b3e23ec`.

### Contract gaps — `web/src/api/gaps.ts`
Every gap is named in one greppable file rather than worked around inside components; when the contract catches up, the entry is deleted and the call sites stop compiling.

**Now closed by the backend:** `NO_SESSION_ENDPOINT` (`/api/me/` exists), `MARKS_LOST_DENOMINATOR` (`max_marks` + `score` now on the payload).

**Still open — for the next backend pass:**

| Gap | Nature |
|---|---|
| `FLAGS_OPEN_FILTER` | The view **supports** `?open=true`; the schema doesn't declare it. Add `@extend_schema(parameters=[...])` |
| `MOCK_SCORES_ORDER` | Same shape — the view sorts by `held_on`, the contract doesn't promise it |
| `FLAGS_STUDENT_FILTER` | Not implemented. Student 360 fetches all flags and filters client-side |
| `STUDENTS_ORDERING` | Not implemented. Triage table sorts client-side |
| `DASHBOARD_BATCH_SCOPE` | Not implemented. Console has a batch filter the KPI strip ignores |
| `NO_MENTOR_LIST` | Intervention needs a mentor id; no endpoint lists mentors |
| `RISK_SCORE_BANDS` | Documentation — `risk_score` has no stated scale or severity thresholds |

The first two are the interesting category: **the code does it, the contract doesn't say so.** Exactly what a contract-first setup is meant to expose.

### ⚠ Known issues
- One layout bug the agent reported before terminating: **value labels detach from short bars in the neglect chart.**
- The console has **never been pointed at the live API** — only MSW. First real integration is untested.
