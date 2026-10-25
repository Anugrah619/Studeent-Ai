import type {
  ConfidenceRating,
  Finding,
  MarksLost,
  Me,
  MockScore,
  MyAttempt,
  MyProfile,
  MyQuestion,
  MyRevision,
  MyTopic,
  NextAction,
  Onboarding,
  PlanBlock,
  PlanExplain,
  StudyLogCreate,
  SubjectBreakdown,
  TopicState,
} from "@/api/types";
import { clamp, hashSeed, mulberry32, round, splitInteger } from "../rng";
import { AARAV, INSTITUTE, PERSONAS, personaForRoll, type Persona } from "./personas";
import { questionByPk } from "./questions";
import type { ChapterSeed } from "./syllabi";

/**
 * One student's state in the mock server, built from a persona and then
 * changed by what the student does — ticking a block, logging study, marking a
 * revision done — exactly as the live routes change it, so a demo can walk the
 * whole loop without a backend.
 *
 * Every rule here (what goes in a plan, which next actions appear, how an
 * overdue revision is worded) is a transcription of the backend's own:
 * `derived/services/planner.py`, `reasoning/services/guidance.py`,
 * `api/my_views.py`. Where the backend writes a sentence for the student, the
 * sentence is copied, not paraphrased — the mock must not be kinder or harsher
 * than the server.
 */

/* ------------------------------------------------------------------ *
 * Dates — local calendar days, as the student's phone counts them
 * ------------------------------------------------------------------ */

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** `YYYY-MM-DD` for today plus `offset` days, in local time. */
export function localDay(offset = 0, now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** An instant `daysAgo` local days back, at `hour`:10. */
function localInstant(daysAgo: number, hour: number): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, hour, 10);
  return d.toISOString();
}

