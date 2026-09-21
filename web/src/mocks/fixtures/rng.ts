/**
 * Deterministic pseudo-randomness. Fixtures must look organic but never change
 * between reloads — a demo where the numbers move while a director is looking
 * at them is worse than obviously-fake data.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(...parts: (string | number)[]): number {
  let h = 2166136261;
  for (const part of parts) {
    const s = String(part);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  return h >>> 0;
}

export function round(value: number, digits = 0): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Split `total` into integer parts by weight, with the remainder on part 0. */
export function splitInteger(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const parts = weights.map((w) => Math.round((total * w) / sum));
  const drift = total - parts.reduce((a, b) => a + b, 0);
  parts[0] += drift;
  return parts.map((p) => Math.max(0, p));
}

const DAY = 86_400_000;

/** Fixtures are anchored to "now" so the demo never looks stale. */
export const NOW = new Date();

export function daysBefore(days: number): Date {
  return new Date(NOW.getTime() - days * DAY);
}

export function isoDate(days: number): string {
  return daysBefore(days).toISOString().slice(0, 10);
}

export function isoDateTime(days: number, hour = 10): string {
  const d = daysBefore(days);
  d.setHours(hour, (hour * 7) % 60, 0, 0);
  return d.toISOString();
}
