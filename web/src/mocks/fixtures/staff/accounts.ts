import type { LoginStatus, StudentCredential } from "@/api/types";
import { seedById } from "../students";

/**
 * Student logins, for the mock server.
 *
 * Three students already have one, so every state the console shows is on
 * screen in mock mode: Rohan and Meera have chosen their own password,
 * Kunal was issued a temporary one and has not signed in yet. Everyone else
 * has none. All four are Dr. Bhatia's, the signed-in demo mentor's, which is
 * where a mentor would have started.
 */
const SEEDED: [number, LoginStatus][] = [
  [7, "active"],
  [11, "active"],
  [4, "awaiting_first_sign_in"],
];

const status = new Map<number, LoginStatus>(SEEDED);

export function loginStatusOf(studentId: number): LoginStatus {
  return status.get(studentId) ?? "none";
}

/** Back to the seeded state. Tests call this between cases. */
export function resetAccounts() {
  status.clear();
  for (const [id, s] of SEEDED) status.set(id, s);
}

/**
 * A temporary password the way the server makes one: random, and from an
 * alphabet with no 0/O or 1/l/I, because it is read aloud and copied by hand.
 */
function temporaryPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzACDEFGHJKMNPQRTUVWXY23456789";
  const pick = () => alphabet[Math.floor(Math.random() * alphabet.length)];
  return Array.from({ length: 10 }, pick).join("");
}

export type AccountRefusal =
  | { status: 404; detail: string }
  | { status: 403; detail: string }
  | { status: 409; detail: string };

/**
 * `POST /api/students/{id}/account/` and `…/reset-password/`, with the server's
 * own refusals and words: 403 for a colleague's student (a director may act on
 * anyone's), 409 for a student who has left, already has a login, or — for a
 * reset — has none yet.
 */
export function credentialFor(
  action: "issue" | "reset",
  studentId: number,
  caller: { role: string | null; mentor_id: number | null },
): StudentCredential | AccountRefusal {
  const seed = seedById.get(studentId);
  if (!seed) return { status: 404, detail: "Not found." };
  if (caller.role !== "director" && seed.mentorId !== caller.mentor_id) {
    return { status: 403, detail: "That student is not assigned to you." };
  }
  if (action === "issue") {
    if (seed.exited_at) return { status: 409, detail: "This student has left the institute." };
    if (loginStatusOf(studentId) !== "none") {
      return {
        status: 409,
        detail:
          "This student already has a login. To give them a new temporary password, reset it.",
      };
    }
  } else if (loginStatusOf(studentId) === "none") {
    return { status: 409, detail: "This student has no login yet. Issue one first." };
  }

  status.set(studentId, "awaiting_first_sign_in");
  return {
    student_id: seed.id,
    name: seed.name,
    roll_no: seed.roll_no,
    temporary_password: temporaryPassword(),
    must_change_password: true,
  };
}
