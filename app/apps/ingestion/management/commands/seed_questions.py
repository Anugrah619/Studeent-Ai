"""Seed the diagnostic paper: real content, and students who err *consistently*.

    python manage.py seed_questions --institute aarambh --reset
    python manage.py verify_signatures --institute aarambh

The second half matters more than the first. Our original seeder ranks
questions by a hidden ability score and marks the top `c` correct, which
produces wrong answers with no structure at all. Run a diagnosis engine
over that and it finds nothing — because there is nothing there.

Here each hero student carries a *signature misconception*. When a question
offers the distractor that belief produces, they take it most of the time.
That is what a real struggling student looks like, and it is the only way
the reasoning layer can be shown to work rather than asserted to.

Two things are deliberate and easy to lose in a later edit:

**Counter-evidence.** Questions marked `counter_to` in demo_questions.py sit
in the same chapter as the bait but remove the trigger — the directing
group is stated, the axis is the tabulated one, the alkene is symmetric.
The hero answers those correctly, by construction, because the belief has
nothing to act on. That is what produces "on the two questions where the
directing group was stated, he was correct — this is not a topic gap, it's
a specific trigger", which is the line the whole pitch turns on. Without
it the diagnosis is indistinguishable from "revise Organic Chemistry".

**Option order.** The bank is written correct-answer-first because that is
readable. The paper is seeded with the labels shuffled, deterministically,
so the correct answer is not always (A). A demo where every answer is A is
a demo nobody believes.
"""

from __future__ import annotations

import random
from collections import Counter
from datetime import date, datetime, time

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.events.models import Attempt
from apps.ingestion.demo_questions import MISCONCEPTIONS, QUESTIONS
from apps.ingestion.models import (
    Misconception,
    QuestionOption,
    QuestionTopicMap,
    TestPaper,
)
from apps.syllabus.models import Exam, SyllabusVersion, Topic
from apps.tenancy.models import Institute, Student

SEED = 20260925
PAPER_NAME = "Mock 15 — Diagnostic"
HELD_ON = date(2026, 9, 20)
DURATION_MIN = 120

#: Who reliably makes which mistake. This is the pattern the reasoning
#: layer has to find; if it cannot find *this*, it cannot find anything.
SIGNATURES = {
    "Aarav Mehta": "MIS-ORG-EAS",        # the demo's hero thread
    "Kunal Deshpande": "MIS-ROT-AXIS",   # rates Mechanics 5/5, scores badly
    "Tanvi Shah": "MIS-CALC-CHAIN",
    "Ishita Rao": "MIS-ORG-MARKOV",
}

#: On how many of the questions that bait their signature does a hero NOT
#: take it. Not zero — a hero who goes six from six reads as staged, and a
#: model handed a perfect pattern is being given the answer rather than
#: asked to weigh evidence.
#:
#: This is a count rather than a probability on purpose. A per-question coin
#: flip at, say, 0.78 leaves only a ~61% chance that any one hero clears five
#: of six, so all four clearing it is a ~14% event — meaning a later edit to
#: the bank could reshuffle the stream and quietly produce a demo with no
#: detectable signature in it. Fixing the count and letting the seed choose
#: *which* question is missed keeps the texture and drops the failure mode.
SIGNATURE_MISSES = 1

#: Heroes are good students with one hole, not weak students. Their accuracy
#: away from the signature has to be high, or the signature drowns in noise
#: and the honest reading of the data becomes "he is simply behind".
HERO_BASELINE = (0.80, 0.88)

#: Everyone else. Wide, because a real cohort is wide.
COHORT_BASELINE = (0.45, 0.78)


