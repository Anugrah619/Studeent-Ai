"""Seed a full demo institute with realistic, internally-consistent data.

    python manage.py seed_demo --flush

Creates two institutes so tenant isolation can be tested, then simulates
a term of mock tests, study logs, confidence ratings and revisions for
the larger one — and computes the derived state from those events.

The hero students follow the scripted stories in TECHNICAL_DOC.md §12.5,
so the numbers here match the demo dataset exactly. Aarav Mehta's seven
mocks really do sum to −37 marks, and Chemistry really is 11% of his
study time against 46% of his lost marks.

Everything is generated from a fixed random seed, so repeated runs
produce identical data.
"""

from __future__ import annotations

import random
from datetime import date, datetime, time, timedelta

from django.core.management import call_command
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.derived.models import Flag, Intervention, PlanBlock, StudentState, TopicState
from apps.events.models import (
    Attempt,
    ChapterStatus,
    ConfidenceRating,
    RevisionEvent,
    StudyLog,
)
from apps.ingestion.models import QuestionTopicMap, TestPaper
from apps.syllabus.models import Exam, SyllabusVersion, Topic
from apps.tenancy.models import Batch, Institute, Mentor, Student, User

SEED = 20260920
Q_PER_SUBJECT = 25
SUBJECTS = ["Physics", "Chemistry", "Maths"]
MOCK_NUMBERS = [8, 9, 10, 11, 12, 13, 14]

# --------------------------------------------------------------------------
# Hero students — scripted so the demo narrative holds together.
# scores: {mock_no: (physics, chemistry, maths)} each out of 100
# --------------------------------------------------------------------------

AARAV_SCORES = {
    8: (62, 41, 68),
    9: (58, 38, 64),
    10: (65, 34, 66),
    11: (61, 31, 60),
    12: (57, 28, 63),
    13: (54, 26, 58),
    14: (52, 24, 58),
}

HEROES = {
    "Aarav Mehta": {
        "batch": "Alpha",
        "roll": "A-1041",
        "target": "AIR < 5000",
        "scores": AARAV_SCORES,
        "time_share": {"Physics": 0.52, "Chemistry": 0.11, "Maths": 0.37},
        "weak_units": ["Organic Chemistry"],
        "attempt_rate": {"Physics": 0.76, "Chemistry": 0.44, "Maths": 0.70},
        "story": "chemistry_neglect",
    },
    "Ishita Rao": {
        "batch": "Dropper",
        "roll": "D-2018",
        "target": "AIR < 2000",
        "scores": {
            8: (68, 62, 58), 9: (66, 60, 57), 10: (64, 57, 54),
            11: (60, 54, 52), 12: (57, 50, 49), 13: (54, 47, 46), 14: (51, 44, 44),
        },
        "time_share": {"Physics": 0.34, "Chemistry": 0.33, "Maths": 0.33},
        "weak_units": [],
        "attempt_rate": {"Physics": 0.84, "Chemistry": 0.84, "Maths": 0.84},
        "story": "overload",
    },
    "Md. Faizan Ali": {
        "batch": "Beta",
        "roll": "B-3077",
        "target": "AIR < 15000",
        "scores": {
            8: (48, 44, 41), 9: (50, 46, 43), 10: (47, 43, 40),
            11: (49, 45, 42), 12: (46, 42, 39), 13: (45, 41, 38), 14: (44, 40, 37),
        },
        "time_share": {"Physics": 0.40, "Chemistry": 0.30, "Maths": 0.30},
        "weak_units": [],
        "attempt_rate": {"Physics": 0.72, "Chemistry": 0.70, "Maths": 0.68},
        "story": "disengagement",
    },
    "Kunal Deshpande": {
        "batch": "Alpha",
        "roll": "A-1083",
        "target": "AIR < 8000",
        "scores": {
            8: (58, 55, 60), 9: (56, 57, 62), 10: (57, 54, 59),
            11: (55, 56, 61), 12: (56, 55, 60), 13: (54, 53, 58), 14: (55, 54, 59),
        },
        "time_share": {"Physics": 0.38, "Chemistry": 0.30, "Maths": 0.32},
        "weak_units": ["Mechanics"],
        "attempt_rate": {"Physics": 0.80, "Chemistry": 0.78, "Maths": 0.80},
        "story": "confidence_mismatch",
    },
    "Tanvi Shah": {
        "batch": "Dropper",
        "roll": "D-2044",
        "target": "AIR < 10000",
        "scores": {
            8: (52, 48, 50), 9: (50, 46, 48), 10: (49, 47, 47),
            11: (48, 45, 46), 12: (47, 44, 45), 13: (46, 44, 44), 14: (45, 43, 44),
        },
        "time_share": {"Physics": 0.35, "Chemistry": 0.33, "Maths": 0.32},
        "weak_units": [],
        "attempt_rate": {"Physics": 0.96, "Chemistry": 0.96, "Maths": 0.94},
        "story": "over_attempting",
    },
    "Priya Nair": {
        "batch": "Beta",
        "roll": "B-3012",
        "target": "AIR < 12000",
        "scores": {
            8: (54, 50, 38), 9: (53, 51, 40), 10: (55, 52, 44),
            11: (56, 53, 50), 12: (57, 54, 56), 13: (58, 56, 60), 14: (60, 57, 64),
        },
        "time_share": {"Physics": 0.30, "Chemistry": 0.30, "Maths": 0.40},
        "weak_units": [],
        "attempt_rate": {"Physics": 0.80, "Chemistry": 0.78, "Maths": 0.76},
        "story": "improving",
    },
}

