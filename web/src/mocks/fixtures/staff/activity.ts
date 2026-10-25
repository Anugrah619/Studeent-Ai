import type {
  ConfidenceRating,
  Intervention,
  PlanBlock,
  Revision,
  StudyLog,
  TopicState,
} from "@/api/types";
import { topicStatesFor } from "../analytics";
import { flags, interventions } from "../flags";
import { mentors } from "../institute";
import { planBlocks } from "../plan";
import { hashSeed, isoDate, isoDateTime, mulberry32 } from "../rng";
import { seedById } from "../students";

/**
 * What a student does between mocks, as their mentor reads it on Student 360:
 * their plan for a day, the study they log, how sure they say they are, the
 * revisions booked for them and the chapters they are forgetting.
 *
 * Generated from each student's own chapter states (`topicStatesFor`), so the
 * chapter a revision is booked on, a rating is given for and a log is written
 * against is always one the student actually has — and the same on every load.
 */

const MODES = ["learn", "practice", "revise"] as const;

/** The local calendar day, as the console asks for it. */
function localIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function dayOffset(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  const then = new Date(y, m - 1, d).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((today - then) / 86_400_000);
}

/**
 * `GET /api/students/{id}/plan/?date=`. Aarav (1) has today's plan — the
 * plan fixture the student app shows — and a short one from yesterday, all of
 * it ticked. Nobody else has one, which is the honest empty state the panel
 * must handle on the live server too.
 */
export function planFor(studentId: number, date: string | null): PlanBlock[] {
  const day = date ?? localIso(new Date());
  const offset = dayOffset(day);
  if (studentId !== 1) return [];
  if (offset === 0) return planBlocks.map((block) => ({ ...block, date: day }));
  if (offset === 1) {
    return planBlocks.slice(0, 3).map((block) => ({
      ...block,
      id: 200 + block.id,
      date: day,
      completed: true,
    }));
  }
  return [];
}

export function studyLogsFor(studentId: number): StudyLog[] {
  if (!seedById.has(studentId)) return [];
  const rand = mulberry32(hashSeed("study-logs", studentId));
  const topics = topicStatesFor(studentId);
  const count = 8 + Math.floor(rand() * 10);
  const rows: StudyLog[] = [];
  for (let i = 0; i < count; i++) {
    const topic = topics[Math.floor(rand() * topics.length)].topic;
    rows.push({
      id: studentId * 1000 + i,
      topic: topic.id,
      topic_name: topic.name,
      minutes: 20 + Math.round(rand() * 14) * 10,
      mode: MODES[Math.floor(rand() * MODES.length)],
      ts: isoDateTime(Math.floor(i * 1.4), 7 + Math.floor(rand() * 12)),
    });
  }
  return rows.sort((a, b) => b.ts.localeCompare(a.ts));
}

export function confidenceFor(studentId: number): ConfidenceRating[] {
  if (!seedById.has(studentId)) return [];
  const rand = mulberry32(hashSeed("confidence", studentId));
  return topicStatesFor(studentId)
    .filter((state) => state.self_rating != null)
    .slice(0, 9)
    .map((state, i) => ({
      id: studentId * 100 + i,
      topic: state.topic.id,
      topic_name: state.topic.name,
      self_rating: state.self_rating ?? 3,
      ts: isoDateTime(3 + i * 4 + Math.floor(rand() * 3), 20),
    }));
}

/** Pending revision cycles, soonest first — so the overdue ones lead. */
export function revisionsFor(studentId: number): Revision[] {
  if (!seedById.has(studentId)) return [];
  const rand = mulberry32(hashSeed("revisions", studentId));
  const rows = topicStatesFor(studentId)
    .filter((_, i) => i % 2 === 0)
    .slice(0, 9)
    .map((state, i): Revision => {
      // Days ago it fell due: up to three weeks overdue, or up to two weeks ahead.
      const ago = Math.round(rand() * 35) - 14;
      return {
        id: studentId * 100 + i,
        topic: state.topic,
        cycle: 1 + Math.floor(rand() * 3),
        scheduled_for: isoDate(ago),
        done_at: null,
        is_overdue: ago > 0,
      };
    });
  return rows.sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for));
}

/** `?forgetting=true`: forecast recall below one half, fastest-fading first. */
export function fadingFor(studentId: number): TopicState[] {
  return topicStatesFor(studentId)
    .filter((state) => state.retention != null && state.retention < 0.5)
    .sort((a, b) => (a.retention ?? 0) - (b.retention ?? 0));
}

/**
 * What was done about each closed flag before it closed, plus anything logged
 * in this session (`interventions`, which `/intervene/` appends to). Newest
 * first, as the route returns them.
 */
const HISTORY: Record<number, [string, number][]> = {
  // flag id: [action, days after the flag was raised]
  90: [
    ["1:1 scheduled with mentor", 2],
    ["Assigned a targeted drill set", 9],
  ],
  91: [["Called the parent", 3]],
  92: [
    ["Called the parent", 1],
    ["Reduced weekly load", 6],
  ],
  93: [["Moved to the remedial Chemistry slot", 4]],
};

export function interventionsFor(flagId: number): Intervention[] {
  const flag = flags.find((f) => f.id === flagId);
  if (!flag) return [];
  const student = seedById.get(flag.student_id);
  const mentor = mentors.find((m) => m.id === student?.mentorId) ?? mentors[0];
  const raised = Date.parse(flag.raised_at);
  const seeded: Intervention[] = (HISTORY[flagId] ?? []).map(([action, after], i) => ({
    id: flagId * 10 + i,
    flag: flagId,
    mentor: mentor.id,
    mentor_name: mentor.name,
    action,
    taken_at: new Date(raised + after * 86_400_000).toISOString(),
  }));
  return [...seeded, ...interventions.filter((row) => row.flag === flagId)].sort((a, b) =>
    b.taken_at.localeCompare(a.taken_at),
  );
}
