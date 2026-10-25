"""The nightly refresh — every engine, in order, once per institute.

    from apps.derived.services import nightly
    nightly.run_nightly()                       # every institute
    nightly.run_for_institute(inst, as_of=...)  # one, returning its JobRun

Until this existed every engine ran by hand: `recompute_features`, then
`run_detectors`, then `generate_plans`, and nothing at all scheduled
revisions. A pilot institute cannot be asked to remember four commands a
night, and a forecast like `TopicState.retention` is only as fresh as the
last time someone did.

THE ORDER, AND WHY IT IS THIS ONE
    1. `features.recompute`          — mastery, retention, the student rollup.
    2. `revisions.schedule_revisions` — reads only events; writes rows due
       today or later, so it cannot change what step 1 computed (a new row is
       neither done nor overdue).
    3. `detectors.run_detectors`     — reads the store step 1 just refreshed.
       Run on a stale store, it raises confident flags about last month.
    4. `planner.generate_for_student` for every active student, **without
       `replace`**: a plan a student already made today (or ticked) is theirs.
       The planner reads the flags step 3 raised, so the burnout guard sees
       tonight's state.
    5. `guidance.reword_findings` for every student with a diagnosis their
       mentor agreed with: the model rewords it for the student *now*, so the
       student's guide page — which never calls the model — finds it in the
       cache in the morning. At most `MAX_NIGHTLY_MODEL_REQUESTS` model
       requests per institute (the free tier is ~20 a day per model).
       Best-effort, per student, like step 4; without an API key it does
       nothing.

FAILURE, AND WHAT IT LEAVES BEHIND
    Each institute runs inside `tenant_scope`, so Postgres refuses a
    cross-tenant write rather than this code merely not attempting one.
    Steps 1–3 each run in their own transaction: a step that fails is
    rolled back whole, the steps before it stand (each is idempotent, so
    the next night simply redoes them), and the steps after it are skipped
    because they would read its half-finished output. Steps 4 and 5 are per
    student — one student's plan or rewording failing is counted and logged,
    and the other students still get theirs.

    One institute failing never stops the next. Every institute that ran to
    the end leaves a `JobRun` receipt, `ok` or `failed`; a run interrupted
    from outside (Ctrl-C, a killed process) leaves none, because it did not
    finish and a receipt that says otherwise would be the one lie this table
    exists to prevent.
"""

from __future__ import annotations

import datetime as dt
import logging
import time
from collections.abc import Iterable

from django.db import transaction
from django.utils import timezone

from apps.derived.models import JobRun
from apps.derived.services import detectors, features, planner, revisions
from apps.reasoning.models import ReasoningTrace
from apps.tenancy.models import Institute, Student
from apps.tenancy.rls import tenant_scope

logger = logging.getLogger(__name__)

#: `JobRun.error` is a one-line summary for an operator, not a traceback.
MAX_ERROR_CHARS = 2000

#: Model requests for rewording approved findings, per institute per night
#: (step 5). A request, not a rewording: one rewording that walks the model
#: chain can spend several, and quota is counted per request.
#: Half the free tier's ~20 requests per model per day, leaving the rest for
#: the day's own calls — a student's question, a mentor's diagnosis.
MAX_NIGHTLY_MODEL_REQUESTS = 10


def done_today(institute_id: int, day: dt.date | None = None) -> bool:
    """Whether this institute already has a successful nightly run started `day`.

    Asked inside the institute's own tenant scope, so the answer is the same
    whether the caller connects as the BYPASSRLS dev role or a policed one.
    """
    day = day or timezone.localdate()
    with tenant_scope(institute_id):
        return JobRun.objects.filter(
            institute_id=institute_id, kind=JobRun.NIGHTLY, status=JobRun.OK,
            started_at__date=day,
        ).exists()


def _plans(institute: Institute, day: dt.date) -> dict:
    today = timezone.localdate()
    if not today <= day <= today + dt.timedelta(days=planner.MAX_DAYS_AHEAD):
        # A rebuild "as of" a past date has no business writing a plan for a
        # day that is over; the plan is advice, not history.
        return {"skipped": f"no plans for {day.isoformat()}: outside today..+{planner.MAX_DAYS_AHEAD}"}
    out = {"day": day.isoformat(), "students": 0, "generated": 0, "blocks": 0, "failed": 0}
    for student in (
        Student.objects.filter(institute_id=institute.id, exited_at__isnull=True)
        .select_related("batch").order_by("id")
    ):
        out["students"] += 1
        try:
            blocks, generated = planner.generate_for_student(student, day)
        except Exception:
            # `generate_for_student` is atomic, so its writes are already
            # rolled back; the student keeps yesterday's habits, not half a plan.
            logger.exception("nightly: could not plan for student %s", student.id)
            out["failed"] += 1
            continue
        if generated:
            out["generated"] += 1
            out["blocks"] += len(blocks)
    return out


