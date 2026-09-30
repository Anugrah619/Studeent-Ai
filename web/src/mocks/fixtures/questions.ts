import type {
  AttemptStatus,
  Misconception,
  QuestionDetail,
  QuestionOption,
} from "@/api/types";

/**
 * `GET /api/questions/{id}/` fixtures, transcribed from the live server.
 *
 * Every question below is the actual body returned for one of the ids the
 * diagnosis fixtures cite, fetched with `?student=` set to the student whose
 * diagnosis cites it — stem, solution, option order, `is_correct`, the tagged
 * misconceptions with their descriptions and remedies verbatim, and the four
 * per-student fields. Nothing here is invented, which is the property that
 * makes flipping `VITE_USE_MOCKS` a change of *source* and not a change of
 * subject: click "D16 chose C" with the mock server running and you get the
 * same panel the live API gives you.
 *
 * Two things the transcripts settled that a reading of the contract would not:
 *
 *   - **The correct option is not always (A).** On D16 it is (B); on D17 it is
 *     (D); on D20 it is (A). The seeder shuffles labels deliberately — an
 *     earlier version put every answer at (A), which anyone scrolling a paper
 *     would have spotted. So the panel never infers correctness from position,
 *     and neither does this file.
 *   - **A wrong option that was not chosen can still carry a misconception.**
 *     D17 tags both (A) and (C) with MIS-ORG-EAS, and Aarav chose (C). Only the
 *     chosen one can fire, which is why the shape below keeps the tag on the
 *     option rather than on the question.
 *
 * The composition is split the way the server splits it: `QUESTIONS` is the
 * question as the paper prints it, `ATTEMPTS` is what one student did with it,
 * and `questionFor()` joins them. That is not tidiness — it is the only way the
 * mock can reproduce the endpoint's **three** per-student states rather than
 * two. See the note on `questionFor`.
 */

interface QuestionSeed {
  label: string;
  paper_id: number;
  paper_name: string;
  topic: string | null;
  subject: string | null;
  difficulty: "easy" | "medium" | "hard";
  question_text: string;
  solution: string;
  options: Array<{
    label: string;
    text: string;
    is_correct: boolean;
    misconception: Misconception | null;
  }>;
}

interface StoredAttempt {
  chosen_label: string | null;
  status: AttemptStatus | null;
  marks: number | null;
  time_spent: number | null;
}

const MISCONCEPTIONS: Record<string, Misconception> = {
  "MIS-CALC-CHAIN": {
    code: "MIS-CALC-CHAIN",
    subject: "Maths",
    name: "Chain rule inner derivative dropped",
    description:
      "d/dx of sin(3x) is cos(3x), and the integral of cos(3x) is sin(3x): the outer function is the thing you differentiate or integrate, and the 3 inside is part of the name of the variable.",
    remedy:
      "Ban writing the answer directly for one session. Every composite gets u = inner, du = u' dx written out, the integral rewritten in u and then back-substituted — even for the integral of e^(5x). Once the factor appears mechanically three times running, remove the scaffolding and re-test on sin(2x + 5).",
  },
  "MIS-KIN-RELVEL": {
    code: "MIS-KIN-RELVEL",
    subject: "Physics",
    name: "Relative motion computed in the wrong frame",
    description:
      "All the velocities in a problem are in the same frame, so the given numbers can be used directly; the velocity of A relative to B is just whichever of the two the question is about, and the umbrella tilts along the rain's own direction.",
    remedy:
      "Every relative-motion answer opens with the line v(A rel B) = v(A) - v(B), written as components, before any triangle is drawn. Do rain-and-man, river-crossing and two-trains on one page so the student sees a single subtraction doing all three.",
  },
  "MIS-ORG-EAS": {
    code: "MIS-ORG-EAS",
    subject: "Chemistry",
    name: "Directing effects reversed",
    description:
      "An activating group (–CH3, –OH, –NH2) sends the incoming group to meta; a deactivating group (–NO2, –COOH, –SO3H) sends it to ortho and para. Whether a substituent is o/p- or meta-directing is decided by whether it speeds the reaction up or slows it down.",
    remedy:
      "Twenty minutes at the board on nitration of toluene and of nitrobenzene, drawing all three arenium-ion resonance structures for ortho, meta and para attack in each case, with the student marking which structures put positive charge on the substituted carbon. Then six substituents cold: position only, from the structures. Finish with chlorobenzene — deactivating but o/p-directing — because it is the case that breaks the 'activating therefore o/p' shortcut and shows the rule is about resonance, not about rate.",
  },
  "MIS-ORG-MARKOV": {
    code: "MIS-ORG-MARKOV",
    subject: "Chemistry",
    name: "Markovnikov rule misapplied",
    description:
      "In HX addition the halogen goes to the carbon that already carries more hydrogens — the rule recited the wrong way round — and a peroxide makes no difference to the product because a peroxide is just a catalyst.",
    remedy:
      "Stop teaching it as a rule. The student draws both possible carbocations for propene + HBr and labels which is secondary and which is primary; the product then follows without the rule. Do the peroxide case as a radical mechanism on the same board so the reversal is visibly a different mechanism rather than an exception to memorise. Test on 2-methylpropene and on but-2-ene — the second gives the same answer either way, which shows whether they are reasoning or reciting.",
  },
  "MIS-ORG-STABILITY": {
    code: "MIS-ORG-STABILITY",
    subject: "Chemistry",
    name: "Carbocation stability order wrong",
    description:
      "Carbocation stability follows group size or the order I happened to memorise, so a primary cation can outrank a tertiary one; and whichever cation forms first is the one that reacts, because cations do not rearrange.",
    remedy:
      "Count hyperconjugative structures out loud on each candidate — nine for tert-butyl, six for isopropyl, three for ethyl, none for methyl. Then run 3-methylbut-1-ene + HBr on the board and ask why the observed product is not the one the first-formed cation gives; the 1,2-hydride shift makes the point that stability drives the outcome, not order of formation.",
  },
  "MIS-ROT-AXIS": {
    code: "MIS-ROT-AXIS",
    subject: "Physics",
    name: "Wrong axis of rotation",
    description:
      "Moment of inertia is a property of the body, so the tabulated value is the value — ML2/12 for a rod, MR2/2 for a disc — whatever axis the question names. The parallel-axis theorem is for questions that say 'parallel axis'.",
    remedy:
      "Before any number is written, the axis gets drawn on the diagram and the distance from the centre of mass to it labelled d. Make that the first mark on every rotation answer for a week. Then give the same rod four times — about the centre, about an end, about a point L/4 from an end, and with a bead fixed at one end — so the body is constant and only the axis moves.",
  },
  "MIS-ROT-SHAPE": {
    code: "MIS-ROT-SHAPE",
    subject: "Physics",
    name: "Wrong body's formula",
    description:
      "The standard results are one interchangeable family — MR2/2, MR2, 2MR2/5 — and you use whichever one comes to mind; a rod and a disc are close enough that ML2/2 and MR2/2 feel like the same formula.",
    remedy:
      "Derive two of them from the integral in one sitting — the ring and the rod — so the results stop being a list to pick from. Then a two-minute drill: shape named, and the student says which integral it came from before quoting the formula.",
  },
};