FILLER_NAMES = [
    "Ananya Sharma", "Rohit Kulkarni", "Karthik Reddy", "Divya Chaudhary",
    "Siddharth Jain", "Meera Pillai", "Arjun Nambiar", "Sana Qureshi",
    "Vikram Choudhary", "Nisha Agarwal", "Rahul Bhatt", "Pooja Verma",
    "Aditya Rane", "Shreya Ghosh", "Harsh Vardhan", "Neha Saxena",
    "Imran Shaikh", "Lakshmi Iyer", "Yash Thakur", "Ritika Mishra",
    "Manav Gupta", "Trisha Sen", "Devansh Patel", "Anjali Rawat",
    "Sameer Khanna", "Kavya Menon", "Nikhil Joshi", "Isha Bansal",
    "Rohan Dube", "Aisha Siddiqui", "Varun Malhotra", "Sneha Deshmukh",
    "Abhinav Rao", "Tanya Kapoor", "Kabir Anand", "Preeti Yadav",
    "Gaurav Sinha", "Riya Chopra", "Aryan Bose", "Simran Kaur",
]

MENTORS = [
    ("Dr. S. Bhatia", "Alpha"),
    ("Prof. R. Nagarajan", "Beta"),
    ("Dr. M. Kulkarni", "Dropper"),
    ("Ms. A. Fernandes", "Foundation"),
]

BATCHES = [
    ("Alpha", 2027, "JEE Advanced track"),
    ("Beta", 2027, "JEE Main track"),
    ("Dropper", 2027, "Repeat year"),
    ("Foundation", 2028, "Class 11"),
]


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------


def split_score(target: int, attempt_rate: float, n: int = Q_PER_SUBJECT) -> tuple[int, int, int]:
    """Find (correct, wrong, unattempted) that yields exactly `target` marks.

    Scoring is +4 / −1, so target = 4c − w. Many (c, w) pairs satisfy that;
    we pick the one whose attempt rate is closest to the student's actual
    behaviour, which is what makes a Chemistry-avoider look like one.
    """
    best = None
    for w in range(0, n + 1):
        numerator = target + w
        if numerator % 4:
            continue
        c = numerator // 4
        if c < 0 or c + w > n:
            continue
        gap = abs((c + w) / n - attempt_rate)
        if best is None or gap < best[0]:
            best = (gap, c, w)
    if best is None:  # unreachable target — clamp
        return 0, 0, n
    _, c, w = best
    return c, w, n - c - w