def _findings(institute: Institute) -> dict:
    # Imported here: `reasoning` builds on `derived` (the guidance reads
    # plans and states), so a module-level import would be circular.
    from apps.reasoning.services import guidance

    out = {"students": 0, "reworded": 0, "model_requests": 0, "failed": 0}
    left = MAX_NIGHTLY_MODEL_REQUESTS
    rewordings = ReasoningTrace.objects.filter(
        institute_id=institute.id, task=ReasoningTrace.EXPLAIN_FOR_STUDENT)
    for student in Student.objects.filter(
        id__in=guidance.students_with_findings(institute.id), exited_at__isnull=True,
    ).order_by("id"):
        out["students"] += 1
        before = rewordings.count()          # one trace per attempt, failures too
        try:
            found = guidance.reword_findings(
                student, live_budget=min(guidance.MAX_LIVE_REWORDINGS, left))
        except Exception:
            logger.exception("nightly: could not reword findings for student %s", student.id)
            out["failed"] += 1
            found = []
        spent = rewordings.count() - before
        out["model_requests"] += spent
        out["reworded"] += sum(1 for item in found if item["reworded"])
        left = max(0, left - spent)
    return out


def run_for_institute(institute: Institute, *, as_of: dt.datetime | None = None) -> JobRun | None:
    """Run the five steps for one institute and return its receipt.

    Returns None only when not even the receipt could be written (the
    tenant scope itself failed) — that is logged, and is what the caller
    reports as a failure.
    """
    as_of = as_of or timezone.now()
    day = timezone.localtime(as_of).date()
    started = timezone.now()
    stats: dict = {"as_of": as_of.isoformat(), "timings_ms": {}}
    status, error, step = JobRun.OK, "", None

    def timed(name: str, fn):
        nonlocal step
        step = name
        t0 = time.perf_counter()
        result = fn()
        stats["timings_ms"][name] = round((time.perf_counter() - t0) * 1000)
        return result

    def atomic(fn):
        def run():
            with transaction.atomic():
                return fn()
        return run

    try:
        with tenant_scope(institute.id):
            try:
                f = timed("features", atomic(lambda: features.recompute(institute.id, as_of=as_of)))
                stats["features"] = {
                    "students": f.students, "rows_written": f.rows_written,
                    "rows_deleted": f.rows_deleted, "mastery_reported": f.mastery_reported,
                    "mastery_withheld": f.mastery_withheld,
                }
                stats["revisions"] = timed(
                    "revisions",
                    atomic(lambda: revisions.schedule_revisions(institute.id, today=day)),
                )
                run = timed(
                    "detectors", atomic(lambda: detectors.run_detectors(institute.id, as_of=as_of))
                )
                stats["detectors"] = {
                    "students": run.students, "evaluated": run.evaluated,
                    "raised": run.raised, "suppressed": run.suppressed,
                    "by_type": run.by_type(),
                }
                stats["plans"] = timed("plans", lambda: _plans(institute, day))
                stats["findings"] = timed("findings", lambda: _findings(institute))
            except Exception as exc:
                status = JobRun.FAILED
                error = f"{step}: {type(exc).__name__}: {exc}"[:MAX_ERROR_CHARS]
                logger.exception("nightly: institute %s failed at %s", institute.id, step)
            return JobRun.objects.create(
                institute=institute, kind=JobRun.NIGHTLY, started_at=started,
                finished_at=timezone.now(), status=status, stats=stats, error=error,
            )
    except Exception:
        logger.exception("nightly: could not run or record institute %s", institute.id)
        return None


def run_nightly(
    institutes: Iterable[Institute] | None = None,
    *,
    as_of: dt.datetime | None = None,
    skip_done_today: bool = False,
) -> list[tuple[Institute, JobRun | None]]:
    """Run every institute (or the ones given), one after the other.

    `skip_done_today` leaves out institutes that already have an `ok` run
    started today — what the scheduler uses so a restart cannot double-run.
    Returns `(institute, receipt)` pairs for the institutes that ran.
    """
    targets = list(institutes) if institutes is not None else list(Institute.objects.order_by("id"))
    out = []
    for institute in targets:
        if skip_done_today and done_today(institute.id):
            continue
        out.append((institute, run_for_institute(institute, as_of=as_of)))
    return out