const QUESTIONS: Record<number, QuestionSeed> = {
  909: {
    label: "D02",
    paper_id: 17,
    paper_name: "Mock 15 — Diagnostic",
    topic: "Rotational Motion",
    subject: "Physics",
    difficulty: "medium",
    question_text:
      "A uniform disc of mass M and radius R rotates about one of its diameters. Its moment of inertia is:",
    solution:
      "About the central axis perpendicular to the plane, I = MR^2/2. By the perpendicular-axis theorem that equals the sum of the two in-plane diameters, which are equal, so each is MR^2/4.",
    options: [
      {
        label: "A",
        text: "MR^2/2",
        is_correct: false,
        misconception: MISCONCEPTIONS["MIS-ROT-AXIS"],
      },
      {
        label: "B",
        text: "MR^2/4",
        is_correct: true,
        misconception: null,
      },
      {
        label: "C",
        text: "MR^2",
        is_correct: false,
        misconception: MISCONCEPTIONS["MIS-ROT-SHAPE"],
      },
      {
        label: "D",
        text: "2MR^2/5",
        is_correct: false,
        misconception: MISCONCEPTIONS["MIS-ROT-SHAPE"],
      },
    ],
  },
  910: {
    label: "D03",
    paper_id: 17,
    paper_name: "Mock 15 — Diagnostic",
    topic: "Rotational Motion",
    subject: "Physics",
    difficulty: "hard",
    question_text:
      "A solid sphere of mass M and radius R rotates about a tangent to its surface. Its moment of inertia is:",
    solution:
      "About a diameter I = 2MR^2/5. A tangent is parallel to a diameter at distance R, so add MR^2: 2MR^2/5 + MR^2 = 7MR^2/5.",
    options: [
      {
        label: "A",
        text: "3MR^2/2",
        is_correct: false,
        misconception: MISCONCEPTIONS["MIS-ROT-SHAPE"],
      },
      {
        label: "B",
        text: "7MR^2/5",
        is_correct: true,
        misconception: null,
      },
      {
        label: "C",
        text: "2MR^2/5",
        is_correct: false,
        misconception: MISCONCEPTIONS["MIS-ROT-AXIS"],
      },
      {
        label: "D",
        text: "5MR^2/3",
        is_correct: false,
        misconception: MISCONCEPTIONS["MIS-ROT-SHAPE"],
      },
    ],
  },
  911: {
    label: "D04",
    paper_id: 17,
    paper_name: "Mock 15 — Diagnostic",
    topic: "Rotational Motion",
    subject: "Physics",
    difficulty: "hard",
    question_text:
      "A uniform rod of mass M and length L rotates about an axis perpendicular to the rod through a point L/4 from one end. Its moment of inertia is:",
    solution:
      "The centre of mass is at L/2, so the axis is d = L/4 from it. I = ML^2/12 + M(L/4)^2 = ML^2/12 + ML^2/16 = 7ML^2/48.",
    options: [
      {
        label: "A",
        text: "ML^2/16",
        is_correct: false,
        misconception: null,
      },
      {
        label: "B",
        text: "ML^2/12",
        is_correct: false,
        misconception: MISCONCEPTIONS["MIS-ROT-AXIS"],
      },
      {
        label: "C",
        text: "7ML^2/48",
        is_correct: true,
        misconception: null,
      },
      {
        label: "D",
        text: "ML^2/3",
        is_correct: false,
        misconception: MISCONCEPTIONS["MIS-ROT-AXIS"],
      },
    ],
  },
  912: {
    label: "D05",
    paper_id: 17,
    paper_name: "Mock 15 — Diagnostic",
    topic: "Rotational Motion",
    subject: "Physics",
    difficulty: "medium",
    question_text:
      "A thin circular ring of mass M and radius R rotates about a tangent lying in the plane of the ring. Its moment of inertia is:",
    solution:
      "About a diameter I = MR^2/2. The tangent in the plane is parallel to a diameter at distance R, so add MR^2, giving 3MR^2/2.",
    options: [
      {
        label: "A",
        text: "2MR^2",
        is_correct: false,
        misconception: MISCONCEPTIONS["MIS-ROT-AXIS"],
      },
      {
        label: "B",
        text: "MR^2/4",
        is_correct: false,
        misconception: MISCONCEPTIONS["MIS-ROT-SHAPE"],
      },
      {
        label: "C",
        text: "MR^2/2",
        is_correct: false,
        misconception: MISCONCEPTIONS["MIS-ROT-AXIS"],
      },
      {
        label: "D",
        text: "3MR^2/2",
        is_correct: true,
        misconception: null,
      },
    ],
  },
  913: {
    label: "D06",
    paper_id: 17,
    paper_name: "Mock 15 — Diagnostic",
    topic: "Rotational Motion",
    subject: "Physics",
    difficulty: "hard",
    question_text:
      "A uniform rod of mass M and length L carries a small bead, also of mass M, fixed at one end. The system rotates about an axis through the other end, perpendicular to the rod. Its moment of inertia is:",
    solution:
      "The rod about its end contributes ML^2/3. The bead is a point mass at distance L, contributing ML^2. Total = ML^2/3 + ML^2 = 4ML^2/3.",
    options: [
      {
        label: "A",
        text: "ML^2/3",
        is_correct: false,
        misconception: null,
      },
      {
        label: "B",
        text: "4ML^2/3",
        is_correct: true,
        misconception: null,
      },
      {
        label: "C",
        text: "2ML^2",
        is_correct: false,
        misconception: null,
      },
      {
        label: "D",
        text: "13ML^2/12",
        is_correct: false,
        misconception: MISCONCEPTIONS["MIS-ROT-AXIS"],
      },
    ],
  },
  914: {
    label: "D07",
    paper_id: 17,
    paper_name: "Mock 15 — Diagnostic",
    topic: "Rotational Motion",
    subject: "Physics",
    difficulty: "easy",
    question_text:
      "A uniform disc of mass M and radius R rotates about the axis through its centre, perpendicular to its plane. Its moment of inertia is:",
    solution:
      "This is the standard central axis for a disc, so no shift of axis is involved: I = MR^2/2.",
    options: [
      {
        label: "A",
        text: "2MR^2/5",
        is_correct: false,
        misconception: MISCONCEPTIONS["MIS-ROT-SHAPE"],
      },
      {
        label: "B",
        text: "MR^2",
        is_correct: false,
        misconception: MISCONCEPTIONS["MIS-ROT-SHAPE"],
      },
      {
        label: "C",
        text: "3MR^2/2",
        is_correct: false,
        misconception: null,
      },
      {
        label: "D",
        text: "MR^2/2",
        is_correct: true,
        misconception: null,
      },
    ],
  },
  922: {
    label: "D15",
    paper_id: 17,
    paper_name: "Mock 15 — Diagnostic",
    topic: "Kinematics",
    subject: "Physics",
    difficulty: "medium",
    question_text:
      "Rain is falling vertically downwards at 4 m/s. A man runs horizontally at 3 m/s. He must hold his umbrella tilted forward from the vertical at an angle theta, where:",
    solution:
      "In the man's frame the rain's velocity is v(rain) - v(man), with components (-3, -4). Measured from the vertical that direction has tan theta = 3/4, so theta = 37 degrees, tilted forward.",
    options: [
      {
        label: "A",
        text: "tan theta = 3/4",
        is_correct: true,
        misconception: null,
      },
      {
        label: "B",
        text: "tan theta = 4/3",
        is_correct: false,
        misconception: MISCONCEPTIONS["MIS-KIN-RELVEL"],
      },
      {
        label: "C",
        text: "theta = 0; the umbrella stays vertical",
        is_correct: false,
        misconception: MISCONCEPTIONS["MIS-KIN-RELVEL"],
      },
      {
        label: "D",
        text: "tan theta = 3/5",
        is_correct: false,
        misconception: null,
      },
    ],
  },
  923: {
    label: "D16",
    paper_id: 17,
    paper_name: "Mock 15 — Diagnostic",
    topic: "Hydrocarbons",
    subject: "Chemistry",
    difficulty: "easy",
    question_text:
      "Nitration of toluene with a HNO3/H2SO4 mixture gives predominantly:",
    solution:
      "-CH3 releases electron density by hyperconjugation and inductive effect, raising it most at the ortho and para positions, so the major products are o- and p-nitrotoluene.",
    options: [
      {
        label: "A",
        text: "No reaction under these conditions",
        is_correct: false,
        misconception: null,
      },
      {
        label: "B",
        text: "o- and p-nitrotoluene",
        is_correct: true,
        misconception: null,
      },
      {
        label: "C",
        text: "m-nitrotoluene",
        is_correct: false,
        misconception: MISCONCEPTIONS["MIS-ORG-EAS"],
      },
      {
        label: "D",
        text: "An equimolar mixture of all three isomers",
        is_correct: false,
        misconception: null,
      },
    ],
  },
  924: {
    label: "D17",
    paper_id: 17,
    paper_name: "Mock 15 — Diagnostic",
    topic: "Hydrocarbons",
    subject: "Chemistry",
    difficulty: "easy",
    question_text:
      "Nitration of nitrobenzene gives mainly:",
    solution:
      "-NO2 is strongly deactivating and withdraws density from the ortho and para positions in particular, leaving meta the least deactivated, so m-dinitrobenzene dominates.",
    options: [
      {
        label: "A",
        text: "o- and p-dinitrobenzene",
        is_correct: false,
        misconception: MISCONCEPTIONS["MIS-ORG-EAS"],
      },
      {
        label: "B",
        text: "1,3,5-trinitrobenzene",
        is_correct: false,
        misconception: null,
      },
      {
        label: "C",
        text: "p-dinitrobenzene only",
        is_correct: false,
        misconception: MISCONCEPTIONS["MIS-ORG-EAS"],
      },
      {
        label: "D",
        text: "m-dinitrobenzene",
        is_correct: true,
        misconception: null,
      },
    ],
  },
  925: {
    label: "D18",
    paper_id: 17,
    paper_name: "Mock 15 — Diagnostic",
    topic: "Organic Compounds Containing Oxygen",
    subject: "Chemistry",
    difficulty: "medium",
    question_text:
      "Bromination of phenol with bromine water gives:",
    solution:
      "-OH is strongly activating and ortho/para-directing. In aqueous medium the ring is activated enough for all three of those positions to react, giving 2,4,6-tribromophenol.",
    options: [
      {
        label: "A",
        text: "Bromobenzene",
        is_correct: false,
        misconception: null,
      },
      {
        label: "B",
        text: "3,5-dibromophenol",
        is_correct: false,
        misconception: MISCONCEPTIONS["MIS-ORG-EAS"],
      },
      {
        label: "C",
        text: "2,4,6-tribromophenol",
        is_correct: true,
        misconception: null,
      },
      {
        label: "D",
        text: "3-bromophenol",
        is_correct: false,
        misconception: MISCONCEPTIONS["MIS-ORG-EAS"],
      },
    ],
  },
  926: {
    label: "D19",
    paper_id: 17,
    paper_name: "Mock 15 — Diagnostic",
    topic: "Hydrocarbons",
    subject: "Chemistry",
    difficulty: "easy",
    question_text:
      "Which of the following substituents directs an incoming electrophile predominantly to the meta position?",
    solution:
      "-COOH withdraws electron density by resonance and induction, deactivating ortho and para most strongly, so substitution occurs at meta. The other three release density and are o/p-directing.",
    options: [
      {
        label: "A",
        text: "-NH2",
        is_correct: false,
        misconception: MISCONCEPTIONS["MIS-ORG-EAS"],
      },
      {
        label: "B",
        text: "-COOH",
        is_correct: true,
        misconception: null,
      },
      {
        label: "C",
        text: "-OCH3",
        is_correct: false,
        misconception: MISCONCEPTIONS["MIS-ORG-EAS"],
      },
      {
        label: "D",
        text: "-CH3",
        is_correct: false,
        misconception: MISCONCEPTIONS["MIS-ORG-EAS"],
      },
    ],
  },
  927: {
    label: "D20",
    paper_id: 17,
    paper_name: "Mock 15 — Diagnostic",
    topic: "Organic Compounds Containing Oxygen",
    subject: "Chemistry",
    difficulty: "medium",
    question_text:
      "Chlorination of anisole (methoxybenzene) occurs predominantly at:",
    solution:
      "-OCH3 donates a lone pair into the ring by resonance, raising electron density at ortho and para. Para dominates over ortho because the methoxy group blocks the neighbouring positions.",
    options: [
      {
        label: "A",
        text: "The para position",
        is_correct: true,
        misconception: null,
      },
      {
        label: "B",
        text: "The meta position",
        is_correct: false,
        misconception: MISCONCEPTIONS["MIS-ORG-EAS"],
      },
      {
        label: "C",
        text: "The carbon bearing the -OCH3 group",
        is_correct: false,
        misconception: null,
      },
      {
        label: "D",
        text: "The methyl carbon of the -OCH3 group",
        is_correct: false,
        misconception: null,
      },
    ],
  },
  928: {
    label: "D21",
    paper_id: 17,
    paper_name: "Mock 15 — Diagnostic",
    topic: "Organic Compounds Containing Halogens",
    subject: "Chemistry",
    difficulty: "hard",
    question_text:
      "Chlorobenzene is treated with fuming sulphuric acid. The major product is:",
    solution:
      "A halogen is deactivating by induction but ortho/para-directing by resonance, because its lone pair stabilises the arenium ion only for ortho and para attack. The reaction is slower than with benzene, but the product is para: 4-chlorobenzenesulphonic acid.",
    options: [
      {
        label: "A",
        text: "Benzenesulphonic acid, the chlorine being displaced",
        is_correct: false,
        misconception: null,
      },
      {
        label: "B",
        text: "No reaction, because chlorobenzene is deactivated",
        is_correct: false,
        misconception: null,
      },
      {
        label: "C",
        text: "3-chlorobenzenesulphonic acid",
        is_correct: false,
        misconception: MISCONCEPTIONS["MIS-ORG-EAS"],
      },
      {
        label: "D",
        text: "4-chlorobenzenesulphonic acid",
        is_correct: true,
        misconception: null,
      },
    ],
  },
  929: {
    label: "D22",
    paper_id: 17,
    paper_name: "Mock 15 — Diagnostic",
    topic: "Hydrocarbons",
    subject: "Chemistry",
    difficulty: "medium",
    question_text:
      "In benzenesulphonic acid the -SO3H group is strongly deactivating and meta-directing. Nitration of benzenesulphonic acid therefore gives mainly:",
    solution:
      "The directing behaviour is given, so the only step left is to place the nitro group at the meta position: 3-nitrobenzenesulphonic acid.",
    options: [
      {
        label: "A",
        text: "2,4-dinitrobenzenesulphonic acid",
        is_correct: false,
        misconception: null,
      },
      {
        label: "B",
        text: "4-nitrobenzenesulphonic acid",
        is_correct: false,
        misconception: null,
      },
      {
        label: "C",
        text: "3-nitrobenzenesulphonic acid",
        is_correct: true,
        misconception: null,
      },
      {
        label: "D",
        text: "Nitrobenzene, the -SO3H group being displaced",
        is_correct: false,
        misconception: null,
      },
    ],
  },
  931: {
    label: "D24",
    paper_id: 17,
    paper_name: "Mock 15 — Diagnostic",
    topic: "Hydrocarbons",
    subject: "Chemistry",
    difficulty: "easy",
    question_text:
      "HBr adds to propene in the absence of peroxide. The major product is:",
    solution:
      "The proton adds so as to give the more stable carbocation. Adding H to C-1 gives a secondary cation at C-2; adding it to C-2 would give a primary cation. So Br ends up on C-2: 2-bromopropane.",
    options: [
      {
        label: "A",
        text: "2-bromopropane",
        is_correct: true,
        misconception: null,
      },
      {
        label: "B",
        text: "1-bromopropane",
        is_correct: false,
        misconception: MISCONCEPTIONS["MIS-ORG-MARKOV"],
      },
      {
        label: "C",
        text: "1,2-dibromopropane",
        is_correct: false,
        misconception: null,
      },
      {
        label: "D",
        text: "Propan-2-ol",
        is_correct: false,
        misconception: null,
      },
    ],
  },
  932: {
    label: "D25",
    paper_id: 17,
    paper_name: "Mock 15 — Diagnostic",
    topic: "Hydrocarbons",
    subject: "Chemistry",
    difficulty: "medium",
    question_text:
      "HBr adds to propene in the presence of benzoyl peroxide. The major product is:",
    solution:
      "Peroxide switches the mechanism to free-radical addition. Br adds first, and it adds so as to give the more stable secondary radical, putting Br on C-1: anti-Markovnikov 1-bromopropane.",
    options: [
      {
        label: "A",
        text: "2-bromopropane",
        is_correct: false,
        misconception: MISCONCEPTIONS["MIS-ORG-MARKOV"],
      },
      {
        label: "B",
        text: "1-bromopropane",
        is_correct: true,
        misconception: null,
      },
      {
        label: "C",
        text: "Propane",
        is_correct: false,
        misconception: null,
      },
      {
        label: "D",
        text: "No reaction",
        is_correct: false,
        misconception: null,
      },
    ],
  },
  934: {
    label: "D27",
    paper_id: 17,
    paper_name: "Mock 15 — Diagnostic",
    topic: "Hydrocarbons",
    subject: "Chemistry",
    difficulty: "medium",
    question_text:
      "HBr adds to but-1-ene in the presence of benzoyl peroxide. The major product is:",
    solution:
      "The peroxide effect applies to HBr, so the addition is anti-Markovnikov and proceeds through the more stable secondary radical, giving 1-bromobutane.",
    options: [
      {
        label: "A",
        text: "1,2-dibromobutane",
        is_correct: false,
        misconception: null,
      },
      {
        label: "B",
        text: "2-bromobutane",
        is_correct: false,
        misconception: MISCONCEPTIONS["MIS-ORG-MARKOV"],
      },
      {
        label: "C",
        text: "Butan-2-ol",
        is_correct: false,
        misconception: null,
      },
      {
        label: "D",
        text: "1-bromobutane",
        is_correct: true,
        misconception: null,
      },
    ],
  },
  935: {
    label: "D28",
    paper_id: 17,
    paper_name: "Mock 15 — Diagnostic",
    topic: "Hydrocarbons",
    subject: "Chemistry",
    difficulty: "hard",
    question_text:
      "HBr adds to 3-methylbut-1-ene. The major product is:",
    solution:
      "H adds to C-1, giving a secondary cation at C-2. A 1,2-hydride shift from C-3 converts it to a tertiary cation, which is more stable, and Br is captured there: 2-bromo-2-methylbutane is the major product.",
    options: [
      {
        label: "A",
        text: "2-bromo-3-methylbutane",
        is_correct: false,
        misconception: MISCONCEPTIONS["MIS-ORG-STABILITY"],
      },
      {
        label: "B",
        text: "1-bromo-3-methylbutane",
        is_correct: false,
        misconception: MISCONCEPTIONS["MIS-ORG-MARKOV"],
      },
      {
        label: "C",
        text: "2-bromo-2-methylbutane",
        is_correct: true,
        misconception: null,
      },
      {
        label: "D",
        text: "2-bromopentane",
        is_correct: false,
        misconception: null,
      },
    ],
  },
  939: {
    label: "D32",
    paper_id: 17,
    paper_name: "Mock 15 — Diagnostic",
    topic: "Integral Calculus",
    subject: "Maths",
    difficulty: "easy",
    question_text:
      "The integral of cos(3x) with respect to x is:",
    solution:
      "Put u = 3x, so du = 3 dx and dx = du/3. The integral becomes (1/3) times the integral of cos u, i.e. (1/3)sin(3x) + C.",
    options: [
      {
        label: "A",
        text: "sin(3x) + C",
        is_correct: false,
        misconception: MISCONCEPTIONS["MIS-CALC-CHAIN"],
      },
      {
        label: "B",
        text: "(1/3)sin(3x) + C",
        is_correct: true,
        misconception: null,
      },
      {
        label: "C",
        text: "3sin(3x) + C",
        is_correct: false,
        misconception: MISCONCEPTIONS["MIS-CALC-CHAIN"],
      },
      {
        label: "D",
        text: "-(1/3)sin(3x) + C",
        is_correct: false,
        misconception: null,
      },
    ],
  },
  940: {
    label: "D33",
    paper_id: 17,
    paper_name: "Mock 15 — Diagnostic",
    topic: "Limits, Continuity and Differentiability",
    subject: "Maths",
    difficulty: "easy",
    question_text:
      "d/dx of sin(x^2) is:",
    solution:
      "Chain rule: the derivative of the outer function is cos(x^2), multiplied by the derivative of the inner function, 2x.",
    options: [
      {
        label: "A",
        text: "-2x cos(x^2)",
        is_correct: false,
        misconception: null,
      },
      {
        label: "B",
        text: "2x sin(x^2)",
        is_correct: false,
        misconception: null,
      },
      {
        label: "C",
        text: "cos(x^2)",
        is_correct: false,
        misconception: MISCONCEPTIONS["MIS-CALC-CHAIN"],
      },
      {
        label: "D",
        text: "2x cos(x^2)",
        is_correct: true,
        misconception: null,
      },
    ],
  },
  941: {
    label: "D34",
    paper_id: 17,
    paper_name: "Mock 15 — Diagnostic",
    topic: "Integral Calculus",
    subject: "Maths",
    difficulty: "easy",
    question_text:
      "The integral of e^(5x) with respect to x is:",
    solution:
      "With u = 5x, du = 5 dx, so the integral is (1/5)e^(5x) + C. The factor 1/5 is the reciprocal of the inner derivative.",
    options: [
      {
        label: "A",
        text: "5e^(5x) + C",
        is_correct: false,
        misconception: MISCONCEPTIONS["MIS-CALC-CHAIN"],
      },
      {
        label: "B",
        text: "e^(5x) + C",
        is_correct: false,
        misconception: MISCONCEPTIONS["MIS-CALC-CHAIN"],
      },
      {
        label: "C",
        text: "e^(5x)/x + C",
        is_correct: false,
        misconception: null,
      },
      {
        label: "D",
        text: "(1/5)e^(5x) + C",
        is_correct: true,
        misconception: null,
      },
    ],
  },
  942: {
    label: "D35",
    paper_id: 17,
    paper_name: "Mock 15 — Diagnostic",
    topic: "Limits, Continuity and Differentiability",
    subject: "Maths",
    difficulty: "easy",
    question_text:
      "d/dx of ln(2x + 1) is:",
    solution:
      "The derivative of ln(u) is u'/u. Here u = 2x + 1 and u' = 2, so the answer is 2/(2x + 1).",
    options: [
      {
        label: "A",
        text: "2/(2x + 1)",
        is_correct: true,
        misconception: null,
      },
      {
        label: "B",
        text: "2 ln(2x + 1)",
        is_correct: false,
        misconception: null,
      },
      {
        label: "C",
        text: "1/(2x)",
        is_correct: false,
        misconception: null,
      },
      {
        label: "D",
        text: "1/(2x + 1)",
        is_correct: false,
        misconception: MISCONCEPTIONS["MIS-CALC-CHAIN"],
      },
    ],
  },
  943: {
    label: "D36",
    paper_id: 17,
    paper_name: "Mock 15 — Diagnostic",
    topic: "Integral Calculus",
    subject: "Maths",
    difficulty: "medium",
    question_text:
      "The integral of sin(2x + 5) with respect to x is:",
    solution:
      "With u = 2x + 5, du = 2 dx, the integral is -(1/2)cos(2x + 5) + C.",
    options: [
      {
        label: "A",
        text: "-cos(2x + 5) + C",
        is_correct: false,
        misconception: MISCONCEPTIONS["MIS-CALC-CHAIN"],
      },
      {
        label: "B",
        text: "-2cos(2x + 5) + C",
        is_correct: false,
        misconception: MISCONCEPTIONS["MIS-CALC-CHAIN"],
      },
      {
        label: "C",
        text: "(1/2)cos(2x + 5) + C",
        is_correct: false,
        misconception: null,
      },
      {
        label: "D",
        text: "-(1/2)cos(2x + 5) + C",
        is_correct: true,
        misconception: null,
      },
    ],
  },
  944: {
    label: "D37",
    paper_id: 17,
    paper_name: "Mock 15 — Diagnostic",
    topic: "Limits, Continuity and Differentiability",
    subject: "Maths",
    difficulty: "medium",
    question_text:
      "d/dx of (3x + 2)^4 is:",
    solution:
      "Power rule on the outer function gives 4(3x + 2)^3, multiplied by the derivative of the inner function, 3, giving 12(3x + 2)^3.",
    options: [
      {
        label: "A",
        text: "12(3x + 2)^4",
        is_correct: false,
        misconception: null,
      },
      {
        label: "B",
        text: "12(3x + 2)^3",
        is_correct: true,
        misconception: null,
      },
      {
        label: "C",
        text: "3(3x + 2)^3",
        is_correct: false,
        misconception: null,
      },
      {
        label: "D",
        text: "4(3x + 2)^3",
        is_correct: false,
        misconception: MISCONCEPTIONS["MIS-CALC-CHAIN"],
      },
    ],
  },
};