def subject_of(topic: Topic, cache: dict[int, str]) -> str:
    if topic.pk in cache:
        return cache[topic.pk]
    node = topic
    while node.parent_id is not None:
        node = node.parent
    cache[topic.pk] = node.name
    return node.name


def aware(d: date, hour: int = 10, minute: int = 0) -> datetime:
    return timezone.make_aware(datetime.combine(d, time(hour, minute)))


# --------------------------------------------------------------------------


class Command(BaseCommand):
    help = "Seed two institutes with a full term of realistic demo data."

    def add_arguments(self, parser):
        parser.add_argument("--flush", action="store_true", help="Delete existing data first")
        parser.add_argument("--students", type=int, default=46, help="Students in the main institute")

    @transaction.atomic
    def handle(self, *args, **opts):
        self.rng = random.Random(SEED)

        if opts["flush"]:
            self._flush()

        main = self._institute("Aarambh Classes", "Kota", "aarambh")
        other = self._institute("Pinnacle Academy", "Jaipur", "pinnacle")

        call_command("seed_syllabus", institute="aarambh", activate=True, verbosity=0)
        call_command("seed_syllabus", institute="pinnacle", activate=True, verbosity=0)

        syllabus = SyllabusVersion.objects.get(institute=main, is_active=True)
        chapters = list(
            Topic.objects.filter(syllabus=syllabus, kind=Topic.CHAPTER).select_related("parent__parent")
        )
        subj_cache: dict[int, str] = {}
        by_subject: dict[str, list[Topic]] = {s: [] for s in SUBJECTS}
        for t in chapters:
            by_subject[subject_of(t, subj_cache)].append(t)

        exam = Exam.objects.get(code="JEE_MAIN")
        mentors, batches = self._people(main, exam, syllabus)
        students = self._students(main, batches, mentors, opts["students"])
        papers = self._papers(main, exam, by_subject)

        self._chapter_status(main, batches, chapters)
        abilities = self._abilities(students, by_subject)
        self._attempts(main, students, papers, by_subject, abilities)
        self._study_logs(main, students, by_subject, abilities)
        self._confidence(main, students, by_subject, abilities)
        self._revisions(main, students, by_subject)
        self._topic_state(main, students)
        self._student_state(main, students, subj_cache)
        self._flags(main, students, mentors, by_subject)
        self._plans(main, students, by_subject)

        # A second institute with a different tree, for isolation testing.
        self._minimal_institute(other, exam)

        self._report()

    # ---------------------------------------------------------------- setup

    def _flush(self):
        for model in (
            Intervention, Flag, PlanBlock, TopicState, StudentState,
            Attempt, StudyLog, ConfidenceRating, RevisionEvent, ChapterStatus,
            QuestionTopicMap, TestPaper, Student, Batch, Mentor,
            Topic, SyllabusVersion, Institute,
        ):
            model.objects.all().delete()
        User.objects.filter(is_superuser=False).delete()
        self.stdout.write("  flushed existing data")

    def _institute(self, name, city, slug) -> Institute:
        inst, _ = Institute.objects.get_or_create(
            slug=slug, defaults={"name": name, "city": city}
        )
        return inst

    def _people(self, inst, exam, syllabus):
        mentors = {}
        for name, batch_name in MENTORS:
            user = User.objects.create_user(
                username=f"{inst.slug}.{name.split()[-1].lower()}",
                password="demo12345",
                first_name=name,
            )
            mentors[batch_name] = Mentor.objects.create(
                institute=inst, user=user, name=name,
                email=f"{name.split()[-1].lower()}@{inst.slug}.example",
            )

        exam_day = date(2027, 4, 6)
        batches = {}
        for name, year, _note in BATCHES:
            batches[name] = Batch.objects.create(
                institute=inst, name=name, exam=exam, year=year,
                syllabus=syllabus, exam_date=exam_day,
            )
        return mentors, batches

    def _students(self, inst, batches, mentors, n_filler):
        students = []
        joined = date(2026, 4, 1)

        for name, spec in HEROES.items():
            batch = batches[spec["batch"]]
            s = Student.objects.create(
                institute=inst, batch=batch, roll_no=spec["roll"], name=name,
                mentor=mentors[spec["batch"]], target=spec["target"], joined_at=joined,
            )
            s._spec = spec
            students.append(s)

        batch_cycle = ["Alpha", "Beta", "Dropper", "Foundation"]
        for i, name in enumerate(FILLER_NAMES[:n_filler]):
            bname = batch_cycle[i % len(batch_cycle)]
            batch = batches[bname]
            base = self.rng.randint(38, 72)
            s = Student.objects.create(
                institute=inst, batch=batch,
                roll_no=f"{bname[0]}-{4000 + i}", name=name,
                mentor=mentors[bname],
                target=self.rng.choice(["AIR < 5000", "AIR < 15000", "AIR < 30000", ""]),
                joined_at=joined,
                # A couple of dropouts — these are the risk model's labels.
                exited_at=date(2026, 8, 20) if i in (7, 23) else None,
            )
            drift = self.rng.uniform(-1.4, 1.4)
            s._spec = {
                "scores": {
                    m: tuple(
                        max(8, min(96, int(base + drift * (m - 8) + self.rng.randint(-5, 5))))
                        for _ in SUBJECTS
                    )
                    for m in MOCK_NUMBERS
                },
                "time_share": {"Physics": 0.34, "Chemistry": 0.33, "Maths": 0.33},
                "weak_units": [],
                "attempt_rate": {s2: self.rng.uniform(0.66, 0.9) for s2 in SUBJECTS},
                "story": "filler",
            }
            students.append(s)
        return students

    def _papers(self, inst, exam, by_subject):
        """Create mock papers and their question→topic map (already confirmed)."""
        papers = {}
        base_day = date(2026, 6, 7)
        now = timezone.now()
        qmaps = []

        for idx, mock_no in enumerate(MOCK_NUMBERS):
            paper = TestPaper.objects.create(
                institute=inst, name=f"Mock {mock_no}", exam=exam,
                held_on=base_day + timedelta(days=14 * idx),
                total_questions=Q_PER_SUBJECT * 3, max_marks=300,
                marks_correct=4, marks_wrong=-1, duration_min=180,
            )
            layout = {}
            qno = 1
            for subject in SUBJECTS:
                pool = by_subject[subject]
                weights = [t.weight for t in pool]
                picked = self.rng.choices(pool, weights=weights, k=Q_PER_SUBJECT)
                layout[subject] = []
                for topic in picked:
                    qid = f"Q{qno}"
                    layout[subject].append((qid, topic))
                    qmaps.append(
                        QuestionTopicMap(
                            institute=inst, test_paper=paper, question_id=qid,
                            topic=topic, proposed_by=QuestionTopicMap.BLUEPRINT,
                            confirmed_at=now,
                        )
                    )
                    qno += 1
            papers[mock_no] = (paper, layout)

        QuestionTopicMap.objects.bulk_create(qmaps, batch_size=2000)
        return papers

    def _chapter_status(self, inst, batches, chapters):
        """Roughly 70% of the syllabus taught so far."""
        rows = []
        start = date(2026, 4, 10)
        for batch in batches.values():
            for i, topic in enumerate(chapters):
                if i / len(chapters) > 0.72:
                    continue
                taught = start + timedelta(days=int(i * 2.4))
                rows.append(
                    ChapterStatus(
                        institute=inst, batch=batch, topic=topic,
                        taught_at=taught, completed_at=taught + timedelta(days=3),
                    )
                )
        ChapterStatus.objects.bulk_create(rows, batch_size=2000)

    def _abilities(self, students, by_subject):
        """Latent per-chapter skill, 0–1. Drives which questions go wrong.

        Sorting a paper's questions by ability and marking the top `c`
        correct means weak chapters reliably produce the wrong answers —
        which is what makes weak-topic detection findable in the data.
        """
        abilities = {}
        for s in students:
            spec = s._spec
            per_topic = {}
            for subject, topics in by_subject.items():
                base = self.rng.uniform(0.35, 0.75)
                for t in topics:
                    unit = t.parent.name if t.parent else ""
                    penalty = 0.42 if unit in spec["weak_units"] else 0.0
                    per_topic[t.pk] = max(
                        0.02, min(0.98, base - penalty + self.rng.uniform(-0.16, 0.16))
                    )
            abilities[s.pk] = per_topic
        return abilities

    # ------------------------------------------------------------- events

    def _attempts(self, inst, students, papers, by_subject, abilities):
        rows = []
        for mock_no in MOCK_NUMBERS:
            paper, layout = papers[mock_no]
            taken_at = aware(paper.held_on, 9, 0)
            for s in students:
                if s.exited_at and paper.held_on > s.exited_at:
                    continue
                spec = s._spec
                targets = spec["scores"][mock_no]
                for subject, target in zip(SUBJECTS, targets):
                    rate = spec["attempt_rate"][subject]
                    c, w, un = split_score(int(target), rate)

                    qs = layout[subject]
                    ranked = sorted(qs, key=lambda qt: abilities[s.pk][qt[1].pk], reverse=True)

                    # Strongest → correct, next → wrong, weakest → unattempted.
                    for i, (qid, topic) in enumerate(ranked):
                        if i < c:
                            status, marks = Attempt.CORRECT, 4.0
                            secs = int(self.rng.gauss(95, 30))
                        elif i < c + w:
                            status, marks = Attempt.WRONG, -1.0
                            secs = int(self.rng.gauss(165, 55))
                        else:
                            # Deliberate skips come from avoidance; the tail of
                            # the paper is where the clock runs out.
                            if self.rng.random() < 0.58:
                                status, marks, secs = Attempt.BLANK, 0.0, 0
                            else:
                                status, marks, secs = Attempt.NOT_REACHED, 0.0, 0
                        rows.append(
                            Attempt(
                                institute=inst, student=s, topic=topic, test_paper=paper,
                                question_id=qid, status=status,
                                time_spent=max(8, secs) if secs else None,
                                marks=marks, source=Attempt.MOCK, ts=taken_at,
                            )
                        )
        Attempt.objects.bulk_create(rows, batch_size=5000)
        self.attempt_count = len(rows)

    def _study_logs(self, inst, students, by_subject, abilities):
        rows = []
        today = timezone.localdate()
        for s in students:
            spec = s._spec
            share = spec["time_share"]
            for day_back in range(70, 0, -1):
                d = today - timedelta(days=day_back)
                if s.exited_at and d > s.exited_at:
                    continue
                # Faizan goes quiet in the last nine days — the disengagement signal.
                if spec["story"] == "disengagement" and day_back <= 9:
                    continue
                if self.rng.random() < 0.12:       # a genuine rest day
                    continue

                total = self.rng.randint(180, 420)
                if spec["story"] == "overload":    # hours climbing week on week
                    total = int(total * (1 + (70 - day_back) / 140))

                for subject, frac in share.items():
                    minutes = int(total * frac)
                    if minutes < 20:
                        continue
                    pool = by_subject[subject]
                    topic = self.rng.choice(pool)
                    rows.append(
                        StudyLog(
                            institute=inst, student=s, topic=topic, minutes=minutes,
                            mode=self.rng.choices(
                                [StudyLog.LEARN, StudyLog.PRACTICE, StudyLog.REVISE],
                                weights=[3, 4, 3],
                            )[0],
                            ts=aware(d, self.rng.randint(7, 21)),
                        )
                    )
        StudyLog.objects.bulk_create(rows, batch_size=5000)
        self.log_count = len(rows)

    def _confidence(self, inst, students, by_subject, abilities):
        rows = []
        when = aware(timezone.localdate() - timedelta(days=12), 20)
        for s in students:
            spec = s._spec
            for subject, topics in by_subject.items():
                for t in self.rng.sample(topics, k=min(9, len(topics))):
                    ability = abilities[s.pk][t.pk]
                    rating = max(1, min(5, round(ability * 4 + 1 + self.rng.uniform(-0.6, 0.6))))
                    # Kunal rates Mechanics highly and scores badly on it.
                    if spec["story"] == "confidence_mismatch" and t.parent and t.parent.name == "Mechanics":
                        rating = 5
                    rows.append(
                        ConfidenceRating(
                            institute=inst, student=s, topic=t,
                            self_rating=rating, ts=when,
                        )
                    )
        ConfidenceRating.objects.bulk_create(rows, batch_size=5000)

    def _revisions(self, inst, students, by_subject):
        rows = []
        today = timezone.localdate()
        for s in students:
            for subject, topics in by_subject.items():
                for t in self.rng.sample(topics, k=min(7, len(topics))):
                    for cycle, offset in ((1, 40), (2, 16), (3, -5)):
                        sched = today - timedelta(days=offset)
                        done = None
                        if offset > 0 and self.rng.random() < 0.7:
                            done = aware(sched + timedelta(days=self.rng.randint(0, 3)), 19)
                        rows.append(
                            RevisionEvent(
                                institute=inst, student=s, topic=t, cycle=cycle,
                                scheduled_for=sched, done_at=done,
                            )
                        )
        RevisionEvent.objects.bulk_create(rows, batch_size=5000)

    # ------------------------------------------------------------ derived

    def _topic_state(self, inst, students):
        """Rung-0 mastery: plain accuracy over attempted questions.

        Null below the evidence floor — we report nothing rather than a
        confident number derived from three attempts.
        """
        from django.db.models import Avg, Count, Max, Q, Sum

        agg = (
            Attempt.objects.filter(institute=inst)
            .values("student_id", "topic_id")
            .annotate(
                n=Count("id", filter=Q(status__in=[Attempt.CORRECT, Attempt.WRONG])),
                correct=Count("id", filter=Q(status=Attempt.CORRECT)),
                last=Max("ts"),
                avg_time=Avg("time_spent"),
            )
        )
        exposure = {
            (r["student_id"], r["topic_id"]): r["mins"]
            for r in StudyLog.objects.filter(institute=inst)
            .values("student_id", "topic_id")
            .annotate(mins=Sum("minutes"))
        }
        ratings = {
            (r["student_id"], r["topic_id"]): r["latest"]
            for r in ConfidenceRating.objects.filter(institute=inst)
            .values("student_id", "topic_id")
            .annotate(latest=Max("self_rating"))
        }
        revised = {
            (r["student_id"], r["topic_id"]): r["last"]
            for r in RevisionEvent.objects.filter(institute=inst, done_at__isnull=False)
            .values("student_id", "topic_id")
            .annotate(last=Max("done_at"))
        }

        EVIDENCE_FLOOR = 4
        rows = []
        for r in agg:
            key = (r["student_id"], r["topic_id"])
            n = r["n"]
            rows.append(
                TopicState(
                    institute=inst, student_id=r["student_id"], topic_id=r["topic_id"],
                    mastery=(r["correct"] / n) if n >= EVIDENCE_FLOOR else None,
                    attempts_n=n, correct_n=r["correct"],
                    accuracy_30d=(r["correct"] / n) if n else None,
                    exposure_min=exposure.get(key, 0),
                    avg_time_spent=r["avg_time"],
                    self_rating=ratings.get(key),
                    last_seen=r["last"], last_revised=revised.get(key),
                )
            )
        TopicState.objects.bulk_create(rows, batch_size=5000)
        self.topic_state_count = len(rows)

    def _student_state(self, inst, students, subj_cache):
        from django.db.models import Count, Q, Sum

        rows = []
        for s in students:
            marks = {}
            for mock_no in (MOCK_NUMBERS[0], MOCK_NUMBERS[-1]):
                total = (
                    Attempt.objects.filter(student=s, test_paper__name=f"Mock {mock_no}")
                    .aggregate(t=Sum("marks"))["t"]
                )
                marks[mock_no] = total or 0
            trend = marks[MOCK_NUMBERS[-1]] - marks[MOCK_NUMBERS[0]]

            logged_days = (
                StudyLog.objects.filter(student=s).dates("ts", "day").count()
            )
            debt = RevisionEvent.objects.filter(
                student=s, done_at__isnull=True,
                scheduled_for__lt=timezone.localdate(),
            ).count()

            # Time share vs marks-lost share, by subject — the imbalance signal.
            time_by_subject, lost_by_subject = {}, {}
            for row in (
                StudyLog.objects.filter(student=s)
                .values("topic_id").annotate(m=Sum("minutes"))
            ):
                subj = subj_cache.get(row["topic_id"])
                if subj:
                    time_by_subject[subj] = time_by_subject.get(subj, 0) + row["m"]
            for row in (
                Attempt.objects.filter(student=s).exclude(status=Attempt.CORRECT)
                .values("topic_id").annotate(n=Count("id"))
            ):
                subj = subj_cache.get(row["topic_id"])
                if subj:
                    lost_by_subject[subj] = lost_by_subject.get(subj, 0) + row["n"]

            t_tot = sum(time_by_subject.values()) or 1
            l_tot = sum(lost_by_subject.values()) or 1
            imbalance = max(
                abs(lost_by_subject.get(k, 0) / l_tot - time_by_subject.get(k, 0) / t_tot)
                for k in SUBJECTS
            )

            risk = min(1.0, max(0.0, (-trend / 60.0) * 0.6 + imbalance * 0.8 + (debt / 40.0) * 0.3))

            rows.append(
                StudentState(
                    institute=inst, student=s,
                    consistency=round(min(1.0, logged_days / 60.0), 3),
                    load_index=round(self.rng.uniform(0.4, 1.0), 3),
                    balance_index=round(imbalance, 3),
                    revision_debt=debt,
                    risk_score=round(risk, 3),
                    mock_avg=round(sum(marks.values()) / 2, 1),
                    mock_trend=round(trend, 1),
                    syllabus_pct=72.0,
                )
            )
        StudentState.objects.bulk_create(rows, batch_size=1000)

    def _flags(self, inst, students, mentors, by_subject):
        now = timezone.now()
        by_name = {s.name: s for s in students}
        made = []

        def flag(name, ftype, severity, headline, evidence, days_ago=4, **extra):
            s = by_name.get(name)
            if not s:
                return None
            f = Flag.objects.create(
                institute=inst, student=s, type=ftype, severity=severity,
                headline=headline, evidence=evidence,
                raised_at=now - timedelta(days=days_ago), **extra,
            )
            made.append(f)
            return f

        flag("Aarav Mehta", "subject_imbalance", Flag.CRITICAL,
             "Down 37 marks over 7 mocks. Chemistry is 11% of study time but 46% of marks lost.",
             {"marks_trend": -37, "time_share_pct": 11, "marks_lost_share_pct": 46,
              "weakest_unit": "Organic Chemistry"})

        flag("Ishita Rao", "overload", Flag.CRITICAL,
             "Study hours up 31% while accuracy fell 11 points. Classic overload signature.",
             {"hours_change_pct": 31, "accuracy_change_pts": -11})

        flag("Md. Faizan Ali", "disengagement", Flag.HIGH,
             "Attendance normal, but zero practice logged in 9 days.",
             {"days_since_last_log": 9, "prior_weekly_avg_min": 1680})

        flag("Kunal Deshpande", "confidence_mismatch", Flag.HIGH,
             "Rates Mechanics 5/5; scoring 31% on it across 4 mocks.",
             {"self_rating": 5, "measured_mastery_pct": 31, "unit": "Mechanics"})

        flag("Tanvi Shah", "over_attempting", Flag.WATCH,
             "Attempting 96% of questions; negative marking is costing more than the extra attempts gain.",
             {"attempt_rate_pct": 96, "optimal_pct": 78})

        recovered = flag(
            "Priya Nair", "weak_topic", Flag.IMPROVING,
            "Flagged 3 weeks ago for Maths. Accuracy 44% → 67% after mentor contact.",
            {"accuracy_before_pct": 44, "accuracy_after_pct": 67},
            days_ago=21, resolved_at=now - timedelta(days=2), outcome=Flag.RECOVERED,
        )
        if recovered:
            Intervention.objects.create(
                flag=recovered, mentor=mentors["Beta"],
                action="Moved to morning Maths batch; assigned daily 20-question Calculus set.",
                taken_at=now - timedelta(days=18),
            )

        # A spread of routine flags across the rest of the cohort.
        for s in students:
            if s.name in HEROES or s.exited_at:
                continue
            st = StudentState.objects.filter(student=s).first()
            if st and st.risk_score and st.risk_score > 0.55 and self.rng.random() < 0.5:
                weakest = (
                    TopicState.objects.filter(student=s, mastery__isnull=False)
                    .order_by("mastery").first()
                )
                if weakest:
                    Flag.objects.create(
                        institute=inst, student=s, topic=weakest.topic,
                        type="weak_topic",
                        severity=self.rng.choice([Flag.WATCH, Flag.HIGH]),
                        headline=f"{weakest.topic.name}: {weakest.mastery:.0%} accuracy over {weakest.attempts_n} attempts.",
                        evidence={"mastery_pct": round(weakest.mastery * 100),
                                  "attempts": weakest.attempts_n},
                        raised_at=now - timedelta(days=self.rng.randint(1, 12)),
                    )

    def _plans(self, inst, students, by_subject):
        rows = []
        today = timezone.localdate()
        reasons = [
            ("revision_r2", "Revision due — last seen 18 days ago", "revise"),
            ("weak_topic", "Weakest chapter in your last mock", "practice"),
            ("syllabus", "New chapter, on this week's class schedule", "learn"),
        ]
        for s in students:
            if s.exited_at:
                continue
            weak = list(
                TopicState.objects.filter(student=s, mastery__isnull=False)
                .order_by("mastery")[:3]
            )
            for i, (code, text, mode) in enumerate(reasons):
                topic = weak[i].topic if i < len(weak) else self.rng.choice(by_subject["Physics"])
                rows.append(
                    PlanBlock(
                        institute=inst, student=s, topic=topic, date=today,
                        start_time=time(6 + i * 6, 30), minutes=[45, 60, 50][i],
                        mode=mode, reason_code=code, reason_text=text,
                    )
                )
        PlanBlock.objects.bulk_create(rows, batch_size=2000)

    def _minimal_institute(self, inst, exam):
        """A second tenant with its own tree — exists so isolation can be proven."""
        syllabus = SyllabusVersion.objects.get(institute=inst, is_active=True)
        mentor_user = User.objects.create_user(
            username="pinnacle.rao", password="demo12345", first_name="Dr. P. Rao"
        )
        mentor = Mentor.objects.create(institute=inst, user=mentor_user, name="Dr. P. Rao")
        batch = Batch.objects.create(
            institute=inst, name="Crash Course", exam=exam, year=2027,
            syllabus=syllabus, exam_date=date(2027, 4, 6),
        )
        for i, name in enumerate(["Ravi Sethi", "Anita Bose", "Farhan Sheikh"]):
            Student.objects.create(
                institute=inst, batch=batch, roll_no=f"P-{100 + i}",
                name=name, mentor=mentor, joined_at=date(2026, 5, 1),
            )

    def _report(self):
        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS("Demo data seeded"))
        for label, value in [
            ("institutes", Institute.objects.count()),
            ("students", Student.objects.count()),
            ("topics", Topic.objects.count()),
            ("test papers", TestPaper.objects.count()),
            ("question→topic maps", QuestionTopicMap.objects.count()),
            ("attempts", Attempt.objects.count()),
            ("study logs", StudyLog.objects.count()),
            ("confidence ratings", ConfidenceRating.objects.count()),
            ("revision events", RevisionEvent.objects.count()),
            ("topic states", TopicState.objects.count()),
            ("student states", StudentState.objects.count()),
            ("flags", Flag.objects.count()),
            ("plan blocks", PlanBlock.objects.count()),
        ]:
            self.stdout.write(f"  {value:>7,}  {label}")