class Command(BaseCommand):
    help = "Seed misconception-tagged questions and consistent student errors."

    def add_arguments(self, parser):
        parser.add_argument("--institute", default="aarambh")
        parser.add_argument("--reset", action="store_true",
                            help="Delete the diagnostic paper and reseed it")

    @transaction.atomic
    def handle(self, *args, **opts):
        rng = random.Random(SEED)

        try:
            institute = Institute.objects.get(slug=opts["institute"])
        except Institute.DoesNotExist:
            raise CommandError(
                f"No institute '{opts['institute']}'. Run seed_demo first."
            )

        self._validate()
        mis = self._misconceptions()

        if opts["reset"]:
            self._reset(institute)

        paper = self._paper(institute)
        questions = self._questions(institute, paper, mis, rng)
        self._answers(institute, paper, questions, rng)
        self._report(institute, paper)

    # ------------------------------------------------------------------
    # Content checks. These run before anything is written, because a bank
    # that quietly contradicts itself produces a demo that quietly lies.

    def _validate(self) -> None:
        codes = {m["code"] for m in MISCONCEPTIONS}
        if len(codes) != len(MISCONCEPTIONS):
            raise CommandError("Duplicate misconception codes in MISCONCEPTIONS.")

        seen_stems: set[str] = set()
        for i, q in enumerate(QUESTIONS, 1):
            where = f"question {i} ({q['stem'][:50]}…)"

            if q["stem"] in seen_stems:
                raise CommandError(f"Duplicate stem at {where}.")
            seen_stems.add(q["stem"])

            labels = [o[0] for o in q["options"]]
            if sorted(labels) != ["A", "B", "C", "D"]:
                raise CommandError(f"{where}: options must be labelled A–D.")

            correct = [o for o in q["options"] if o[2]]
            if len(correct) != 1:
                raise CommandError(
                    f"{where}: expected exactly one correct option, "
                    f"found {len(correct)}."
                )

            tagged = {o[3] for o in q["options"] if o[3]}
            unknown = tagged - codes
            if unknown:
                raise CommandError(f"{where}: unknown misconception {unknown}.")

            if any(o[2] and o[3] for o in q["options"]):
                raise CommandError(
                    f"{where}: the correct option carries a misconception tag."
                )

            # The one that actually bites: a question can only be
            # counter-evidence for a belief it does not also bait.
            clash = set(q.get("counter_to", ())) & tagged
            if clash:
                raise CommandError(
                    f"{where}: marked counter_to {sorted(clash)} but also "
                    f"offers that distractor. Counter-evidence must be a "
                    f"question where the belief cannot fire."
                )
            unknown_counter = set(q.get("counter_to", ())) - codes
            if unknown_counter:
                raise CommandError(
                    f"{where}: counter_to names unknown code {unknown_counter}."
                )

        # Every hero needs enough trials to separate from chance, and at
        # least one question proving the trigger is what matters.
        bait = Counter()
        counters = Counter()
        for q in QUESTIONS:
            for code in {o[3] for o in q["options"] if o[3]}:
                bait[code] += 1
            for code in q.get("counter_to", ()):
                counters[code] += 1

        for name, code in SIGNATURES.items():
            if bait[code] < 5:
                raise CommandError(
                    f"{name}'s signature {code} is baited on only {bait[code]} "
                    f"questions. Five is the minimum at which an 85% hit rate "
                    f"separates from a ~20% cohort rate (binomial p < 0.005)."
                )
            if counters[code] < 1:
                raise CommandError(
                    f"{name}'s signature {code} has no counter-evidence "
                    f"question. Without one the diagnosis cannot distinguish "
                    f"a specific trigger from a topic gap."
                )

        orphans = codes - set(bait)
        if orphans:
            raise CommandError(
                f"These misconceptions are in the taxonomy but no question "
                f"offers their distractor, so they can never be observed: "
                f"{sorted(orphans)}."
            )

    # ------------------------------------------------------------------

    def _misconceptions(self) -> dict[str, Misconception]:
        out = {}
        for spec in MISCONCEPTIONS:
            obj, _ = Misconception.objects.update_or_create(
                code=spec["code"],
                defaults={k: v for k, v in spec.items() if k != "code"},
            )
            out[obj.code] = obj
        by_subject = Counter(m["subject"] for m in MISCONCEPTIONS)
        self.stdout.write(
            f"  {len(out)} misconceptions  "
            + ", ".join(f"{k} {v}" for k, v in sorted(by_subject.items()))
        )
        return out

    def _reset(self, institute) -> None:
        """Drop the paper. Attempt.test_paper is PROTECT, so answers go first."""
        papers = TestPaper.objects.filter(institute=institute, name=PAPER_NAME)
        removed, _ = Attempt.objects.filter(test_paper__in=papers).delete()
        papers.delete()
        if removed:
            self.stdout.write(f"  reset: removed {removed} previous answers")

    def _paper(self, institute) -> TestPaper:
        exam = Exam.objects.get(code="JEE_MAIN")
        paper, created = TestPaper.objects.get_or_create(
            institute=institute, name=PAPER_NAME,
            defaults={
                "exam": exam, "held_on": HELD_ON,
                "total_questions": len(QUESTIONS),
                "max_marks": len(QUESTIONS) * 4,
                "marks_correct": 4, "marks_wrong": -1,
                "duration_min": DURATION_MIN,
            },
        )
        if not created:
            raise CommandError(
                f"'{PAPER_NAME}' already exists. Pass --reset to rebuild it."
            )
        return paper

    def _questions(self, institute, paper, mis, rng) -> list[QuestionTopicMap]:
        syllabus = SyllabusVersion.objects.get(institute=institute, is_active=True)
        topics = {
            t.name: t
            for t in Topic.objects.filter(syllabus=syllabus, kind=Topic.CHAPTER)
        }
        now = timezone.now()
        width = len(str(len(QUESTIONS)))
        built = []

        for i, spec in enumerate(QUESTIONS, 1):
            topic = topics.get(spec["chapter"])
            if topic is None:
                raise CommandError(
                    f"Chapter '{spec['chapter']}' is not in the seeded syllabus "
                    f"tree for '{institute.slug}'. Fix demo_questions.py or "
                    f"reseed the syllabus (manage.py seed_syllabus)."
                )
            q = QuestionTopicMap.objects.create(
                institute=institute, test_paper=paper,
                question_id=f"D{i:0{width}d}",
                topic=topic, question_text=spec["stem"],
                solution=spec["solution"], difficulty=spec["difficulty"],
                proposed_by=QuestionTopicMap.MANUAL, confirmed_at=now,
            )

            # Shuffle which label carries which text, so the key is spread
            # across A–D instead of always landing on the first option.
            shuffled = list(spec["options"])
            rng.shuffle(shuffled)
            QuestionOption.objects.bulk_create([
                QuestionOption(
                    question=q, label=label, text=text, is_correct=correct,
                    misconception=mis.get(code) if code else None,
                )
                for label, (_, text, correct, code) in zip("ABCD", shuffled)
            ])
            built.append(q)

        options = QuestionOption.objects.filter(question__test_paper=paper)
        keys = Counter(
            options.filter(is_correct=True).values_list("label", flat=True)
        )
        by_subject = Counter(
            q.topic.parent.parent.name if q.topic.parent and q.topic.parent.parent
            else "?"
            for q in QuestionTopicMap.objects.filter(test_paper=paper)
            .select_related("topic__parent__parent")
        )
        self.stdout.write(
            f"  {len(built)} questions, {options.count()} options  "
            + ", ".join(f"{k} {v}" for k, v in sorted(by_subject.items()))
        )
        self.stdout.write(
            "  answer key spread  "
            + " ".join(f"{label}:{keys.get(label, 0)}" for label in "ABCD")
        )
        return built

    def _answers(self, institute, paper, questions, rng) -> None:
        """Generate answers where the signature misconception actually shows."""
        students = list(
            Student.objects.filter(institute=institute, exited_at__isnull=True)
        )
        taken_at = timezone.make_aware(datetime.combine(HELD_ON, time(10, 0)))

        # Pre-load options and the counter-evidence marking, so this is not
        # N queries per student across a 45-question paper.
        opts_by_q = {
            q.id: list(q.options.select_related("misconception").all())
            for q in questions
        }
        counter_by_q = {
            q.id: set(spec.get("counter_to", ()))
            for q, spec in zip(questions, QUESTIONS)
        }

        bait_by_q = {
            q.id: {
                o.misconception.code
                for o in opts_by_q[q.id] if o.misconception_id
            }
            for q in questions
        }

        rows = []
        for student in students:
            signature = SIGNATURES.get(student.name)
            baseline = rng.uniform(
                *(HERO_BASELINE if signature else COHORT_BASELINE)
            )

            # Decide up front which of this hero's baited questions the belief
            # fires on, so the signature's strength is a property of the
            # design rather than of how the dice fell this run.
            #
            # The miss is drawn from the *easiest* baited questions, not
            # uniformly. A student who gets the hard one right and the easy
            # ones wrong invites the obvious objection — he clearly does know
            # the rule — whereas recalling the stock answer on a familiar easy
            # item while the belief still fires everywhere else is what the
            # error actually looks like.
            fires_on: set[int] = set()
            if signature:
                baited = [q for q in questions if signature in bait_by_q[q.id]]
                rank = {"easy": 0, "medium": 1, "hard": 2}
                easiest = min(rank.get(q.difficulty, 1) for q in baited)
                pool = [q.id for q in baited if rank.get(q.difficulty, 1) == easiest]
                misses = rng.sample(pool, min(SIGNATURE_MISSES, len(baited) - 1,
                                              len(pool)))
                fires_on = {q.id for q in baited} - set(misses)

            for q in questions:
                opts = opts_by_q[q.id]
                correct = next(o for o in opts if o.is_correct)
                bait = [
                    o for o in opts
                    if o.misconception_id and o.misconception.code == signature
                ] if signature else []

                if signature and signature in counter_by_q[q.id]:
                    # The trigger is absent. He knows this chapter; the belief
                    # has nothing to act on. This answer is the evidence that
                    # separates "specific trigger" from "topic gap", so it is
                    # not left to a dice roll.
                    chosen = correct
                elif bait and q.id in fires_on:
                    chosen = rng.choice(bait)          # the signature error
                elif rng.random() < baseline:
                    chosen = correct
                else:
                    wrong = [o for o in opts if not o.is_correct]
                    chosen = rng.choice(wrong) if wrong else correct

                is_right = chosen.is_correct
                rows.append(Attempt(
                    institute=institute, student=student, topic=q.topic,
                    test_paper=paper, question_id=q.question_id,
                    status=Attempt.CORRECT if is_right else Attempt.WRONG,
                    chosen_option=chosen.label,
                    time_spent=max(20, int(rng.gauss(110, 35))),
                    marks=4.0 if is_right else -1.0,
                    source=Attempt.MOCK, ts=taken_at,
                ))

        Attempt.objects.bulk_create(rows, batch_size=2000)
        self.stdout.write(f"  {len(rows)} answers across {len(students)} students")

    def _report(self, institute, paper) -> None:
        """Hand off to the verifier, so 'seeded' and 'provable' are one step.

        Anything that only prints at seed time gets believed without being
        checked. verify_signatures reads the rows back out with SQL and
        fails loudly if a signature is no stronger than chance.
        """
        from apps.ingestion.management.commands import verify_signatures as v

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS(f"{paper.name} seeded"))

        data = v.analyse(institute, paper, SIGNATURES)
        if not v.render(self, data, SIGNATURES, paper):
            raise CommandError(
                "Seeded data does not contain a detectable signature. "
                "Refusing to leave it in place — fix the bank or the rates."
            )

        self.stdout.write(
            "  Re-check at any time with: manage.py verify_signatures "
            f"--institute {institute.slug}"
        )
        self.stdout.write("")