const ATTEMPTS: Record<number, Record<number, StoredAttempt>> = {
  909: {
    2: { chosen_label: "C", status: "wrong", marks: -1.0, time_spent: 85 },
    4: { chosen_label: "A", status: "wrong", marks: -1.0, time_spent: 104 },
  },
  910: {
    4: { chosen_label: "C", status: "wrong", marks: -1.0, time_spent: 107 },
  },
  911: {
    4: { chosen_label: "D", status: "wrong", marks: -1.0, time_spent: 71 },
  },
  912: {
    4: { chosen_label: "A", status: "wrong", marks: -1.0, time_spent: 96 },
    5: { chosen_label: "B", status: "wrong", marks: -1.0, time_spent: 132 },
  },
  913: {
    4: { chosen_label: "D", status: "wrong", marks: -1.0, time_spent: 86 },
  },
  914: {
    2: { chosen_label: "B", status: "wrong", marks: -1.0, time_spent: 110 },
  },
  922: {
    5: { chosen_label: "C", status: "wrong", marks: -1.0, time_spent: 133 },
  },
  923: {
    1: { chosen_label: "C", status: "wrong", marks: -1.0, time_spent: 158 },
  },
  924: {
    1: { chosen_label: "C", status: "wrong", marks: -1.0, time_spent: 134 },
  },
  925: {
    1: { chosen_label: "D", status: "wrong", marks: -1.0, time_spent: 127 },
  },
  926: {
    1: { chosen_label: "B", status: "correct", marks: 4.0, time_spent: 83 },
  },
  927: {
    1: { chosen_label: "B", status: "wrong", marks: -1.0, time_spent: 111 },
  },
  928: {
    1: { chosen_label: "C", status: "wrong", marks: -1.0, time_spent: 147 },
  },
  929: {
    1: { chosen_label: "C", status: "correct", marks: 4.0, time_spent: 38 },
  },
  931: {
    2: { chosen_label: "B", status: "wrong", marks: -1.0, time_spent: 156 },
    5: { chosen_label: "B", status: "wrong", marks: -1.0, time_spent: 126 },
  },
  932: {
    2: { chosen_label: "A", status: "wrong", marks: -1.0, time_spent: 126 },
  },
  934: {
    2: { chosen_label: "B", status: "wrong", marks: -1.0, time_spent: 118 },
  },
  935: {
    2: { chosen_label: "B", status: "wrong", marks: -1.0, time_spent: 99 },
  },
  939: {
    5: { chosen_label: "A", status: "wrong", marks: -1.0, time_spent: 20 },
  },
  940: {
    5: { chosen_label: "C", status: "wrong", marks: -1.0, time_spent: 122 },
  },
  941: {
    2: { chosen_label: "A", status: "wrong", marks: -1.0, time_spent: 139 },
  },
  942: {
    5: { chosen_label: "D", status: "wrong", marks: -1.0, time_spent: 30 },
  },
  943: {
    5: { chosen_label: "B", status: "wrong", marks: -1.0, time_spent: 100 },
  },
  944: {
    5: { chosen_label: "D", status: "wrong", marks: -1.0, time_spent: 93 },
  },
};