function daysBetween(fromDay: string, toDay: string): number {
  const [ay, am, ad] = fromDay.split("-").map(Number);
  const [by, bm, bd] = toDay.split("-").map(Number);
  return Math.round(
    (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000,
  );
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** `guidance._ago`. */
function ago(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/* ------------------------------------------------------------------ *
 * The world
 * ------------------------------------------------------------------ */

export interface World {
  persona: Persona;
  studentId: number;
  name: string;
  rollNo: string;
  onboarding: {
    dailyMinutes: number | null;
    targetRank: number | null;
    onboardedAt: string | null;
  };
  topics: MyTopic[];
  states: TopicState[];
  revisions: MyRevision[];
  logs: StudyLogCreate[];
  ratings: ConfidenceRating[];
  /** Today's plan. Empty until the student makes one. */
  plan: PlanBlock[];
  planNote: string | null;
  /** Calls each throttle scope has seen, so the mock can answer 429 too. */
  counters: { generate: number; ask: number; onboarding: number; explain: number };
  /** Normalised questions already answered — a repeat is `from_cache`. */
  asked: Set<string>;
  explained: Set<string>;
  nextId: number;
}

const worlds = new Map<number, World>();
const signedInBefore = new Set<string>();

/** Forget every student's changes. Tests call it between cases. */
export function resetStudentWorlds() {
  worlds.clear();
  signedInBefore.clear();
}

function topicOf(chapter: ChapterSeed) {
  return {
    id: chapter.id,
    name: chapter.name,
    kind: "chapter" as const,
    weight: chapter.weight,
    subject: chapter.subject,
  };
}

function buildStates(persona: Persona, studentId: number): TopicState[] {
  const rand = mulberry32(hashSeed("student-world", persona.key, studentId));
  const latestRating = new Map<string, number>();
  for (const r of [...persona.ratings].sort((a, b) => b.daysAgo - a.daysAgo)) {
    latestRating.set(r.topic, r.rating);
  }

  return persona.chapters.map((chapter, i) => {
    const pin = persona.pins[chapter.name] ?? {};
    const unseen = persona.unseen.includes(chapter.name);
    const [lo, hi] = persona.bands[chapter.subject] ?? [0.4, 0.7];

    const attempts = unseen ? 0 : (pin.attempts ?? Math.round(8 + rand() * 46));
    const mastery =
      unseen || attempts < 4
        ? null
        : pin.mastery !== undefined
          ? pin.mastery
          : round(lo + rand() * (hi - lo), 2);
    const lastSeen = unseen ? null : (pin.lastSeenDays ?? Math.round(2 + rand() * 22));
    const cycles = unseen ? 0 : (pin.cycles ?? Math.floor(rand() * 3));
    const lastRevised =
      cycles > 0 && lastSeen !== null ? lastSeen + Math.round(rand() * 5) : null;

    // `TopicState.retention`: exp(-t / S), S = 10 × 2.5^cycles × (0.5 + mastery),
    // a null mastery counted as 0.5; null when the chapter was never seen.
    const touched = lastSeen === null ? null : Math.min(lastSeen, lastRevised ?? lastSeen);
    const stability = 10 * 2.5 ** Math.min(cycles, 3) * (0.5 + (mastery ?? 0.5));
    const retention =
      touched === null ? null : round(clamp(Math.exp(-touched / stability), 0.02, 0.99), 2);

    const selfRating = latestRating.get(chapter.name) ?? pin.selfRating ?? null;
    return {
      id: studentId * 10_000 + i,
      topic: topicOf(chapter),
      mastery,
      retention,
      attempts_n: attempts,
      correct_n: Math.round(attempts * (mastery ?? 0.5)),
      exposure_min: unseen ? 0 : Math.round(30 + rand() * 400),
      avg_time_spent: unseen ? null : round(70 + rand() * 120, 1),
      self_rating: selfRating,
      confidence_gap:
        selfRating !== null && mastery !== null ? round(selfRating / 5 - mastery, 2) : null,
      last_seen: lastSeen === null ? null : localInstant(lastSeen, 18),
      last_revised: lastRevised === null ? null : localInstant(lastRevised, 20),
    } satisfies TopicState;
  });
}

function build(persona: Persona, me: Me): World {
  const known = PERSONAS.some((p) => p.studentId === me.student_id);
  const studentId = me.student_id ?? persona.studentId;
  const chapterByName = new Map(persona.chapters.map((c) => [c.name, c]));
  let nextId = studentId * 1000 + 1;

  const revisions: MyRevision[] = persona.revisions.flatMap((seed) => {
    const chapter = chapterByName.get(seed.topic);
    if (!chapter) return [];
    return [
      {
        id: nextId++,
        topic: topicOf(chapter),
        cycle: seed.cycle,
        scheduled_for: localDay(seed.inDays),
        done_at: seed.doneInDays === undefined ? null : localInstant(-seed.doneInDays, 19),
        is_overdue: false,
      },
    ];
  });

  const logs: StudyLogCreate[] = persona.logs
    .flatMap((seed) => {
      const chapter = chapterByName.get(seed.topic);
      if (!chapter) return [];
      return [
        {
          id: nextId++,
          topic: chapter.id,
          topic_name: chapter.name,
          minutes: seed.minutes,
          mode: seed.mode,
          ts: localInstant(seed.daysAgo, seed.hour),
        },
      ];
    })
    .sort((a, b) => b.ts.localeCompare(a.ts));

  const ratings: ConfidenceRating[] = persona.ratings
    .flatMap((seed) => {
      const chapter = chapterByName.get(seed.topic);
      if (!chapter) return [];
      return [
        {
          id: nextId++,
          topic: chapter.id,
          topic_name: chapter.name,
          self_rating: seed.rating,
          ts: localInstant(seed.daysAgo, 21),
        },
      ];
    })
    .sort((a, b) => b.ts.localeCompare(a.ts));

  return {
    persona,
    studentId,
    // A student outside the personas (a test's own `Me`) borrows Aarav's
    // world under their own name and roll number.
    name: known ? persona.name : me.name || persona.name,
    rollNo: known ? persona.rollNo : me.username || persona.rollNo,
    onboarding: { dailyMinutes: null, targetRank: null, onboardedAt: null },
    topics: persona.chapters.map((c) => ({
      id: c.id,
      name: c.name,
      kind: "chapter",
      weight: c.weight,
      subject: c.subject,
      unit: c.unit,
      ncert_ref: c.ncert_ref,
    })),
    states: buildStates(persona, studentId),
    revisions,
    logs,
    ratings,
    plan: [],
    planNote: null,
    counters: { generate: 0, ask: 0, onboarding: 0, explain: 0 },
    asked: new Set(),
    explained: new Set(),
    nextId,
  };
}

/** The world of whoever `me` is — created on first use, then kept. */
export function worldFor(me: Me): World {
  const studentId = me.student_id ?? 0;
  const existing = worlds.get(studentId);
  if (existing) return existing;
  const persona = PERSONAS.find((p) => p.studentId === studentId) ?? AARAV;
  const world = build(persona, me);
  worlds.set(studentId, world);
  return world;
}

/**
 * The identity a roll-number sign-in gets, or null for a roll the fixtures do
 * not hold. A student's first sign-in is on the temporary password the
 * institute handed out, so the first one in a session goes through the
 * password gate, exactly as on the live server; later ones in the same session
 * do not.
 */
export function studentLogin(username: string): Me | null {
  const persona = personaForRoll(username);
  if (!persona) return null;
  const first = !signedInBefore.has(persona.rollNo);
  signedInBefore.add(persona.rollNo);
  return {
    id: persona.userId,
    username: persona.rollNo,
    name: persona.name,
    email: "",
    role: "student",
    institute: { ...INSTITUTE },
    mentor_id: null,
    student_id: persona.studentId,
    is_staff: false,
    is_superuser: false,
    must_change_password: first,
  };
}

/* ------------------------------------------------------------------ *
 * Read models
 * ------------------------------------------------------------------ */

function papersOf(world: World) {
  return [...world.persona.papers].sort((a, b) => b.daysAgo - a.daysAgo);
}

function pendingRevisions(world: World): MyRevision[] {
  return world.revisions.filter((r) => !r.done_at);
}

function withOverdue(rows: MyRevision[]): MyRevision[] {
  const today = localDay();
  return rows.map((r) => ({ ...r, is_overdue: !r.done_at && r.scheduled_for < today }));
}

export function revisionsOf(world: World, pendingOnly: boolean): MyRevision[] {
  const rows = pendingOnly ? pendingRevisions(world) : world.revisions;
  // Soonest first, so overdue ones lead.
  return withOverdue(rows).sort(
    (a, b) => a.scheduled_for.localeCompare(b.scheduled_for) || a.id - b.id,
  );
}

export function mockScoresOf(world: World): MockScore[] {
  const subjects = world.persona.subjects;
  return papersOf(world).map((paper) => {
    const bySubject = (name: string) => {
      const i = subjects.findIndex((s) => s.toLowerCase().startsWith(name));
      return i === -1 ? 0 : paper.marks[i];
    };
    return {
      paper_id: paper.id,
      paper_name: paper.name,
      held_on: localDay(-paper.daysAgo),
      physics: bySubject("physics"),
      chemistry: bySubject("chemistry"),
      maths: bySubject("math"),
      total: paper.marks.reduce((a, b) => a + b, 0),
      subjects: subjects.map((subject, i) => ({ subject, marks: paper.marks[i] })),
    };
  });
}

export function profileOf(world: World): MyProfile {
  const scores = mockScoresOf(world);
  const totals = scores.map((s) => s.total);
  const today = localDay();
  return {
    id: world.studentId,
    name: world.name,
    roll_no: world.rollNo,
    target: world.persona.target,
    joined_at: world.persona.joinedAt,
    batch: world.persona.batch,
    mentor_name: world.persona.mentorName,
    progress: {
      consistency: world.persona.consistency,
      revision_debt: pendingRevisions(world).filter((r) => r.scheduled_for < today).length,
      mock_avg: totals.length ? round(totals.reduce((a, b) => a + b, 0) / totals.length, 1) : null,
      mock_trend: totals.length > 1 ? round(totals[totals.length - 1] - totals[0], 1) : null,
      syllabus_pct: world.persona.syllabusPct,
      computed_at: localInstant(0, 5),
    },
    needs_onboarding: world.onboarding.onboardedAt === null,
  };
}

export function onboardingOf(world: World): Onboarding {
  return {
    exam_code: world.persona.batch.exam_code,
    exam_name: world.persona.examName,
    exam_date: world.persona.batch.exam_date ?? null,
    batch_name: world.persona.batch.name,
    target: world.persona.target,
    target_rank: world.onboarding.targetRank,
    daily_minutes: world.onboarding.dailyMinutes,
    onboarded_at: world.onboarding.onboardedAt,
    needs_onboarding: world.onboarding.onboardedAt === null,
  };
}

export function subjectBreakdownOf(world: World): SubjectBreakdown[] {
  const p = world.persona;
  return p.subjects.map((subject, i) => ({
    subject,
    time_share_pct: p.timeSharePct[i],
    marks_lost_share_pct: p.marksLostSharePct[i],
    accuracy_pct: p.accuracyPct[i],
  }));
}

/** Weakest measured first; chapters below the evidence floor last. */
export function topicStatesOf(
  world: World,
  { weak, forgetting }: { weak: boolean; forgetting: boolean },
): TopicState[] {
  let rows = [...world.states];
  if (weak) rows = rows.filter((s) => s.mastery !== null && s.mastery < 0.5);
  if (forgetting) {
    return rows
      .filter((s) => s.retention !== null && s.retention < 0.5)
      .sort((a, b) => (a.retention ?? 0) - (b.retention ?? 0));
  }
  return rows.sort((a, b) => (a.mastery ?? 2) - (b.mastery ?? 2));
}

/** `marks-lost/?paper=` for a paper this student sat, or undefined. */
export function marksLostOf(world: World, paperId: number): MarksLost | undefined {
  const paper = world.persona.papers.find((p) => p.id === paperId);
  if (!paper) return undefined;
  const score = paper.marks.reduce((a, b) => a + b, 0);
  const lost = paper.maxMarks - score;
  const rand = mulberry32(hashSeed("lost", world.persona.key, paperId));
  const [conceptual, execution, time, skip, insufficient] =
    world.persona.marksLostPins[paperId] ??
    splitInteger(lost, [
      0.2 + (rand() - 0.5) * 0.06,
      0.16 + (rand() - 0.5) * 0.06,
      0.12 + (rand() - 0.5) * 0.04,
      0.09 + (rand() - 0.5) * 0.04,
      0.43 + (rand() - 0.5) * 0.08,
    ]);
  const total = conceptual + execution + time + skip + insufficient;
  const attributed = total - insufficient;
  const recoverable = execution + time + skip;
  // A wrong answer costs five marks against a right one (four missed, one
  // negative); a question left alone costs four.
  const q = {
    conceptual_gap: Math.round(conceptual / 5),
    execution_error: Math.round(execution / 5),
    time_exhaustion: Math.round(time / 4),
    avoidable_skip: Math.round(skip / 4),
    insufficient_evidence: Math.round(insufficient / 5),
  };
  const share = (m: number) => (total ? round((m / total) * 100, 1) : 0);
  const weakest = topicStatesOf(world, { weak: false, forgetting: false })
    .filter((s) => s.mastery !== null)
    .slice(0, 5);
  const lossSplit = splitInteger(Math.min(lost, 60), [5, 4, 3, 2, 2]);

  return {
    paper_id: paper.id,
    paper_name: paper.name,
    held_on: localDay(-paper.daysAgo),
    max_marks: paper.maxMarks,
    questions: paper.questions,
    attempted: paper.questions - q.time_exhaustion - q.avoidable_skip,
    score,
    conceptual_gap: conceptual,
    execution_error: execution,
    time_exhaustion: time,
    avoidable_skip: skip,
    insufficient_evidence: insufficient,
    total_lost: total,
    attributed_lost: attributed,
    recoverable,
    recoverable_pct: attributed ? round((recoverable / attributed) * 100, 1) : null,
    time_baseline_sec: paperId === 17 ? 100 : 94.5,
    causes: (
      [
        ["conceptual_gap", conceptual],
        ["execution_error", execution],
        ["time_exhaustion", time],
        ["avoidable_skip", skip],
        ["insufficient_evidence", insufficient],
      ] as const
    ).map(([cause, marks]) => ({ cause, marks, questions: q[cause], share_pct: share(marks) })),
    top_loss_topics: weakest.map((s, i) => ({
      topic_id: s.topic.id,
      topic: s.topic.name,
      subject: s.topic.subject,
      marks_lost: lossSplit[i],
      questions: Math.max(1, Math.round(lossSplit[i] / 5)),
    })),
  };
}

export function attemptsOf(
  world: World,
  { paper, status }: { paper?: number; status?: string },
): MyAttempt[] {
  const papers = new Map(world.persona.papers.map((p) => [p.id, p]));
  return world.persona.attempts
    .filter((a) => (paper === undefined ? true : a.paperId === paper))
    .filter((a) => (status ? a.status === status : true))
    .sort((a, b) => a.paperId - b.paperId || a.label.localeCompare(b.label, "en", { numeric: true }))
    .map((a, i) => {
      const p = papers.get(a.paperId)!;
      return {
        id: world.studentId * 100_000 + a.paperId * 1000 + i,
        paper_id: p.id,
        paper_name: p.name,
        question_id: a.label,
        question_pk: a.questionPk,
        topic_name: a.topic,
        status: a.status,
        chosen_option: a.chosen,
        marks: a.marks,
        time_spent: a.seconds,
        source: "mock",
        ts: localInstant(p.daysAgo, 10),
      } satisfies MyAttempt;
    });
}

/** A question this student answered, or undefined — the live route's 404. */
export function questionOf(world: World, pk: number): MyQuestion | undefined {
  const answered = world.persona.attempts.some((a) => a.questionPk === pk);
  const seed = questionByPk.get(pk);
  if (!answered || !seed) return undefined;
  const paper = world.persona.papers.find((p) => p.id === seed.paperId);
  return {
    id: seed.pk,
    label: seed.label,
    paper_id: seed.paperId,
    paper_name: paper?.name ?? "",
    topic: seed.topic,
    subject: seed.subject,
    difficulty: seed.difficulty,
    question_text: seed.text,
    solution: seed.solution,
    options: seed.options.map((o) => ({
      label: o.label,
      text: o.text,
      is_correct: o.label === seed.correct,
      chosen: o.label === seed.chosen,
    })),
    chosen_label: seed.chosen,
    status: seed.status,
    marks: seed.marks,
    time_spent: seed.seconds,
    source: "demo",
    source_ref: "",
  };
}

export function findingsOf(world: World): Finding[] {
  return world.persona.findings(new Date());
}

/* ------------------------------------------------------------------ *
 * The planner — `derived/services/planner.py`, the rules in brief
 * ------------------------------------------------------------------ */

/** At most this many revise blocks in a day, revisions and fading together. */
const MAX_REVISE = 2;

function revisionReason(r: MyRevision, day: string): string {
  const late = daysBetween(r.scheduled_for, day);
  return late <= 0
    ? `Revision ${r.cycle} is due today`
    : `Revision ${r.cycle} was due ${plural(late, "day")} ago`;
}

function lastTouchedDays(state: TopicState, day: string): number | null {
  const stamps = [state.last_seen, state.last_revised].filter(Boolean) as string[];
  if (!stamps.length) return null;
  const latest = stamps.sort().at(-1)!;
  return daysBetween(localDay(0, new Date(latest)), day);
}

export interface GenerateResult {
  status: 200 | 201;
  body: { date: string; generated: boolean; blocks: PlanBlock[]; note: string | null };
}

export function generatePlan(world: World, { replace }: { replace: boolean }): GenerateResult {
  const day = localDay();
  if (world.plan.length && !replace) {
    return {
      status: 200,
      body: { date: day, generated: false, blocks: world.plan, note: world.planNote },
    };
  }

  const kept = replace ? world.plan.filter((b) => b.completed) : [];
  const keptNames = new Set(kept.map((b) => b.topic_name));
  const lighter = world.persona.planNote !== null;
  let budget = clamp(world.onboarding.dailyMinutes ?? 240, 90, 360);
  if (lighter) budget = Math.round(budget * 0.8);

  type Spec = Omit<PlanBlock, "id" | "date" | "start_time" | "completed">;
  const specs: Spec[] = [];
  const chosen = new Set<string>(keptNames);
  const used = () => specs.reduce((a, s) => a + s.minutes, 0) + kept.reduce((a, b) => a + b.minutes, 0);
  const subjectOf = (name: string) => world.topics.find((t) => t.name === name)?.subject ?? "";

  // 1. Due revisions, soonest first.
  for (const r of revisionsOf(world, true).filter((r) => r.scheduled_for <= day)) {
    if (specs.filter((s) => s.mode === "revise").length >= MAX_REVISE) break;
    if (chosen.has(r.topic.name)) continue;
    chosen.add(r.topic.name);
    specs.push({
      minutes: 30,
      mode: "revise",
      topic_name: r.topic.name,
      subject: r.topic.subject,
      reason_code: `revision_r${r.cycle}`,
      reason_text: revisionReason(r, day),
    });
  }

  // 2. Chapters being forgotten, up to the revise cap.
  for (const s of topicStatesOf(world, { weak: false, forgetting: true })) {
    if (specs.filter((x) => x.mode === "revise").length >= MAX_REVISE) break;
    if (chosen.has(s.topic.name)) continue;
    const ago = lastTouchedDays(s, day);
    if (ago === null) continue;
    chosen.add(s.topic.name);
    const when = ago <= 0 ? "today" : ago === 1 ? "yesterday" : `${ago} days ago`;
    specs.push({
      minutes: 30,
      mode: "revise",
      topic_name: s.topic.name,
      subject: s.topic.subject,
      reason_code: "low_retention",
      reason_text: `You last worked on this ${when} — a short revision now keeps it fresh`,
    });
  }

  // 3. Weakest measured chapters, a neglected subject's first.
  const neglected = world.persona.neglectedSubject;
  const weak = topicStatesOf(world, { weak: true, forgetting: false }).sort((a, b) => {
    const an = a.topic.subject === neglected ? 0 : 1;
    const bn = b.topic.subject === neglected ? 0 : 1;
    return an - bn || (a.mastery ?? 0) - (b.mastery ?? 0);
  });
  for (const s of weak) {
    if (used() + 45 > budget) break;
    if (chosen.has(s.topic.name)) continue;
    chosen.add(s.topic.name);
    const evidence = `${Math.round((s.mastery ?? 0) * 100)}% over ${s.attempts_n} questions`;
    const balance = neglected !== null && s.topic.subject === neglected;
    specs.push({
      minutes: 45,
      mode: "practice",
      topic_name: s.topic.name,
      subject: s.topic.subject,
      reason_code: balance ? "subject_balance" : "weak_topic",
      reason_text: balance
        ? `${s.topic.subject} is costing you more marks than the time it gets, so it comes first: ${evidence}`
        : `One of your weakest chapters: ${evidence}`,
    });
  }

  // 4. One chapter taught and never attempted — except on a lighter day,
  // which starts nothing new.
  const taught = world.persona.taughtNotAttempted;
  if (taught && !lighter && !chosen.has(taught[0]) && used() + 45 <= budget) {
    const [name, daysAgo] = taught;
    const when = daysAgo <= 0 ? "today" : daysAgo === 1 ? "yesterday" : `${daysAgo} days ago`;
    specs.push({
      minutes: 45,
      mode: "learn",
      topic_name: name,
      subject: subjectOf(name),
      reason_code: "syllabus",
      reason_text: `Taught in class ${when}, and you have not attempted it yet`,
    });
  }

  if (!specs.length && !kept.length) {
    return { status: 200, body: { date: day, generated: false, blocks: [], note: null } };
  }

  world.plan = [
    ...kept,
    ...specs.map((s) => ({
      ...s,
      id: world.nextId++,
      date: day,
      start_time: null,
      completed: false,
    })),
  ];
  world.planNote = world.persona.planNote;
  return {
    status: 201,
    body: { date: day, generated: true, blocks: world.plan, note: world.planNote },
  };
}

const MODE_VERB: Record<string, string> = { revise: "revise", practice: "practise", learn: "start" };

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * `POST /api/my/plan/explain/`. With a plan, the guide's own two or three
 * sentences; with none, `deterministic_plan_summary`'s and `available: false`.
 */
export function explainPlan(world: World): PlanExplain {
  const day = localDay();
  const blocks = world.plan;
  if (!blocks.length) {
    return {
      date: day,
      summary: "There is nothing on your plan for today yet.",
      available: false,
      from_cache: false,
    };
  }
  const key = blocks.map((b) => `${b.topic_name}:${b.mode}:${b.minutes}`).join("|");
  const fromCache = world.explained.has(key);
  world.explained.add(key);
  const [first, ...rest] = blocks;
  const total = blocks.reduce((a, b) => a + b.minutes, 0);
  const why = (first.reason_text ?? "").trim();
  const lead = `Today opens by asking you to ${MODE_VERB[first.mode] ?? "work on"} ${first.topic_name}${
    why ? `, because ${why[0].toLowerCase()}${why.slice(1)}` : ""
  }.`;
  const then = rest.length
    ? ` After that you ${joinList(rest.map((b) => `${MODE_VERB[b.mode] ?? "work on"} ${b.topic_name}`))}.`
    : "";
  return {
    date: day,
    summary: `${lead}${then} It comes to ${total} minutes, which fits the time you said you have.`,
    available: true,
    from_cache: fromCache,
  };
}

/* ------------------------------------------------------------------ *
 * Next actions — `guidance.next_actions`
 * ------------------------------------------------------------------ */

const NO_STUDY_DAYS = 3;
const RECOVERABLE_COPY = {
  time_exhaustion: [
    "went to the clock",
    "You did not reach {q}. Timed practice on one section at a time wins these back without learning anything new.",
  ],
  execution_error: [
    "were slips",
    "{q} went wrong in chapters you usually get right. Go back over them to see where each one slipped.",
  ],
  avoidable_skip: [
    "were left blank",
    "You skipped {q} in chapters you can do. Next time, give each one a first look before moving on.",
  ],
} as const;

export function nextActionsOf(world: World): NextAction[] {
  const day = localDay();
  const blocks = world.plan;
  const due = revisionsOf(world, true).filter((r) => r.scheduled_for <= day);
  const weak = topicStatesOf(world, { weak: true, forgetting: false });
  const out: NextAction[] = [];

  if (blocks.length) {
    if (!blocks.some((b) => b.completed)) {
      const first = blocks[0];
      const reason = first.reason_text ? ` — ${first.reason_text}` : "";
      out.push({
        kind: "start_plan",
        title: "Start today's plan",
        detail: `${plural(blocks.length, "block")}, ${blocks.reduce((a, b) => a + b.minutes, 0)} minutes. First up: ${first.topic_name}${reason}.`,
        target: "plan",
      });
    }
  } else if (due.length || weak.length) {
    out.push({
      kind: "make_plan",
      title: "Make today's plan",
      detail:
        "It puts your due revisions and weakest chapters in order and fits them to the time you usually study.",
      target: "plan",
    });
  }

  if (due.length) {
    const first = due[0];
    const late = daysBetween(first.scheduled_for, day);
    const when =
      late <= 0 ? `revision ${first.cycle} is due today` : `revision ${first.cycle} was due ${ago(late)}`;
    out.push(
      due.length === 1
        ? {
            kind: "revisions_due",
            title: `Revise ${first.topic.name}`,
            detail: `${when[0].toUpperCase()}${when.slice(1)}. Revising on time stops it fading.`,
            target: "revisions",
          }
        : {
            kind: "revisions_due",
            title: `${due.length} revisions are due`,
            detail: `Start with ${first.topic.name}: ${when}.`,
            target: "revisions",
          },
    );
  }

  const latest = papersOf(world).at(-1);
  const analysis = latest ? marksLostOf(world, latest.id) : undefined;
  if (analysis) {
    const candidates = (["execution_error", "time_exhaustion", "avoidable_skip"] as const)
      .map((cause) => ({ cause, row: analysis.causes.find((c) => c.cause === cause)! }))
      .sort((a, b) => b.row.marks - a.row.marks);
    const top = candidates[0];
    if (top && top.row.marks > 0) {
      const [ending, detail] = RECOVERABLE_COPY[top.cause];
      let text = detail.replace("{q}", plural(top.row.questions, "question"));
      if (analysis.recoverable > top.row.marks) {
        text += ` In all, ${analysis.recoverable} of the marks you lost on this paper needed no new learning.`;
      }
      out.push({
        kind: "mock_recoverable",
        title: `${top.row.marks} marks on ${analysis.paper_name} ${ending}`,
        detail: text,
        target: { mock: analysis.paper_id },
      });
    }
  }

  if (weak.length) {
    const w = weak[0];
    out.push({
      kind: "weak_chapter",
      title: `Practise ${w.topic.name}`,
      detail: `Your weakest chapter so far: ${Math.round((w.mastery ?? 0) * 100)}% over ${plural(w.attempts_n ?? 0, "question")}.`,
      target: "topics",
    });
  }

  const lastLog = world.logs[0];
  if (!lastLog) {
    out.push({
      kind: "log_study",
      title: "Log what you study",
      detail:
        "Nothing is logged yet. A quick log after each session lets your plan fit the time you really have.",
      target: "study-log",
    });
  } else {
    const days = daysBetween(localDay(0, new Date(lastLog.ts)), day);
    if (days >= NO_STUDY_DAYS) {
      out.push({
        kind: "log_study",
        title: "Log your recent study",
        detail: `Your last logged session was ${ago(days)}. If you have studied since, add it so your plan fits your real day.`,
        target: "study-log",
      });
    }
  }

  const rated = new Set(world.ratings.map((r) => r.topic));
  const unrated = weak.filter((w) => !rated.has(w.topic.id)).map((w) => w.topic.name);
  if (unrated.length) {
    const shown = [...unrated.slice(0, 3), ...(unrated.length > 3 ? [`${unrated.length - 3} more`] : [])];
    out.push({
      kind: "rate_confidence",
      title:
        unrated.length === 1
          ? `How sure are you about ${unrated[0]}?`
          : `Rate your confidence in ${unrated.length} chapters`,
      detail: `Say how sure you feel about ${joinList(shown)}. Setting that beside your scores shows where practice will help most.`,
      target: "confidence",
    });
  }

  return out.slice(0, 5);
}

/* ------------------------------------------------------------------ *
 * Writes
 * ------------------------------------------------------------------ */

/** Mark a revision done once, and schedule the next cycle at once. */
export function completeRevision(world: World, id: number): MyRevision | undefined {
  const revision = world.revisions.find((r) => r.id === id);
  if (!revision) return undefined;
  if (!revision.done_at) {
    revision.done_at = new Date().toISOString();
    const gap = revision.cycle === 1 ? 7 : revision.cycle === 2 ? 30 : null;
    if (gap !== null) {
      world.revisions.push({
        id: world.nextId++,
        topic: revision.topic,
        cycle: revision.cycle + 1,
        scheduled_for: localDay(gap),
        done_at: null,
        is_overdue: false,
      });
    }
    const state = world.states.find((s) => s.topic.id === revision.topic.id);
    if (state) {
      Object.assign(state, { last_revised: revision.done_at, retention: 0.96 });
    }
  }
  return withOverdue([revision])[0];
}

export function addStudyLog(
  world: World,
  body: { topic: number; minutes: number; mode: StudyLogCreate["mode"]; ts: string },
): StudyLogCreate {
  const topic = world.topics.find((t) => t.id === body.topic)!;
  const row: StudyLogCreate = {
    id: world.nextId++,
    topic: topic.id,
    topic_name: topic.name,
    minutes: body.minutes,
    mode: body.mode,
    ts: new Date(body.ts).toISOString(),
  };
  world.logs = [row, ...world.logs].sort((a, b) => b.ts.localeCompare(a.ts));
  // The first time a chapter is met, logging it schedules R1 for tomorrow.
  if (!world.revisions.some((r) => r.topic.id === topic.id)) {
    world.revisions.push({
      id: world.nextId++,
      topic: { id: topic.id, name: topic.name, kind: "chapter", weight: topic.weight, subject: topic.subject },
      cycle: 1,
      scheduled_for: localDay(1),
      done_at: null,
      is_overdue: false,
    });
  }
  const state = world.states.find((s) => s.topic.id === topic.id);
  if (state) state.exposure_min = (state.exposure_min ?? 0) + body.minutes;
  return row;
}

export function addRating(world: World, topicId: number, rating: number): ConfidenceRating {
  const topic = world.topics.find((t) => t.id === topicId)!;
  const row: ConfidenceRating = {
    id: world.nextId++,
    topic: topic.id,
    topic_name: topic.name,
    self_rating: rating,
    ts: new Date().toISOString(),
  };
  world.ratings = [row, ...world.ratings];
  const state = world.states.find((s) => s.topic.id === topicId);
  if (state) {
    Object.assign(state, {
      self_rating: rating,
      confidence_gap: state.mastery === null ? null : round(rating / 5 - state.mastery, 2),
    });
  }
  return row;
}

/* ------------------------------------------------------------------ *
 * The guide's answers — what the mock says in place of the model
 * ------------------------------------------------------------------ */

/** `guidance.WELLBEING_REPLY`, verbatim. */
export const WELLBEING_REPLY =
  "I'm really sorry you're feeling like this, and I'm glad you said something. Please talk to your mentor or a trusted adult — a parent, a teacher, someone at home — today. If you might be in danger right now, tell an adult near you straight away.";

const DISTRESS =
  /\b(?:suicid\w*|kill(?:ing)?\s+my\s*self|end(?:ing)?\s+my\s+life|self[\s-]?harm\w*|hurt(?:ing)?\s+my\s*self|want\s+to\s+die|wanna\s+die|better\s+off\s+dead)\b/i;

/** A request to solve something, or to explain the content of a chapter. */
const SUBJECT_DOUBT =
  /\b(solve|calculate|find the|evaluate|integrate|differentiate|derive|prove|what is the (value|answer)|explain (how|why|the concept)|formula for|mechanism of)\b|[=+]\s*\d|\d\s*[x×*/^]\s*\d/i;

export function answerQuestion(world: World, question: string): { answer: string; fromCache: boolean } {
  const normalised = question.replace(/\s+/g, " ").trim().toLowerCase();
  const fromCache = world.asked.has(normalised);
  world.asked.add(normalised);

  if (DISTRESS.test(question)) return { answer: WELLBEING_REPLY, fromCache: false };
  if (SUBJECT_DOUBT.test(question)) {
    return {
      answer:
        "I can't solve questions or explain a chapter's content — that's one to take to your teacher, who can work through it with you. I can help with how it fits your preparation: what to study next, or why something is in your plan.",
      fromCache,
    };
  }

  const inPlan = world.plan.find((b) => normalised.includes(b.topic_name.toLowerCase()));
  if (inPlan) {
    const why = (inPlan.reason_text ?? "").trim();
    return {
      answer: `${inPlan.topic_name} is in your plan today${
        why ? ` because ${why[0].toLowerCase()}${why.slice(1)}` : ""
      }. It's a ${inPlan.minutes}-minute ${inPlan.mode === "practice" ? "practice" : inPlan.mode === "revise" ? "revision" : "learning"} block, so one focused sitting is enough.`,
      fromCache,
    };
  }

  const due = revisionsOf(world, true).filter((r) => r.scheduled_for <= localDay());
  const breakdown = subjectBreakdownOf(world);
  const costly = [...breakdown].sort(
    (a, b) => b.marks_lost_share_pct - b.time_share_pct - (a.marks_lost_share_pct - a.time_share_pct),
  )[0];
  const parts: string[] = [];
  if (due.length) {
    parts.push(
      `Start with the ${due.length === 1 ? "revision that is" : `${due.length} revisions that are`} waiting: ${joinList(due.slice(0, 3).map((r) => r.topic.name))}.`,
    );
  }
  if (costly && costly.marks_lost_share_pct > costly.time_share_pct) {
    parts.push(
      `Then give ${costly.subject} more of your week: it gets ${Math.round(costly.time_share_pct)}% of your study time but accounts for ${Math.round(costly.marks_lost_share_pct)}% of the marks you lose.`,
    );
  }
  parts.push(
    world.plan.length
      ? "Your plan for today already follows that order."
      : "Making today's plan puts all of this in order for you.",
  );
  return { answer: parts.join(" "), fromCache };
}
