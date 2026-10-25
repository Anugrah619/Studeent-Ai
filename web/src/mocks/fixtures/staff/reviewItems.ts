import type { KeyDisagreement } from "@/api/types";

/**
 * `GET /api/review/disagreements/?status=unreviewed`, five rows in the exact
 * shape the live server sends — ids, labels, subjects, answer types, keys,
 * the model's answers and the figure flag match the real queue.
 *
 * The question texts, options, working and notes are **written for the
 * demo**, not copied: the real ones are exam content, and exam content stays
 * out of this repository because it is publicly readable (`data/README.md`).
 * Each keeps the *kind* of disagreement its real row has — a model using the
 * wrong method, a figure question, a model whose working agrees with the key
 * but whose label does not, an algebra slip, and our own transcription error
 * — so every state of the review screen is still exercised.
 */
export const REVIEW_ITEMS: KeyDisagreement[] = [
  {
    "id": 1030,
    "paper_id": 19,
    "paper_name": "NEET-style demo paper",
    "label": "Q2",
    "subject": "Physics",
    "answer_type": "mcq",
    "question_text": "A ball is thrown vertically upwards at $20\\text{ m/s}$ from the top of a tower $25\\text{ m}$ high. Taking $g = 10\\text{ m/s}^2$, the time after which it reaches the ground is",
    "options": [
      {
        "label": "1",
        "text": "$2.2\\text{ s}$",
        "is_correct": false
      },
      {
        "label": "2",
        "text": "$5\\text{ s}$",
        "is_correct": true
      },
      {
        "label": "3",
        "text": "$4\\text{ s}$",
        "is_correct": false
      },
      {
        "label": "4",
        "text": "$1\\text{ s}$",
        "is_correct": false
      }
    ],
    "official_answer": "2",
    "model_answer": "3",
    "has_diagram": false,
    "verification": "disagreed",
    "detail_summary": "Model answered 3 (medium confidence); official key 2. Agent's first look (not a human review): The model stopped when the ball came back to the top of the tower (2u/g = 4 s) and left out the 25 m below it. −25 = 20t − 5t² gives t = 5 s = official option 2.",
    "model_working": "The ball goes up and comes back down. Time of flight $t = 2u/g = 2 \\times 20 / 10 = 4\\text{ s}$. So the answer is 4 s.",
    "review": {
      "status": "unreviewed",
      "note": "",
      "reviewed_by": null,
      "reviewed_at": null
    }
  },
  {
    "id": 1034,
    "paper_id": 19,
    "paper_name": "NEET-style demo paper",
    "label": "Q6",
    "subject": "Physics",
    "answer_type": "mcq",
    "question_text": "In the circuit shown, the current drawn from the $6\\text{ V}$ battery is: [Figure]",
    "options": [
      {
        "label": "1",
        "text": "$1.0\\text{ A}$",
        "is_correct": false
      },
      {
        "label": "2",
        "text": "$0.5\\text{ A}$",
        "is_correct": true
      },
      {
        "label": "3",
        "text": "$2.0\\text{ A}$",
        "is_correct": false
      },
      {
        "label": "4",
        "text": "$1.5\\text{ A}$",
        "is_correct": false
      }
    ],
    "official_answer": "2",
    "model_answer": "4",
    "has_diagram": true,
    "verification": "disagreed",
    "detail_summary": "Model answered 4 (medium confidence); official key 2. Has a figure. Agent's first look (not a human review): Figure question. The bridge is balanced (4/8 = 2/4), so it reduces to 4 Ω, as the model found, but the figure also has an 8 Ω resistor in series with the battery, which it left out: I = 6/(4 + 8) = 0.5 A = official option 2.",
    "model_working": "The four bridge resistors reduce to $(4 + 8) \\parallel (2 + 4) = 12 \\times 6 / 18 = 4\\ \\Omega$. So $I = V/R = 6/4 = 1.5\\text{ A}$.",
    "review": {
      "status": "unreviewed",
      "note": "",
      "reviewed_by": null,
      "reviewed_at": null
    }
  },
  {
    "id": 1160,
    "paper_id": 19,
    "paper_name": "NEET-style demo paper",
    "label": "Q132",
    "subject": "Botany",
    "answer_type": "mcq",
    "question_text": "Arrange these events in the life of a flowering plant in the order in which they happen, earliest first.\nA. Pollination\nB. Seed germination\nC. Fertilisation\nD. Fruit formation\nE. Flowering\nChoose the correct answer from the options given below:",
    "options": [
      {
        "label": "1",
        "text": "E, A, B, C, D",
        "is_correct": false
      },
      {
        "label": "2",
        "text": "B, E, A, C, D",
        "is_correct": true
      },
      {
        "label": "3",
        "text": "E, B, A, D, C",
        "is_correct": false
      },
      {
        "label": "4",
        "text": "B, A, E, C, D",
        "is_correct": false
      }
    ],
    "official_answer": "2",
    "model_answer": "4",
    "has_diagram": false,
    "verification": "disagreed",
    "detail_summary": "Model answered 4 (high confidence); official key 2. Agent's first look (not a human review): Model slip: its own working gives B, E, A, C, D, which is option 2 = official key, but it labelled the answer 4.",
    "model_working": "A seed germinates first (B), the plant grows and flowers (E), pollen reaches the stigma (A), fertilisation follows (C), and the ovary becomes the fruit (D): B, E, A, C, D.",
    "review": {
      "status": "unreviewed",
      "note": "",
      "reviewed_by": null,
      "reviewed_at": null
    }
  },
  {
    "id": 954,
    "paper_id": 18,
    "paper_name": "JEE-style demo paper",
    "label": "Q1",
    "subject": "Mathematics",
    "answer_type": "mcq",
    "question_text": "The roots $\\alpha$ and $\\beta$ of $x^2 - 6x + c = 0$ satisfy $\\alpha - \\beta = 2$. Then $c + \\alpha + \\beta$ is equal to :",
    "options": [
      {
        "label": "1",
        "text": "$12$",
        "is_correct": false
      },
      {
        "label": "2",
        "text": "$13$",
        "is_correct": false
      },
      {
        "label": "3",
        "text": "$14$",
        "is_correct": true
      },
      {
        "label": "4",
        "text": "$16$",
        "is_correct": false
      }
    ],
    "official_answer": "3",
    "model_answer": "1",
    "has_diagram": false,
    "verification": "disagreed",
    "detail_summary": "Model answered 1 (high confidence); official key 3. Agent's first look (not a human review): Model's arithmetic slip. It found c = 8 correctly, then added α (4) instead of α + β (6): 8 + 6 = 14 = official option 3.",
    "model_working": "Sum of roots $\\alpha + \\beta = 6$ and $\\alpha - \\beta = 2$, so $\\alpha = 4$, $\\beta = 2$ and $c = \\alpha\\beta = 8$. Then $c + \\alpha = 8 + 4 = 12$.",
    "review": {
      "status": "unreviewed",
      "note": "",
      "reviewed_by": null,
      "reviewed_at": null
    }
  },
  {
    "id": 974,
    "paper_id": 18,
    "paper_name": "JEE-style demo paper",
    "label": "Q21",
    "subject": "Mathematics",
    "answer_type": "numerical",
    "question_text": "If the domain of the function $f(x) = \\sqrt{\\log_{0.5}\\left(\\frac{x-1}{5}\\right)}$ is $(a, b]$, then $a + b$ is equal to __________.",
    "options": [],
    "official_answer": "4",
    "model_answer": "7",
    "has_diagram": false,
    "verification": "disagreed",
    "detail_summary": "Model answered 7 (medium confidence); official key 4. Agent's first look (not a human review): TRANSCRIPTION ERROR, not a model or key error. The paper prints (x − 1)/2; the stored text reads the 2 as a 5. With /2 the domain is (1, 3], so a + b = 4 = official key.",
    "model_working": "We need $\\log_{0.5}\\left(\\frac{x-1}{5}\\right) \\ge 0$, so $0 < \\frac{x-1}{5} \\le 1$, that is $1 < x \\le 6$. So $a = 1$, $b = 6$ and $a + b = 7$.",
    "review": {
      "status": "unreviewed",
      "note": "",
      "reviewed_by": null,
      "reviewed_at": null
    }
  }
];
