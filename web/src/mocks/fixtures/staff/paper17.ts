import type { PaperQuestions } from "@/api/types";

/**
 * `GET /api/papers/17/questions/` for "Mock 15 — Diagnostic", transcribed
 * verbatim from the live server: all 46 questions, their text, solutions,
 * options and the tags on them. The mock's tagging store starts from this, so
 * the screen opens in mock mode on exactly what the live API serves.
 */
export const PAPER_17: PaperQuestions = {
  "paper_id": 17,
  "paper_name": "Mock 15 — Diagnostic",
  "paper_source": "demo",
  "held_on": "2026-09-20",
  "summary": {
    "questions": 46,
    "with_text": 46,
    "wrong_options": 138,
    "wrong_options_tagged": 63,
    "wrong_options_with_draft": 0
  },
  "questions": [
    {
      "id": 908,
      "label": "D01",
      "topic": "Rotational Motion",
      "topic_id": 7,
      "subject": "Physics",
      "answer_type": "mcq",
      "correct_option": "C",
      "official_answer": "",
      "question_text": "A uniform rod of mass M and length L rotates about an axis through one end, perpendicular to its length. Its moment of inertia is:",
      "solution": "About the centre of mass I = ML^2/12. The axis is a distance L/2 away, so the parallel-axis theorem adds M(L/2)^2 = ML^2/4, giving ML^2/12 + ML^2/4 = ML^2/3.",
      "difficulty": "easy",
      "verification": "",
      "has_answers": true,
      "options": [
        {
          "label": "A",
          "text": "ML^2/12",
          "is_correct": false,
          "misconception": {
            "code": "MIS-ROT-AXIS",
            "name": "Wrong axis of rotation"
          },
          "draft_misconception": null
        },
        {
          "label": "B",
          "text": "ML^2",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "C",
          "text": "ML^2/3",
          "is_correct": true,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "D",
          "text": "ML^2/2",
          "is_correct": false,
          "misconception": {
            "code": "MIS-ROT-SHAPE",
            "name": "Wrong body's formula"
          },
          "draft_misconception": null
        }
      ]
    },
    {
      "id": 909,
      "label": "D02",
      "topic": "Rotational Motion",
      "topic_id": 7,
      "subject": "Physics",
      "answer_type": "mcq",
      "correct_option": "B",
      "official_answer": "",
      "question_text": "A uniform disc of mass M and radius R rotates about one of its diameters. Its moment of inertia is:",
      "solution": "About the central axis perpendicular to the plane, I = MR^2/2. By the perpendicular-axis theorem that equals the sum of the two in-plane diameters, which are equal, so each is MR^2/4.",
      "difficulty": "medium",
      "verification": "",
      "has_answers": true,
      "options": [
        {
          "label": "A",
          "text": "MR^2/2",
          "is_correct": false,
          "misconception": {
            "code": "MIS-ROT-AXIS",
            "name": "Wrong axis of rotation"
          },
          "draft_misconception": null
        },
        {
          "label": "B",
          "text": "MR^2/4",
          "is_correct": true,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "C",
          "text": "MR^2",
          "is_correct": false,
          "misconception": {
            "code": "MIS-ROT-SHAPE",
            "name": "Wrong body's formula"
          },
          "draft_misconception": null
        },
        {
          "label": "D",
          "text": "2MR^2/5",
          "is_correct": false,
          "misconception": {
            "code": "MIS-ROT-SHAPE",
            "name": "Wrong body's formula"
          },
          "draft_misconception": null
        }
      ]
    },
    {
      "id": 910,
      "label": "D03",
      "topic": "Rotational Motion",
      "topic_id": 7,
      "subject": "Physics",
      "answer_type": "mcq",
      "correct_option": "B",
      "official_answer": "",
      "question_text": "A solid sphere of mass M and radius R rotates about a tangent to its surface. Its moment of inertia is:",
      "solution": "About a diameter I = 2MR^2/5. A tangent is parallel to a diameter at distance R, so add MR^2: 2MR^2/5 + MR^2 = 7MR^2/5.",
      "difficulty": "hard",
      "verification": "",
      "has_answers": true,
      "options": [
        {
          "label": "A",
          "text": "3MR^2/2",
          "is_correct": false,
          "misconception": {
            "code": "MIS-ROT-SHAPE",
            "name": "Wrong body's formula"
          },
          "draft_misconception": null
        },
        {
          "label": "B",
          "text": "7MR^2/5",
          "is_correct": true,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "C",
          "text": "2MR^2/5",
          "is_correct": false,
          "misconception": {
            "code": "MIS-ROT-AXIS",
            "name": "Wrong axis of rotation"
          },
          "draft_misconception": null
        },
        {
          "label": "D",
          "text": "5MR^2/3",
          "is_correct": false,
          "misconception": {
            "code": "MIS-ROT-SHAPE",
            "name": "Wrong body's formula"
          },
          "draft_misconception": null
        }
      ]
    },
    {
      "id": 911,
      "label": "D04",
      "topic": "Rotational Motion",
      "topic_id": 7,
      "subject": "Physics",
      "answer_type": "mcq",
      "correct_option": "C",
      "official_answer": "",
      "question_text": "A uniform rod of mass M and length L rotates about an axis perpendicular to the rod through a point L/4 from one end. Its moment of inertia is:",
      "solution": "The centre of mass is at L/2, so the axis is d = L/4 from it. I = ML^2/12 + M(L/4)^2 = ML^2/12 + ML^2/16 = 7ML^2/48.",
      "difficulty": "hard",
      "verification": "",
      "has_answers": true,
      "options": [
        {
          "label": "A",
          "text": "ML^2/16",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "B",
          "text": "ML^2/12",
          "is_correct": false,
          "misconception": {
            "code": "MIS-ROT-AXIS",
            "name": "Wrong axis of rotation"
          },
          "draft_misconception": null
        },
        {
          "label": "C",
          "text": "7ML^2/48",
          "is_correct": true,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "D",
          "text": "ML^2/3",
          "is_correct": false,
          "misconception": {
            "code": "MIS-ROT-AXIS",
            "name": "Wrong axis of rotation"
          },
          "draft_misconception": null
        }
      ]
    },
    {
      "id": 912,
      "label": "D05",
      "topic": "Rotational Motion",
      "topic_id": 7,
      "subject": "Physics",
      "answer_type": "mcq",
      "correct_option": "D",
      "official_answer": "",
      "question_text": "A thin circular ring of mass M and radius R rotates about a tangent lying in the plane of the ring. Its moment of inertia is:",
      "solution": "About a diameter I = MR^2/2. The tangent in the plane is parallel to a diameter at distance R, so add MR^2, giving 3MR^2/2.",
      "difficulty": "medium",
      "verification": "",
      "has_answers": true,
      "options": [
        {
          "label": "A",
          "text": "2MR^2",
          "is_correct": false,
          "misconception": {
            "code": "MIS-ROT-AXIS",
            "name": "Wrong axis of rotation"
          },
          "draft_misconception": null
        },
        {
          "label": "B",
          "text": "MR^2/4",
          "is_correct": false,
          "misconception": {
            "code": "MIS-ROT-SHAPE",
            "name": "Wrong body's formula"
          },
          "draft_misconception": null
        },
        {
          "label": "C",
          "text": "MR^2/2",
          "is_correct": false,
          "misconception": {
            "code": "MIS-ROT-AXIS",
            "name": "Wrong axis of rotation"
          },
          "draft_misconception": null
        },
        {
          "label": "D",
          "text": "3MR^2/2",
          "is_correct": true,
          "misconception": null,
          "draft_misconception": null
        }
      ]
    },
    {
      "id": 913,
      "label": "D06",
      "topic": "Rotational Motion",
      "topic_id": 7,
      "subject": "Physics",
      "answer_type": "mcq",
      "correct_option": "B",
      "official_answer": "",
      "question_text": "A uniform rod of mass M and length L carries a small bead, also of mass M, fixed at one end. The system rotates about an axis through the other end, perpendicular to the rod. Its moment of inertia is:",
      "solution": "The rod about its end contributes ML^2/3. The bead is a point mass at distance L, contributing ML^2. Total = ML^2/3 + ML^2 = 4ML^2/3.",
      "difficulty": "hard",
      "verification": "",
      "has_answers": true,
      "options": [
        {
          "label": "A",
          "text": "ML^2/3",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "B",
          "text": "4ML^2/3",
          "is_correct": true,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "C",
          "text": "2ML^2",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "D",
          "text": "13ML^2/12",
          "is_correct": false,
          "misconception": {
            "code": "MIS-ROT-AXIS",
            "name": "Wrong axis of rotation"
          },
          "draft_misconception": null
        }
      ]
    },
    {
      "id": 914,
      "label": "D07",
      "topic": "Rotational Motion",
      "topic_id": 7,
      "subject": "Physics",
      "answer_type": "mcq",
      "correct_option": "D",
      "official_answer": "",
      "question_text": "A uniform disc of mass M and radius R rotates about the axis through its centre, perpendicular to its plane. Its moment of inertia is:",
      "solution": "This is the standard central axis for a disc, so no shift of axis is involved: I = MR^2/2.",
      "difficulty": "easy",
      "verification": "",
      "has_answers": true,
      "options": [
        {
          "label": "A",
          "text": "2MR^2/5",
          "is_correct": false,
          "misconception": {
            "code": "MIS-ROT-SHAPE",
            "name": "Wrong body's formula"
          },
          "draft_misconception": null
        },
        {
          "label": "B",
          "text": "MR^2",
          "is_correct": false,
          "misconception": {
            "code": "MIS-ROT-SHAPE",
            "name": "Wrong body's formula"
          },
          "draft_misconception": null
        },
        {
          "label": "C",
          "text": "3MR^2/2",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "D",
          "text": "MR^2/2",
          "is_correct": true,
          "misconception": null,
          "draft_misconception": null
        }
      ]
    },
    {
      "id": 915,
      "label": "D08",
      "topic": "Rotational Motion",
      "topic_id": 7,
      "subject": "Physics",
      "answer_type": "mcq",
      "correct_option": "B",
      "official_answer": "",
      "question_text": "The moment of inertia of a uniform rod of mass M and length L about an axis through its centre of mass, perpendicular to its length, is ML^2/12. Using the parallel-axis theorem, its moment of inertia about a parallel axis a distance L/3 from the centre of mass is:",
      "solution": "I = I_cm + Md^2 = ML^2/12 + M(L/3)^2 = 3ML^2/36 + 4ML^2/36 = 7ML^2/36. Both the centre-of-mass value and the theorem are given, so the only work left is the arithmetic.",
      "difficulty": "easy",
      "verification": "",
      "has_answers": true,
      "options": [
        {
          "label": "A",
          "text": "13ML^2/36",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "B",
          "text": "7ML^2/36",
          "is_correct": true,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "C",
          "text": "ML^2/9",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "D",
          "text": "7ML^2/12",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        }
      ]
    },
    {
      "id": 916,
      "label": "D09",
      "topic": "Rotational Motion",
      "topic_id": 7,
      "subject": "Physics",
      "answer_type": "mcq",
      "correct_option": "C",
      "official_answer": "",
      "question_text": "Four bodies each of mass M and radius R rotate about the axis named. Which has the largest moment of inertia?",
      "solution": "Ring about its central perpendicular axis MR^2; hollow sphere about a diameter 2MR^2/3; solid cylinder about its own axis MR^2/2; solid sphere about a diameter 2MR^2/5. 1 > 2/3 > 1/2 > 2/5, so the ring is largest.",
      "difficulty": "medium",
      "verification": "",
      "has_answers": true,
      "options": [
        {
          "label": "A",
          "text": "A solid cylinder about its own axis",
          "is_correct": false,
          "misconception": {
            "code": "MIS-ROT-SHAPE",
            "name": "Wrong body's formula"
          },
          "draft_misconception": null
        },
        {
          "label": "B",
          "text": "A solid sphere about a diameter",
          "is_correct": false,
          "misconception": {
            "code": "MIS-ROT-SHAPE",
            "name": "Wrong body's formula"
          },
          "draft_misconception": null
        },
        {
          "label": "C",
          "text": "A thin ring about its central axis, perpendicular to its plane",
          "is_correct": true,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "D",
          "text": "A hollow sphere about a diameter",
          "is_correct": false,
          "misconception": {
            "code": "MIS-ROT-SHAPE",
            "name": "Wrong body's formula"
          },
          "draft_misconception": null
        }
      ]
    },
    {
      "id": 917,
      "label": "D10",
      "topic": "Electrostatics",
      "topic_id": 17,
      "subject": "Physics",
      "answer_type": "mcq",
      "correct_option": "B",
      "official_answer": "",
      "question_text": "A proton is released from rest in a uniform electric field E that points along the +x direction. The proton:",
      "solution": "F = qE with q positive, so the force is along E, i.e. along +x, and the proton accelerates in that direction, gaining kinetic energy as it moves to lower potential.",
      "difficulty": "easy",
      "verification": "",
      "has_answers": true,
      "options": [
        {
          "label": "A",
          "text": "remains at rest, since the field does no work on it",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "B",
          "text": "accelerates along +x, gaining kinetic energy",
          "is_correct": true,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "C",
          "text": "accelerates along -x, gaining kinetic energy",
          "is_correct": false,
          "misconception": {
            "code": "MIS-SIGN-FIELD",
            "name": "Field and force directions signed wrongly"
          },
          "draft_misconception": null
        },
        {
          "label": "D",
          "text": "moves perpendicular to E",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        }
      ]
    },
    {
      "id": 918,
      "label": "D11",
      "topic": "Electrostatics",
      "topic_id": 17,
      "subject": "Physics",
      "answer_type": "mcq",
      "correct_option": "D",
      "official_answer": "",
      "question_text": "A negative charge is moved from a point at higher electric potential to a point at lower electric potential. Its electric potential energy:",
      "solution": "U = qV, so dU = q dV. Here dV is negative and q is negative, so dU is positive: the potential energy increases.",
      "difficulty": "medium",
      "verification": "",
      "has_answers": true,
      "options": [
        {
          "label": "A",
          "text": "is unchanged, because only potential difference matters",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "B",
          "text": "decreases",
          "is_correct": false,
          "misconception": {
            "code": "MIS-SIGN-FIELD",
            "name": "Field and force directions signed wrongly"
          },
          "draft_misconception": null
        },
        {
          "label": "C",
          "text": "becomes zero",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "D",
          "text": "increases",
          "is_correct": true,
          "misconception": null,
          "draft_misconception": null
        }
      ]
    },
    {
      "id": 919,
      "label": "D12",
      "topic": "Magnetic Effects of Current and Magnetism",
      "topic_id": 19,
      "subject": "Physics",
      "answer_type": "mcq",
      "correct_option": "C",
      "official_answer": "",
      "question_text": "A positive charge moves with velocity v along the +x direction in a uniform magnetic field B directed along +y. The magnetic force on the charge is directed along:",
      "solution": "F = q(v x B). With v along +x and B along +y, x-hat cross y-hat is z-hat, and q is positive, so F is along +z, of magnitude qvB.",
      "difficulty": "medium",
      "verification": "",
      "has_answers": true,
      "options": [
        {
          "label": "A",
          "text": "+y",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "B",
          "text": "-z",
          "is_correct": false,
          "misconception": {
            "code": "MIS-SIGN-FIELD",
            "name": "Field and force directions signed wrongly"
          },
          "draft_misconception": null
        },
        {
          "label": "C",
          "text": "+z",
          "is_correct": true,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "D",
          "text": "the force is zero",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        }
      ]
    },
    {
      "id": 920,
      "label": "D13",
      "topic": "Kinematics",
      "topic_id": 4,
      "subject": "Physics",
      "answer_type": "mcq",
      "correct_option": "A",
      "official_answer": "",
      "question_text": "A car covers the first half of a journey at 40 km/h and the second half at 60 km/h. Its average speed for the whole journey is:",
      "solution": "The two halves are equal in distance, not in time, so the average is the harmonic mean: 2(40)(60)/(40 + 60) = 4800/100 = 48 km/h.",
      "difficulty": "easy",
      "verification": "",
      "has_answers": true,
      "options": [
        {
          "label": "A",
          "text": "48 km/h",
          "is_correct": true,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "B",
          "text": "100 km/h",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "C",
          "text": "52 km/h",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "D",
          "text": "50 km/h",
          "is_correct": false,
          "misconception": {
            "code": "MIS-KIN-AVG",
            "name": "Average and instantaneous treated as the same"
          },
          "draft_misconception": null
        }
      ]
    },
    {
      "id": 921,
      "label": "D14",
      "topic": "Kinematics",
      "topic_id": 4,
      "subject": "Physics",
      "answer_type": "mcq",
      "correct_option": "B",
      "official_answer": "",
      "question_text": "A particle moves along a straight line with x = 3t^2, where x is in metres and t in seconds. Its velocity at t = 2 s is:",
      "solution": "v = dx/dt = 6t, so v(2) = 12 m/s. The value 6 m/s is x/t, the average velocity over the first two seconds, which is a different quantity.",
      "difficulty": "easy",
      "verification": "",
      "has_answers": true,
      "options": [
        {
          "label": "A",
          "text": "3 m/s",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "B",
          "text": "12 m/s",
          "is_correct": true,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "C",
          "text": "6 m/s",
          "is_correct": false,
          "misconception": {
            "code": "MIS-KIN-AVG",
            "name": "Average and instantaneous treated as the same"
          },
          "draft_misconception": null
        },
        {
          "label": "D",
          "text": "24 m/s",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        }
      ]
    },
    {
      "id": 922,
      "label": "D15",
      "topic": "Kinematics",
      "topic_id": 4,
      "subject": "Physics",
      "answer_type": "mcq",
      "correct_option": "A",
      "official_answer": "",
      "question_text": "Rain is falling vertically downwards at 4 m/s. A man runs horizontally at 3 m/s. He must hold his umbrella tilted forward from the vertical at an angle theta, where:",
      "solution": "In the man's frame the rain's velocity is v(rain) - v(man), with components (-3, -4). Measured from the vertical that direction has tan theta = 3/4, so theta = 37 degrees, tilted forward.",
      "difficulty": "medium",
      "verification": "",
      "has_answers": true,
      "options": [
        {
          "label": "A",
          "text": "tan theta = 3/4",
          "is_correct": true,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "B",
          "text": "tan theta = 4/3",
          "is_correct": false,
          "misconception": {
            "code": "MIS-KIN-RELVEL",
            "name": "Relative motion computed in the wrong frame"
          },
          "draft_misconception": null
        },
        {
          "label": "C",
          "text": "theta = 0; the umbrella stays vertical",
          "is_correct": false,
          "misconception": {
            "code": "MIS-KIN-RELVEL",
            "name": "Relative motion computed in the wrong frame"
          },
          "draft_misconception": null
        },
        {
          "label": "D",
          "text": "tan theta = 3/5",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        }
      ]
    },
    {
      "id": 923,
      "label": "D16",
      "topic": "Hydrocarbons",
      "topic_id": 46,
      "subject": "Chemistry",
      "answer_type": "mcq",
      "correct_option": "B",
      "official_answer": "",
      "question_text": "Nitration of toluene with a HNO3/H2SO4 mixture gives predominantly:",
      "solution": "-CH3 releases electron density by hyperconjugation and inductive effect, raising it most at the ortho and para positions, so the major products are o- and p-nitrotoluene.",
      "difficulty": "easy",
      "verification": "",
      "has_answers": true,
      "options": [
        {
          "label": "A",
          "text": "No reaction under these conditions",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "B",
          "text": "o- and p-nitrotoluene",
          "is_correct": true,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "C",
          "text": "m-nitrotoluene",
          "is_correct": false,
          "misconception": {
            "code": "MIS-ORG-EAS",
            "name": "Directing effects reversed"
          },
          "draft_misconception": null
        },
        {
          "label": "D",
          "text": "An equimolar mixture of all three isomers",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        }
      ]
    },
    {
      "id": 924,
      "label": "D17",
      "topic": "Hydrocarbons",
      "topic_id": 46,
      "subject": "Chemistry",
      "answer_type": "mcq",
      "correct_option": "D",
      "official_answer": "",
      "question_text": "Nitration of nitrobenzene gives mainly:",
      "solution": "-NO2 is strongly deactivating and withdraws density from the ortho and para positions in particular, leaving meta the least deactivated, so m-dinitrobenzene dominates.",
      "difficulty": "easy",
      "verification": "",
      "has_answers": true,
      "options": [
        {
          "label": "A",
          "text": "o- and p-dinitrobenzene",
          "is_correct": false,
          "misconception": {
            "code": "MIS-ORG-EAS",
            "name": "Directing effects reversed"
          },
          "draft_misconception": null
        },
        {
          "label": "B",
          "text": "1,3,5-trinitrobenzene",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "C",
          "text": "p-dinitrobenzene only",
          "is_correct": false,
          "misconception": {
            "code": "MIS-ORG-EAS",
            "name": "Directing effects reversed"
          },
          "draft_misconception": null
        },
        {
          "label": "D",
          "text": "m-dinitrobenzene",
          "is_correct": true,
          "misconception": null,
          "draft_misconception": null
        }
      ]
    },
    {
      "id": 925,
      "label": "D18",
      "topic": "Organic Compounds Containing Oxygen",
      "topic_id": 48,
      "subject": "Chemistry",
      "answer_type": "mcq",
      "correct_option": "C",
      "official_answer": "",
      "question_text": "Bromination of phenol with bromine water gives:",
      "solution": "-OH is strongly activating and ortho/para-directing. In aqueous medium the ring is activated enough for all three of those positions to react, giving 2,4,6-tribromophenol.",
      "difficulty": "medium",
      "verification": "",
      "has_answers": true,
      "options": [
        {
          "label": "A",
          "text": "Bromobenzene",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "B",
          "text": "3,5-dibromophenol",
          "is_correct": false,
          "misconception": {
            "code": "MIS-ORG-EAS",
            "name": "Directing effects reversed"
          },
          "draft_misconception": null
        },
        {
          "label": "C",
          "text": "2,4,6-tribromophenol",
          "is_correct": true,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "D",
          "text": "3-bromophenol",
          "is_correct": false,
          "misconception": {
            "code": "MIS-ORG-EAS",
            "name": "Directing effects reversed"
          },
          "draft_misconception": null
        }
      ]
    },
    {
      "id": 926,
      "label": "D19",
      "topic": "Hydrocarbons",
      "topic_id": 46,
      "subject": "Chemistry",
      "answer_type": "mcq",
      "correct_option": "B",
      "official_answer": "",
      "question_text": "Which of the following substituents directs an incoming electrophile predominantly to the meta position?",
      "solution": "-COOH withdraws electron density by resonance and induction, deactivating ortho and para most strongly, so substitution occurs at meta. The other three release density and are o/p-directing.",
      "difficulty": "easy",
      "verification": "",
      "has_answers": true,
      "options": [
        {
          "label": "A",
          "text": "-NH2",
          "is_correct": false,
          "misconception": {
            "code": "MIS-ORG-EAS",
            "name": "Directing effects reversed"
          },
          "draft_misconception": null
        },
        {
          "label": "B",
          "text": "-COOH",
          "is_correct": true,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "C",
          "text": "-OCH3",
          "is_correct": false,
          "misconception": {
            "code": "MIS-ORG-EAS",
            "name": "Directing effects reversed"
          },
          "draft_misconception": null
        },
        {
          "label": "D",
          "text": "-CH3",
          "is_correct": false,
          "misconception": {
            "code": "MIS-ORG-EAS",
            "name": "Directing effects reversed"
          },
          "draft_misconception": null
        }
      ]
    },
    {
      "id": 927,
      "label": "D20",
      "topic": "Organic Compounds Containing Oxygen",
      "topic_id": 48,
      "subject": "Chemistry",
      "answer_type": "mcq",
      "correct_option": "A",
      "official_answer": "",
      "question_text": "Chlorination of anisole (methoxybenzene) occurs predominantly at:",
      "solution": "-OCH3 donates a lone pair into the ring by resonance, raising electron density at ortho and para. Para dominates over ortho because the methoxy group blocks the neighbouring positions.",
      "difficulty": "medium",
      "verification": "",
      "has_answers": true,
      "options": [
        {
          "label": "A",
          "text": "The para position",
          "is_correct": true,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "B",
          "text": "The meta position",
          "is_correct": false,
          "misconception": {
            "code": "MIS-ORG-EAS",
            "name": "Directing effects reversed"
          },
          "draft_misconception": null
        },
        {
          "label": "C",
          "text": "The carbon bearing the -OCH3 group",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "D",
          "text": "The methyl carbon of the -OCH3 group",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        }
      ]
    },
    {
      "id": 928,
      "label": "D21",
      "topic": "Organic Compounds Containing Halogens",
      "topic_id": 47,
      "subject": "Chemistry",
      "answer_type": "mcq",
      "correct_option": "D",
      "official_answer": "",
      "question_text": "Chlorobenzene is treated with fuming sulphuric acid. The major product is:",
      "solution": "A halogen is deactivating by induction but ortho/para-directing by resonance, because its lone pair stabilises the arenium ion only for ortho and para attack. The reaction is slower than with benzene, but the product is para: 4-chlorobenzenesulphonic acid.",
      "difficulty": "hard",
      "verification": "",
      "has_answers": true,
      "options": [
        {
          "label": "A",
          "text": "Benzenesulphonic acid, the chlorine being displaced",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "B",
          "text": "No reaction, because chlorobenzene is deactivated",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "C",
          "text": "3-chlorobenzenesulphonic acid",
          "is_correct": false,
          "misconception": {
            "code": "MIS-ORG-EAS",
            "name": "Directing effects reversed"
          },
          "draft_misconception": null
        },
        {
          "label": "D",
          "text": "4-chlorobenzenesulphonic acid",
          "is_correct": true,
          "misconception": null,
          "draft_misconception": null
        }
      ]
    },
    {
      "id": 929,
      "label": "D22",
      "topic": "Hydrocarbons",
      "topic_id": 46,
      "subject": "Chemistry",
      "answer_type": "mcq",
      "correct_option": "C",
      "official_answer": "",
      "question_text": "In benzenesulphonic acid the -SO3H group is strongly deactivating and meta-directing. Nitration of benzenesulphonic acid therefore gives mainly:",
      "solution": "The directing behaviour is given, so the only step left is to place the nitro group at the meta position: 3-nitrobenzenesulphonic acid.",
      "difficulty": "medium",
      "verification": "",
      "has_answers": true,
      "options": [
        {
          "label": "A",
          "text": "2,4-dinitrobenzenesulphonic acid",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "B",
          "text": "4-nitrobenzenesulphonic acid",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "C",
          "text": "3-nitrobenzenesulphonic acid",
          "is_correct": true,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "D",
          "text": "Nitrobenzene, the -SO3H group being displaced",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        }
      ]
    },
    {
      "id": 930,
      "label": "D23",
      "topic": "Organic Compounds Containing Oxygen",
      "topic_id": 48,
      "subject": "Chemistry",
      "answer_type": "mcq",
      "correct_option": "A",
      "official_answer": "",
      "question_text": "The -OH group of phenol is strongly activating and directs incoming electrophiles to the ortho and para positions. Nitration of phenol with dilute nitric acid at 298 K therefore gives:",
      "solution": "With the directing behaviour given and the conditions mild, the products are the mononitrated ortho and para isomers: 2-nitrophenol and 4-nitrophenol. Concentrated nitric acid would be needed to reach 2,4,6-trinitrophenol.",
      "difficulty": "easy",
      "verification": "",
      "has_answers": true,
      "options": [
        {
          "label": "A",
          "text": "A mixture of 2-nitrophenol and 4-nitrophenol",
          "is_correct": true,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "B",
          "text": "Nitrobenzene",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "C",
          "text": "Benzene-1,2-diol",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "D",
          "text": "2,4,6-trinitrophenol",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        }
      ]
    },
    {
      "id": 931,
      "label": "D24",
      "topic": "Hydrocarbons",
      "topic_id": 46,
      "subject": "Chemistry",
      "answer_type": "mcq",
      "correct_option": "A",
      "official_answer": "",
      "question_text": "HBr adds to propene in the absence of peroxide. The major product is:",
      "solution": "The proton adds so as to give the more stable carbocation. Adding H to C-1 gives a secondary cation at C-2; adding it to C-2 would give a primary cation. So Br ends up on C-2: 2-bromopropane.",
      "difficulty": "easy",
      "verification": "",
      "has_answers": true,
      "options": [
        {
          "label": "A",
          "text": "2-bromopropane",
          "is_correct": true,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "B",
          "text": "1-bromopropane",
          "is_correct": false,
          "misconception": {
            "code": "MIS-ORG-MARKOV",
            "name": "Markovnikov rule misapplied"
          },
          "draft_misconception": null
        },
        {
          "label": "C",
          "text": "1,2-dibromopropane",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "D",
          "text": "Propan-2-ol",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        }
      ]
    },
    {
      "id": 932,
      "label": "D25",
      "topic": "Hydrocarbons",
      "topic_id": 46,
      "subject": "Chemistry",
      "answer_type": "mcq",
      "correct_option": "B",
      "official_answer": "",
      "question_text": "HBr adds to propene in the presence of benzoyl peroxide. The major product is:",
      "solution": "Peroxide switches the mechanism to free-radical addition. Br adds first, and it adds so as to give the more stable secondary radical, putting Br on C-1: anti-Markovnikov 1-bromopropane.",
      "difficulty": "medium",
      "verification": "",
      "has_answers": true,
      "options": [
        {
          "label": "A",
          "text": "2-bromopropane",
          "is_correct": false,
          "misconception": {
            "code": "MIS-ORG-MARKOV",
            "name": "Markovnikov rule misapplied"
          },
          "draft_misconception": null
        },
        {
          "label": "B",
          "text": "1-bromopropane",
          "is_correct": true,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "C",
          "text": "Propane",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "D",
          "text": "No reaction",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        }
      ]
    },
    {
      "id": 933,
      "label": "D26",
      "topic": "Hydrocarbons",
      "topic_id": 46,
      "subject": "Chemistry",
      "answer_type": "mcq",
      "correct_option": "A",
      "official_answer": "",
      "question_text": "HBr adds to 2-methylpropene. The major product is:",
      "solution": "Adding H to the terminal CH2 gives a tertiary carbocation, which is far more stable than the primary alternative, so Br ends up on the central carbon: 2-bromo-2-methylpropane.",
      "difficulty": "easy",
      "verification": "",
      "has_answers": true,
      "options": [
        {
          "label": "A",
          "text": "2-bromo-2-methylpropane",
          "is_correct": true,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "B",
          "text": "2-bromobutane",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "C",
          "text": "1,2-dibromo-2-methylpropane",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "D",
          "text": "1-bromo-2-methylpropane",
          "is_correct": false,
          "misconception": {
            "code": "MIS-ORG-MARKOV",
            "name": "Markovnikov rule misapplied"
          },
          "draft_misconception": null
        }
      ]
    },
    {
      "id": 934,
      "label": "D27",
      "topic": "Hydrocarbons",
      "topic_id": 46,
      "subject": "Chemistry",
      "answer_type": "mcq",
      "correct_option": "D",
      "official_answer": "",
      "question_text": "HBr adds to but-1-ene in the presence of benzoyl peroxide. The major product is:",
      "solution": "The peroxide effect applies to HBr, so the addition is anti-Markovnikov and proceeds through the more stable secondary radical, giving 1-bromobutane.",
      "difficulty": "medium",
      "verification": "",
      "has_answers": true,
      "options": [
        {
          "label": "A",
          "text": "1,2-dibromobutane",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "B",
          "text": "2-bromobutane",
          "is_correct": false,
          "misconception": {
            "code": "MIS-ORG-MARKOV",
            "name": "Markovnikov rule misapplied"
          },
          "draft_misconception": null
        },
        {
          "label": "C",
          "text": "Butan-2-ol",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "D",
          "text": "1-bromobutane",
          "is_correct": true,
          "misconception": null,
          "draft_misconception": null
        }
      ]
    },
    {
      "id": 935,
      "label": "D28",
      "topic": "Hydrocarbons",
      "topic_id": 46,
      "subject": "Chemistry",
      "answer_type": "mcq",
      "correct_option": "C",
      "official_answer": "",
      "question_text": "HBr adds to 3-methylbut-1-ene. The major product is:",
      "solution": "H adds to C-1, giving a secondary cation at C-2. A 1,2-hydride shift from C-3 converts it to a tertiary cation, which is more stable, and Br is captured there: 2-bromo-2-methylbutane is the major product.",
      "difficulty": "hard",
      "verification": "",
      "has_answers": true,
      "options": [
        {
          "label": "A",
          "text": "2-bromo-3-methylbutane",
          "is_correct": false,
          "misconception": {
            "code": "MIS-ORG-STABILITY",
            "name": "Carbocation stability order wrong"
          },
          "draft_misconception": null
        },
        {
          "label": "B",
          "text": "1-bromo-3-methylbutane",
          "is_correct": false,
          "misconception": {
            "code": "MIS-ORG-MARKOV",
            "name": "Markovnikov rule misapplied"
          },
          "draft_misconception": null
        },
        {
          "label": "C",
          "text": "2-bromo-2-methylbutane",
          "is_correct": true,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "D",
          "text": "2-bromopentane",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        }
      ]
    },
    {
      "id": 936,
      "label": "D29",
      "topic": "Hydrocarbons",
      "topic_id": 46,
      "subject": "Chemistry",
      "answer_type": "mcq",
      "correct_option": "B",
      "official_answer": "",
      "question_text": "HBr adds to but-2-ene. The major product is:",
      "solution": "But-2-ene is symmetric about the double bond: whichever carbon the proton adds to, a secondary cation forms and Br ends up on C-2. The product is 2-bromobutane either way, so the regiochemistry question does not arise.",
      "difficulty": "medium",
      "verification": "",
      "has_answers": true,
      "options": [
        {
          "label": "A",
          "text": "2,3-dibromobutane",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "B",
          "text": "2-bromobutane",
          "is_correct": true,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "C",
          "text": "Butan-2-ol",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "D",
          "text": "1-bromobutane",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        }
      ]
    },
    {
      "id": 937,
      "label": "D30",
      "topic": "Chemical Bonding and Molecular Structure",
      "topic_id": 32,
      "subject": "Chemistry",
      "answer_type": "mcq",
      "correct_option": "B",
      "official_answer": "",
      "question_text": "For propenal, CH2=CH-CHO, the number of sigma bonds, the number of pi bonds, and the hybridisation of the carbonyl carbon are:",
      "solution": "Every bond between two atoms contains one sigma: four C-H, two C-C and one C-O, so seven sigma. The extras in the two double bonds give two pi. The carbonyl carbon has three sigma bonds and no lone pair, steric number 3, so it is sp2.",
      "difficulty": "medium",
      "verification": "",
      "has_answers": true,
      "options": [
        {
          "label": "A",
          "text": "9 sigma, 2 pi; carbonyl carbon sp2",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "B",
          "text": "7 sigma, 2 pi; carbonyl carbon sp2",
          "is_correct": true,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "C",
          "text": "7 sigma, 2 pi; carbonyl carbon sp3",
          "is_correct": false,
          "misconception": {
            "code": "MIS-BOND-HYBRID",
            "name": "Hybridisation read off the formula"
          },
          "draft_misconception": null
        },
        {
          "label": "D",
          "text": "5 sigma, 2 pi; carbonyl carbon sp2",
          "is_correct": false,
          "misconception": {
            "code": "MIS-BOND-COUNT",
            "name": "sigma and pi bonds miscounted"
          },
          "draft_misconception": null
        }
      ]
    },
    {
      "id": 938,
      "label": "D31",
      "topic": "Equilibrium",
      "topic_id": 35,
      "subject": "Chemistry",
      "answer_type": "mcq",
      "correct_option": "B",
      "official_answer": "",
      "question_text": "A catalyst is added to a gaseous reaction that has already reached equilibrium, at constant temperature. Which statement is correct?",
      "solution": "A catalyst lowers the activation energy of the forward and reverse steps by the same amount, so both rate constants rise by the same factor. K is their ratio, so K and the equilibrium composition are unchanged; equilibrium is simply reached sooner.",
      "difficulty": "easy",
      "verification": "",
      "has_answers": true,
      "options": [
        {
          "label": "A",
          "text": "The equilibrium shifts towards the products and the yield increases",
          "is_correct": false,
          "misconception": {
            "code": "MIS-EQM-CATALYST",
            "name": "Catalyst believed to shift equilibrium"
          },
          "draft_misconception": null
        },
        {
          "label": "B",
          "text": "Both rates increase by the same factor; the equilibrium composition is unchanged",
          "is_correct": true,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "C",
          "text": "The value of Kc increases",
          "is_correct": false,
          "misconception": {
            "code": "MIS-EQM-CATALYST",
            "name": "Catalyst believed to shift equilibrium"
          },
          "draft_misconception": null
        },
        {
          "label": "D",
          "text": "Equilibrium is reached more slowly",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        }
      ]
    },
    {
      "id": 939,
      "label": "D32",
      "topic": "Integral Calculus",
      "topic_id": 61,
      "subject": "Maths",
      "answer_type": "mcq",
      "correct_option": "B",
      "official_answer": "",
      "question_text": "The integral of cos(3x) with respect to x is:",
      "solution": "Put u = 3x, so du = 3 dx and dx = du/3. The integral becomes (1/3) times the integral of cos u, i.e. (1/3)sin(3x) + C.",
      "difficulty": "easy",
      "verification": "",
      "has_answers": true,
      "options": [
        {
          "label": "A",
          "text": "sin(3x) + C",
          "is_correct": false,
          "misconception": {
            "code": "MIS-CALC-CHAIN",
            "name": "Chain rule inner derivative dropped"
          },
          "draft_misconception": null
        },
        {
          "label": "B",
          "text": "(1/3)sin(3x) + C",
          "is_correct": true,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "C",
          "text": "3sin(3x) + C",
          "is_correct": false,
          "misconception": {
            "code": "MIS-CALC-CHAIN",
            "name": "Chain rule inner derivative dropped"
          },
          "draft_misconception": null
        },
        {
          "label": "D",
          "text": "-(1/3)sin(3x) + C",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        }
      ]
    },
    {
      "id": 940,
      "label": "D33",
      "topic": "Limits, Continuity and Differentiability",
      "topic_id": 60,
      "subject": "Maths",
      "answer_type": "mcq",
      "correct_option": "D",
      "official_answer": "",
      "question_text": "d/dx of sin(x^2) is:",
      "solution": "Chain rule: the derivative of the outer function is cos(x^2), multiplied by the derivative of the inner function, 2x.",
      "difficulty": "easy",
      "verification": "",
      "has_answers": true,
      "options": [
        {
          "label": "A",
          "text": "-2x cos(x^2)",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "B",
          "text": "2x sin(x^2)",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "C",
          "text": "cos(x^2)",
          "is_correct": false,
          "misconception": {
            "code": "MIS-CALC-CHAIN",
            "name": "Chain rule inner derivative dropped"
          },
          "draft_misconception": null
        },
        {
          "label": "D",
          "text": "2x cos(x^2)",
          "is_correct": true,
          "misconception": null,
          "draft_misconception": null
        }
      ]
    },
    {
      "id": 941,
      "label": "D34",
      "topic": "Integral Calculus",
      "topic_id": 61,
      "subject": "Maths",
      "answer_type": "mcq",
      "correct_option": "D",
      "official_answer": "",
      "question_text": "The integral of e^(5x) with respect to x is:",
      "solution": "With u = 5x, du = 5 dx, so the integral is (1/5)e^(5x) + C. The factor 1/5 is the reciprocal of the inner derivative.",
      "difficulty": "easy",
      "verification": "",
      "has_answers": true,
      "options": [
        {
          "label": "A",
          "text": "5e^(5x) + C",
          "is_correct": false,
          "misconception": {
            "code": "MIS-CALC-CHAIN",
            "name": "Chain rule inner derivative dropped"
          },
          "draft_misconception": null
        },
        {
          "label": "B",
          "text": "e^(5x) + C",
          "is_correct": false,
          "misconception": {
            "code": "MIS-CALC-CHAIN",
            "name": "Chain rule inner derivative dropped"
          },
          "draft_misconception": null
        },
        {
          "label": "C",
          "text": "e^(5x)/x + C",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "D",
          "text": "(1/5)e^(5x) + C",
          "is_correct": true,
          "misconception": null,
          "draft_misconception": null
        }
      ]
    },
    {
      "id": 942,
      "label": "D35",
      "topic": "Limits, Continuity and Differentiability",
      "topic_id": 60,
      "subject": "Maths",
      "answer_type": "mcq",
      "correct_option": "A",
      "official_answer": "",
      "question_text": "d/dx of ln(2x + 1) is:",
      "solution": "The derivative of ln(u) is u'/u. Here u = 2x + 1 and u' = 2, so the answer is 2/(2x + 1).",
      "difficulty": "easy",
      "verification": "",
      "has_answers": true,
      "options": [
        {
          "label": "A",
          "text": "2/(2x + 1)",
          "is_correct": true,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "B",
          "text": "2 ln(2x + 1)",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "C",
          "text": "1/(2x)",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "D",
          "text": "1/(2x + 1)",
          "is_correct": false,
          "misconception": {
            "code": "MIS-CALC-CHAIN",
            "name": "Chain rule inner derivative dropped"
          },
          "draft_misconception": null
        }
      ]
    },
    {
      "id": 943,
      "label": "D36",
      "topic": "Integral Calculus",
      "topic_id": 61,
      "subject": "Maths",
      "answer_type": "mcq",
      "correct_option": "D",
      "official_answer": "",
      "question_text": "The integral of sin(2x + 5) with respect to x is:",
      "solution": "With u = 2x + 5, du = 2 dx, the integral is -(1/2)cos(2x + 5) + C.",
      "difficulty": "medium",
      "verification": "",
      "has_answers": true,
      "options": [
        {
          "label": "A",
          "text": "-cos(2x + 5) + C",
          "is_correct": false,
          "misconception": {
            "code": "MIS-CALC-CHAIN",
            "name": "Chain rule inner derivative dropped"
          },
          "draft_misconception": null
        },
        {
          "label": "B",
          "text": "-2cos(2x + 5) + C",
          "is_correct": false,
          "misconception": {
            "code": "MIS-CALC-CHAIN",
            "name": "Chain rule inner derivative dropped"
          },
          "draft_misconception": null
        },
        {
          "label": "C",
          "text": "(1/2)cos(2x + 5) + C",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "D",
          "text": "-(1/2)cos(2x + 5) + C",
          "is_correct": true,
          "misconception": null,
          "draft_misconception": null
        }
      ]
    },
    {
      "id": 944,
      "label": "D37",
      "topic": "Limits, Continuity and Differentiability",
      "topic_id": 60,
      "subject": "Maths",
      "answer_type": "mcq",
      "correct_option": "B",
      "official_answer": "",
      "question_text": "d/dx of (3x + 2)^4 is:",
      "solution": "Power rule on the outer function gives 4(3x + 2)^3, multiplied by the derivative of the inner function, 3, giving 12(3x + 2)^3.",
      "difficulty": "medium",
      "verification": "",
      "has_answers": true,
      "options": [
        {
          "label": "A",
          "text": "12(3x + 2)^4",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "B",
          "text": "12(3x + 2)^3",
          "is_correct": true,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "C",
          "text": "3(3x + 2)^3",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "D",
          "text": "4(3x + 2)^3",
          "is_correct": false,
          "misconception": {
            "code": "MIS-CALC-CHAIN",
            "name": "Chain rule inner derivative dropped"
          },
          "draft_misconception": null
        }
      ]
    },
    {
      "id": 945,
      "label": "D38",
      "topic": "Limits, Continuity and Differentiability",
      "topic_id": 60,
      "subject": "Maths",
      "answer_type": "mcq",
      "correct_option": "B",
      "official_answer": "",
      "question_text": "d/dx of x^2 sin x is:",
      "solution": "Product rule: (x^2)' sin x + x^2 (sin x)' = 2x sin x + x^2 cos x. There is no composite function here, so no chain factor arises.",
      "difficulty": "medium",
      "verification": "",
      "has_answers": true,
      "options": [
        {
          "label": "A",
          "text": "x^2 cos x",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "B",
          "text": "2x sin x + x^2 cos x",
          "is_correct": true,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "C",
          "text": "2x sin x",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "D",
          "text": "2x cos x",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        }
      ]
    },
    {
      "id": 946,
      "label": "D39",
      "topic": "Integral Calculus",
      "topic_id": 61,
      "subject": "Maths",
      "answer_type": "mcq",
      "correct_option": "C",
      "official_answer": "",
      "question_text": "Using the substitution u = x^2 + 1, for which du = 2x dx, the integral of 2x(x^2 + 1)^5 with respect to x is:",
      "solution": "The factor 2x in the integrand is exactly du, so the integral becomes the integral of u^5 du = u^6/6, that is (x^2 + 1)^6/6 + C. The inner derivative is already present, so there is no factor to supply or to lose.",
      "difficulty": "medium",
      "verification": "",
      "has_answers": true,
      "options": [
        {
          "label": "A",
          "text": "(x^2 + 1)^6 + C",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "B",
          "text": "2x(x^2 + 1)^6/6 + C",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "C",
          "text": "(x^2 + 1)^6/6 + C",
          "is_correct": true,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "D",
          "text": "(x^2 + 1)^6/12 + C",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        }
      ]
    },
    {
      "id": 947,
      "label": "D40",
      "topic": "Complex Numbers and Quadratic Equations",
      "topic_id": 54,
      "subject": "Maths",
      "answer_type": "mcq",
      "correct_option": "D",
      "official_answer": "",
      "question_text": "The number of real solutions of root(x + 3) = x + 1 is:",
      "solution": "Squaring gives x + 3 = x^2 + 2x + 1, so x^2 + x - 2 = 0 and x = 1 or x = -2. Substituting back: x = 1 gives 2 = 2, which holds; x = -2 gives 1 = -1, which does not. Squaring introduced that root, so there is exactly one solution.",
      "difficulty": "medium",
      "verification": "",
      "has_answers": true,
      "options": [
        {
          "label": "A",
          "text": "0",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "B",
          "text": "Infinitely many",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "C",
          "text": "2",
          "is_correct": false,
          "misconception": {
            "code": "MIS-ALG-SQUARE",
            "name": "Roots kept after squaring"
          },
          "draft_misconception": null
        },
        {
          "label": "D",
          "text": "1",
          "is_correct": true,
          "misconception": null,
          "draft_misconception": null
        }
      ]
    },
    {
      "id": 948,
      "label": "D41",
      "topic": "Complex Numbers and Quadratic Equations",
      "topic_id": 54,
      "subject": "Maths",
      "answer_type": "mcq",
      "correct_option": "D",
      "official_answer": "",
      "question_text": "The solution set of root(2x + 9) = x + 3 is:",
      "solution": "Squaring gives 2x + 9 = x^2 + 6x + 9, so x^2 + 4x = 0 and x = 0 or x = -4. Checking: x = 0 gives 3 = 3, which holds; x = -4 gives 1 = -1, which does not. The solution set is {0}.",
      "difficulty": "medium",
      "verification": "",
      "has_answers": true,
      "options": [
        {
          "label": "A",
          "text": "{-4}",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "B",
          "text": "The empty set",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "C",
          "text": "{0, -4}",
          "is_correct": false,
          "misconception": {
            "code": "MIS-ALG-SQUARE",
            "name": "Roots kept after squaring"
          },
          "draft_misconception": null
        },
        {
          "label": "D",
          "text": "{0}",
          "is_correct": true,
          "misconception": null,
          "draft_misconception": null
        }
      ]
    },
    {
      "id": 949,
      "label": "D42",
      "topic": "Trigonometry",
      "topic_id": 71,
      "subject": "Maths",
      "answer_type": "mcq",
      "correct_option": "A",
      "official_answer": "",
      "question_text": "The number of solutions of sin x + cos x = 1 in the interval [0, 2pi) is:",
      "solution": "Squaring gives 1 + sin 2x = 1, so sin 2x = 0 and x = 0, pi/2, pi or 3pi/2. Substituting back into the original equation, x = pi gives -1 and x = 3pi/2 gives -1, so both are extraneous. Only x = 0 and x = pi/2 satisfy it: two solutions.",
      "difficulty": "medium",
      "verification": "",
      "has_answers": true,
      "options": [
        {
          "label": "A",
          "text": "2",
          "is_correct": true,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "B",
          "text": "1",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "C",
          "text": "4",
          "is_correct": false,
          "misconception": {
            "code": "MIS-ALG-SQUARE",
            "name": "Roots kept after squaring"
          },
          "draft_misconception": null
        },
        {
          "label": "D",
          "text": "0",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        }
      ]
    },
    {
      "id": 950,
      "label": "D43",
      "topic": "Trigonometry",
      "topic_id": 71,
      "subject": "Maths",
      "answer_type": "mcq",
      "correct_option": "C",
      "official_answer": "",
      "question_text": "The value of sin-inverse( sin(3pi/4) ) is:",
      "solution": "sin(3pi/4) = 1/root2. The principal range of sin-inverse is [-pi/2, pi/2], and 3pi/4 lies outside it, so the answer is the angle inside that range with the same sine: pi/4.",
      "difficulty": "medium",
      "verification": "",
      "has_answers": true,
      "options": [
        {
          "label": "A",
          "text": "pi/2",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "B",
          "text": "3pi/4",
          "is_correct": false,
          "misconception": {
            "code": "MIS-TRIG-DOMAIN",
            "name": "Inverse-trig range and domain ignored"
          },
          "draft_misconception": null
        },
        {
          "label": "C",
          "text": "pi/4",
          "is_correct": true,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "D",
          "text": "-pi/4",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        }
      ]
    },
    {
      "id": 951,
      "label": "D44",
      "topic": "Trigonometry",
      "topic_id": 71,
      "subject": "Maths",
      "answer_type": "mcq",
      "correct_option": "C",
      "official_answer": "",
      "question_text": "The domain of f(x) = cos-inverse(2x - 1) is:",
      "solution": "cos-inverse is defined only on [-1, 1], so the requirement is -1 <= 2x - 1 <= 1, giving 0 <= 2x <= 2 and hence 0 <= x <= 1.",
      "difficulty": "easy",
      "verification": "",
      "has_answers": true,
      "options": [
        {
          "label": "A",
          "text": "All real x",
          "is_correct": false,
          "misconception": {
            "code": "MIS-TRIG-DOMAIN",
            "name": "Inverse-trig range and domain ignored"
          },
          "draft_misconception": null
        },
        {
          "label": "B",
          "text": "[-1, 1]",
          "is_correct": false,
          "misconception": {
            "code": "MIS-TRIG-DOMAIN",
            "name": "Inverse-trig range and domain ignored"
          },
          "draft_misconception": null
        },
        {
          "label": "C",
          "text": "[0, 1]",
          "is_correct": true,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "D",
          "text": "[-1, 0]",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        }
      ]
    },
    {
      "id": 952,
      "label": "D45",
      "topic": "Complex Numbers and Quadratic Equations",
      "topic_id": 54,
      "subject": "Maths",
      "answer_type": "mcq",
      "correct_option": "D",
      "official_answer": "",
      "question_text": "The number of solutions of |x - 1| + |x - 3| = 2 is:",
      "solution": "Split at the critical points 1 and 3. For x < 1 the equation gives x = 1, outside that interval. For x > 3 it gives x = 3, outside that interval. For 1 <= x <= 3 it reduces to 2 = 2, true throughout. The solution set is the whole interval [1, 3], so there are infinitely many solutions.",
      "difficulty": "medium",
      "verification": "",
      "has_answers": true,
      "options": [
        {
          "label": "A",
          "text": "None",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "B",
          "text": "One",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "C",
          "text": "Two",
          "is_correct": false,
          "misconception": {
            "code": "MIS-ALG-MODULUS",
            "name": "Modulus sign cases dropped"
          },
          "draft_misconception": null
        },
        {
          "label": "D",
          "text": "Infinitely many: every x in [1, 3]",
          "is_correct": true,
          "misconception": null,
          "draft_misconception": null
        }
      ]
    },
    {
      "id": 953,
      "label": "D46",
      "topic": "Sets, Relations and Functions",
      "topic_id": 53,
      "subject": "Maths",
      "answer_type": "mcq",
      "correct_option": "D",
      "official_answer": "",
      "question_text": "For all real x, root((x - 3)^2) equals:",
      "solution": "The square root sign denotes the non-negative root, so root(a^2) = |a| for every real a. Here that is |x - 3|, which equals x - 3 only when x >= 3.",
      "difficulty": "easy",
      "verification": "",
      "has_answers": true,
      "options": [
        {
          "label": "A",
          "text": "x - 3",
          "is_correct": false,
          "misconception": {
            "code": "MIS-ALG-MODULUS",
            "name": "Modulus sign cases dropped"
          },
          "draft_misconception": null
        },
        {
          "label": "B",
          "text": "3 - x",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "C",
          "text": "plus or minus (x - 3)",
          "is_correct": false,
          "misconception": null,
          "draft_misconception": null
        },
        {
          "label": "D",
          "text": "|x - 3|",
          "is_correct": true,
          "misconception": null,
          "draft_misconception": null
        }
      ]
    }
  ]
};