/**
 * One question, composed exactly as the live endpoint composes it.
 *
 * The three states, and why a mock that collapses them is worse than no mock:
 *
 *   1. **No `?student=`** — `student_id`, `chosen_label`, `status`, `marks` and
 *      `time_spent` are all null, and `options[].chosen` is null **on every
 *      option**. Null is "not asked". A mock that sent `false` here would let a
 *      client render a question where the student appears to have answered
 *      nothing, and the bug would only surface against the real server.
 *   2. **`?student=` given, no attempt on file** — `student_id` echoes back,
 *      `options[].chosen` is **`false`** on every option, and the four
 *      per-question fields are still null. Verified against the live server
 *      with a student who did not sit this paper. So `chosen: false` and
 *      `status: null` disagree on purpose, and `student_id` is the only field
 *      that tells the two questions apart.
 *   3. **`?student=` given, attempt on file** — one option carries
 *      `chosen: true` and the four fields are populated.
 *
 * A student from another institute is a 404 on the whole question rather than a
 * 200 with null fields, and the handler reproduces that too.
 */
export function questionFor(
  questionId: number,
  studentId?: number,
): QuestionDetail | null {
  const seed = QUESTIONS[questionId];
  if (!seed) return null;

  const attempt =
    studentId === undefined ? undefined : ATTEMPTS[questionId]?.[studentId];

  const options: QuestionOption[] = seed.options.map((option) => ({
    label: option.label,
    text: option.text,
    is_correct: option.is_correct,
    // null when no student was named; false when one was and this is not the
    // option they picked — including when they picked nothing at all.
    chosen:
      studentId === undefined
        ? null
        : attempt?.chosen_label === option.label,
    misconception: option.misconception,
  }));

  return {
    id: questionId,
    label: seed.label,
    paper_id: seed.paper_id,
    paper_name: seed.paper_name,
    topic: seed.topic,
    subject: seed.subject,
    difficulty: seed.difficulty,
    question_text: seed.question_text,
    solution: seed.solution,
    options,
    student_id: studentId ?? null,
    chosen_label: attempt?.chosen_label ?? null,
    status: attempt?.status ?? null,
    marks: attempt?.marks ?? null,
    time_spent: attempt?.time_spent ?? null,
  };
}

/** Whether the mock holds this question at all — the handler's 404 test. */
export function hasQuestion(questionId: number): boolean {
  return questionId in QUESTIONS;
}

/**
 * The students the mock holds, for the endpoint's *other* 404.
 *
 * `?student=` naming someone outside the institute is a 404 on the whole
 * question, not a 200 with the per-student fields null. The handler needs a set
 * to check against, and the roster is the one the diagnosis fixtures use.
 */
export const KNOWN_STUDENTS = new Set(
  Object.values(ATTEMPTS).flatMap((byStudent) => Object.keys(byStudent).map(Number)),
);
