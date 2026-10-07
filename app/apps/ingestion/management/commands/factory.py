"""The question factory: real past papers in, cross-checked against the official key.

    python manage.py factory fetch   neet_ug_2025_code45
    python manage.py factory prepare neet_ug_2025_code45
    python manage.py factory read    neet_ug_2025_code45 --max-calls 10
    python manage.py factory solve   neet_ug_2025_code45
    python manage.py factory check   neet_ug_2025_code45
    python manage.py factory tag     neet_ug_2025_code45
    python manage.py factory load    neet_ug_2025_code45 --institute aarambh
    python manage.py factory report  neet_ug_2025_code45
    python manage.py factory all     neet_ug_2025_code45 --institute aarambh

    python manage.py factory list

Every model step is cached and resumable: re-running a step only does what
is missing, and a step that runs out of quota stops cleanly with its work
saved. See `apps/ingestion/factory/__init__.py` for the why.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError

from apps.tenancy.models import Institute

STEPS = ("fetch", "prepare", "read", "solve", "check", "tag", "load", "report", "all", "list")


class Command(BaseCommand):
    help = "Build trustworthy questions from official past papers."

    def add_arguments(self, parser):
        parser.add_argument("step", choices=STEPS)
        parser.add_argument("paper", nargs="?", help="paper slug, e.g. neet_ug_2025_code45")
        parser.add_argument("--institute", default="aarambh",
                            help="whose ReasoningTraces / TestPaper (default aarambh)")
        parser.add_argument("--max-calls", type=int, default=None,
                            help="live Gemini calls this step may spend (cache hits are free)")
        parser.add_argument("--force", action="store_true",
                            help="ignore cached traces and stored results for this step")
        parser.add_argument("--wait", type=int, default=0, metavar="ROUNDS",
                            help="solve: when every model is busy, wait and retry this "
                                 "many times (off by default — failed requests seem to "
                                 "count against the daily cap)")
        parser.add_argument("--replace", action="store_true",
                            help="load: rebuild the TestPaper if it exists and has no attempts")

    def handle(self, *args, **opts):
        from apps.ingestion.factory import papers

        step = opts["step"]
        if step == "list":
            for slug, spec in papers.PAPERS.items():
                self.stdout.write(f"  {slug:28} {spec.display_name}")
            return
        if not opts["paper"]:
            raise CommandError("Which paper? See `manage.py factory list`.")
        try:
            spec = papers.get(opts["paper"])
        except KeyError as exc:
            raise CommandError(str(exc)) from None

        steps = (["fetch", "prepare", "read", "solve", "check", "tag", "load", "report"]
                 if step == "all" else [step])
        for s in steps:
            self.stdout.write(self.style.MIGRATE_HEADING(f"{s} · {spec.display_name}"))
            getattr(self, f"_{s}")(spec, opts)

    # ------------------------------------------------------------------

    def _institute(self, opts) -> Institute:
        try:
            return Institute.objects.get(slug=opts["institute"])
        except Institute.DoesNotExist:
            raise CommandError(f"No institute '{opts['institute']}'.") from None

    def _doc(self, spec):
        from apps.ingestion.factory import store

        doc = store.load(spec.slug)
        if doc is None:
            raise CommandError(f"No extracted file for {spec.slug}. Run `factory prepare` first.")
        return doc

    def _budget(self, opts):
        from apps.ingestion.factory.runner import Budget

        return Budget(max_live=opts["max_calls"])

    def _fetch(self, spec, opts):
        from apps.ingestion.factory.prepare import fetch

        for e in fetch(spec):
            self.stdout.write(f"  {e['file']}  {e['provenance']}  sha256 {e['sha256'][:16]}…  "
                              f"{e['pages']} pages")

    def _prepare(self, spec, opts):
        from apps.ingestion.factory.prepare import prepare

        doc = prepare(spec)
        qs = doc["questions"]
        mcq = sum(1 for q in qs if q["answer_type"] == "mcq")
        multi = [q["number"] for q in qs if len(q["official"]["labels"]) > 1]
        dropped = [q["number"] for q in qs if q["official"]["dropped"]]
        self.stdout.write(f"  {len(qs)} questions ({mcq} MCQ, {len(qs) - mcq} numerical), "
                          f"official key parsed for every one")
        if multi:
            self.stdout.write(f"  NTA accepts more than one option on: {multi}")
        if dropped:
            self.stdout.write(f"  dropped by NTA: {dropped}")
        bc = doc["paper"].get("booklet_check")
        if bc:
            self.stdout.write(
                f"  booklet code {bc['claimed_code']} proven: mirror key matches NTA's "
                f"code {bc['claimed_code']} on {bc['matches_by_code'][bc['claimed_code']]}/"
                f"{bc['questions']}; other codes {bc['matches_by_code']}"
            )
        if spec.layout == "jee_cbt":
            self.stdout.write("  every MCQ key cell mapped through its option id")

    def _read(self, spec, opts):
        from apps.ingestion.factory import read

        doc = self._doc(spec)
        budget = self._budget(opts)
        read.run(spec, doc, institute_id=self._institute(opts).id, budget=budget,
                 force=opts["force"], log=self.stdout.write)
        self._summary(doc, budget, "read")

    def _solve(self, spec, opts):
        from apps.ingestion.factory import solve

        doc = self._doc(spec)
        budget = self._budget(opts)
        solve.run(spec, doc, institute_id=self._institute(opts).id, budget=budget,
                  force=opts["force"], log=self.stdout.write, wait_rounds=opts["wait"])
        self._summary(doc, budget, "solve")

    def _check(self, spec, opts):
        from apps.ingestion.factory import check

        doc = self._doc(spec)
        stats = check.run(spec, doc)
        self.stdout.write(check.render(stats))

    def _tag(self, spec, opts):
        from apps.ingestion.factory import tag

        doc = self._doc(spec)
        budget = self._budget(opts)
        tag.run(spec, doc, institute_id=self._institute(opts).id, budget=budget,
                force=opts["force"], log=self.stdout.write)
        self._summary(doc, budget, "tags")

    def _load(self, spec, opts):
        from apps.ingestion.factory import load

        doc = self._doc(spec)
        try:
            result = load.load(spec, doc, self._institute(opts), replace=opts["replace"])
        except load.LoadRefused as exc:
            raise CommandError(str(exc)) from None
        self.stdout.write(load.render(result))

    def _report(self, spec, opts):
        from apps.ingestion.factory import check

        doc = self._doc(spec)
        self.stdout.write(check.render(check.stats(doc), detail=True))

    def _summary(self, doc, budget, key):
        have = sum(1 for q in doc["questions"] if q.get(key))
        self.stdout.write(
            f"  {have}/{len(doc['questions'])} done · live calls {budget.live} · "
            f"cache hits {budget.cached} · requests sent {budget.attempts}"
            + (f" · stopped: {'; '.join(budget.notes)}" if budget.notes else "")
        )
