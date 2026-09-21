import type { SubjectKey } from "@/lib/subjects";

/**
 * Real JEE Main chapter names with PYQ-frequency weights. Fake data that looks
 * fake kills the room; a director recognises these.
 */
export interface SyllabusTopic {
  id: number;
  name: string;
  subject: SubjectKey;
  /** Share of the paper this chapter historically carries. */
  weight: number;
}

const rows: [SubjectKey, string, number][] = [
  ["physics", "Kinematics", 3.2],
  ["physics", "Laws of Motion", 3.6],
  ["physics", "Work, Power & Energy", 3.1],
  ["physics", "Rotational Motion", 4.4],
  ["physics", "Gravitation", 2.4],
  ["physics", "Thermodynamics", 4.1],
  ["physics", "Oscillations & Waves", 3.8],
  ["physics", "Electrostatics", 5.2],
  ["physics", "Current Electricity", 4.6],
  ["physics", "Magnetic Effects of Current", 4.0],
  ["physics", "Electromagnetic Induction", 3.4],
  ["physics", "Ray Optics", 3.9],
  ["physics", "Modern Physics", 5.6],

  ["chemistry", "Some Basic Concepts", 2.1],
  ["chemistry", "Atomic Structure", 3.0],
  ["chemistry", "Chemical Bonding", 5.4],
  ["chemistry", "Chemical Thermodynamics", 4.2],
  ["chemistry", "Chemical Equilibrium", 3.3],
  ["chemistry", "Ionic Equilibrium", 3.7],
  ["chemistry", "Electrochemistry", 3.9],
  ["chemistry", "Chemical Kinetics", 3.1],
  ["chemistry", "p-Block Elements", 5.1],
  ["chemistry", "d- & f-Block Elements", 3.4],
  ["chemistry", "Coordination Compounds", 4.8],
  ["chemistry", "General Organic Chemistry", 5.9],
  ["chemistry", "Hydrocarbons", 3.6],
  ["chemistry", "Aldehydes, Ketones & Acids", 4.3],
  ["chemistry", "Amines & Biomolecules", 3.2],

  ["maths", "Quadratic Equations", 3.1],
  ["maths", "Complex Numbers", 3.4],
  ["maths", "Sequences & Series", 3.0],
  ["maths", "Matrices & Determinants", 4.5],
  ["maths", "Permutations & Combinations", 3.2],
  ["maths", "Binomial Theorem", 2.8],
  ["maths", "Straight Lines", 3.3],
  ["maths", "Circles", 3.5],
  ["maths", "Conic Sections", 4.1],
  ["maths", "Limits & Continuity", 3.6],
  ["maths", "Differentiation", 4.0],
  ["maths", "Application of Derivatives", 4.6],
  ["maths", "Indefinite & Definite Integration", 5.3],
  ["maths", "Differential Equations", 3.1],
  ["maths", "Vectors & 3D Geometry", 5.0],
  ["maths", "Probability", 3.8],
];

export const syllabus: SyllabusTopic[] = rows.map(([subject, name, weight], i) => ({
  id: 100 + i,
  name,
  subject,
  weight,
}));

export const SUBJECT_LABEL: Record<SubjectKey, string> = {
  physics: "Physics",
  chemistry: "Chemistry",
  maths: "Maths",
};
