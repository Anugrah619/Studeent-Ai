"""Demo question bank with misconception-tagged distractors.

Hand-written JEE-style questions covering the chapters our hero students
are weak in. Forty-six questions — a full-length short diagnostic, not a
sample — because a director reading "Mock 15" expects a paper, and because
a signature needs enough trials to be visibly different from luck.

Every wrong option names the specific wrong belief that produces it. That
tagging is what turns "Aarav is weak at Organic Chemistry" — which his
teacher already knows and can't act on — into "Aarav treats every
substituent as meta-directing", which is a one-afternoon fix.

Two design rules the bank is built around
-----------------------------------------
1. **Bait.** For each misconception there are five or six questions whose
   distractor list contains the option that belief produces. Five trials is
   the minimum at which an 80%-90% hit rate separates cleanly from a
   cohort baseline of ~15% (exact binomial p < 0.005).

2. **Counter-evidence.** For each hero signature there are questions in the
   *same chapter* where the trigger is absent — the directing group is
   stated, the axis is the tabulated one, the substitution is handed over,
   the alkene is symmetric — and *no* option carries that misconception's
   tag. Those are marked `counter_to`. The seeder makes the hero answer
   them correctly, which is what produces the line the pitch turns on:

       "On the two questions where the directing group was stated
        explicitly, he was correct — so this is not a topic gap,
        it's a specific trigger."

   Without them the diagnosis reads as generic. `counter_to` is therefore
   load-bearing, not decoration: the seeder refuses to run if a question
   claims to be counter-evidence for a code it actually baits.

Subject split is 15 / 16 / 15 (Physics / Chemistry / Maths). Chemistry
carries the extra because two hero signatures live there.

The chemistry, physics and maths are checked. In production these come
from the institute's own papers through the review queue; for a demo,
generating them ourselves is legitimate — we are demonstrating the
analysis, not selling the questions.
"""

# ---------------------------------------------------------------- taxonomy
#
# `description` is written as the student would *hold* the belief, in their
# voice, not as a description of the error. `remedy` is a lesson a teacher
# could actually run on Tuesday. Both fields go straight into the model's
# prompt — they are what let it explain *why* rather than repeat the
# chapter name back. Write them properly or the reasoning layer has nothing
# to reason with.

MISCONCEPTIONS = [
    # --- Chemistry · Organic -------------------------------------------
    {
        "code": "MIS-ORG-EAS",
        "subject": "Chemistry",
        "name": "Directing effects reversed",
        "description": (
            "An activating group (–CH3, –OH, –NH2) sends the incoming group to "
            "meta; a deactivating group (–NO2, –COOH, –SO3H) sends it to ortho "
            "and para. Whether a substituent is o/p- or meta-directing is "
            "decided by whether it speeds the reaction up or slows it down."
        ),
        "remedy": (
            "Twenty minutes at the board on nitration of toluene and of "
            "nitrobenzene, drawing all three arenium-ion resonance structures "
            "for ortho, meta and para attack in each case, with the student "
            "marking which structures put positive charge on the substituted "
            "carbon. Then six substituents cold: position only, from the "
            "structures. Finish with chlorobenzene — deactivating but "
            "o/p-directing — because it is the case that breaks the "
            "'activating therefore o/p' shortcut and shows the rule is about "
            "resonance, not about rate."
        ),
    },
    {
        "code": "MIS-ORG-MARKOV",
        "subject": "Chemistry",
        "name": "Markovnikov rule misapplied",
        "description": (
            "In HX addition the halogen goes to the carbon that already carries "
            "more hydrogens — the rule recited the wrong way round — and a "
            "peroxide makes no difference to the product because a peroxide is "
            "just a catalyst."
        ),
        "remedy": (
            "Stop teaching it as a rule. The student draws both possible "
            "carbocations for propene + HBr and labels which is secondary and "
            "which is primary; the product then follows without the rule. Do "
            "the peroxide case as a radical mechanism on the same board so the "
            "reversal is visibly a different mechanism rather than an exception "
            "to memorise. Test on 2-methylpropene and on but-2-ene — the second "
            "gives the same answer either way, which shows whether they are "
            "reasoning or reciting."
        ),
    },
    {
        "code": "MIS-ORG-STABILITY",
        "subject": "Chemistry",
        "name": "Carbocation stability order wrong",
        "description": (
            "Carbocation stability follows group size or the order I happened "
            "to memorise, so a primary cation can outrank a tertiary one; and "
            "whichever cation forms first is the one that reacts, because "
            "cations do not rearrange."
        ),
        "remedy": (
            "Count hyperconjugative structures out loud on each candidate — "
            "nine for tert-butyl, six for isopropyl, three for ethyl, none for "
            "methyl. Then run 3-methylbut-1-ene + HBr on the board and ask why "
            "the observed product is not the one the first-formed cation gives; "
            "the 1,2-hydride shift makes the point that stability drives the "
            "outcome, not order of formation."
        ),
    },
    {
        "code": "MIS-EQM-CATALYST",
        "subject": "Chemistry",
        "name": "Catalyst believed to shift equilibrium",
        "description": (
            "A catalyst speeds the forward reaction up, so it pushes the "
            "equilibrium towards the products and raises the yield; K goes up "
            "because more product ends up being formed."
        ),
        "remedy": (
            "One energy profile on the board with Ea(forward) and Ea(reverse) "
            "both marked. Lower the barrier and show the two arrows shortening "
            "by the same amount, then ask what that does to the ratio of the "
            "two rate constants — nothing, and K is that ratio. Follow with "
            "Haber: why a catalyst is used, and why it is pressure and not the "
            "catalyst that buys the yield."
        ),
    },
    {
        "code": "MIS-BOND-COUNT",
        "subject": "Chemistry",
        "name": "sigma and pi bonds miscounted",
        "description": (
            "A double bond is a pi bond and a triple bond is two pi bonds, so "
            "when counting sigma bonds you count only the single ones. C–H "
            "bonds often get left out of the sigma count too, because the "
            "bonding that matters is between the heavy atoms."
        ),
        "remedy": (
            "One rule, stated and then drilled: every bond between two atoms — "
            "single, double or triple — contains exactly one sigma, and the "
            "extras are pi. Count on three molecules with the structure drawn "
            "out, not from the formula: propenal, but-2-yne, benzene, ticking "
            "each sigma on the drawing as it is counted."
        ),
    },
    {
        "code": "MIS-BOND-HYBRID",
        "subject": "Chemistry",
        "name": "Hybridisation read off the formula",
        "description": (
            "Carbon forms four bonds, so carbon is sp3; you get the "
            "hybridisation from how many atoms the central atom is joined to in "
            "the formula. Lone pairs are not bonds, so they do not count."
        ),
        "remedy": (
            "Replace the habit with the steric number: sigma bonds plus lone "
            "pairs, then read off sp / sp2 / sp3 / sp3d. Run it on SF4, XeF4, "
            "NH3 and H2O, where the lone pairs decide the answer, and on the "
            "carbonyl carbon of propenal, where the double bond does. The "
            "steric number gets written down before the hybridisation is named, "
            "every time."
        ),
    },
    # --- Physics -------------------------------------------------------
    {
        "code": "MIS-ROT-AXIS",
        "subject": "Physics",
        "name": "Wrong axis of rotation",
        "description": (
            "Moment of inertia is a property of the body, so the tabulated "
            "value is the value — ML2/12 for a rod, MR2/2 for a disc — whatever "
            "axis the question names. The parallel-axis theorem is for "
            "questions that say 'parallel axis'."
        ),
        "remedy": (
            "Before any number is written, the axis gets drawn on the diagram "
            "and the distance from the centre of mass to it labelled d. Make "
            "that the first mark on every rotation answer for a week. Then give "
            "the same rod four times — about the centre, about an end, about a "
            "point L/4 from an end, and with a bead fixed at one end — so the "
            "body is constant and only the axis moves."
        ),
    },
    {
        "code": "MIS-ROT-SHAPE",
        "subject": "Physics",
        "name": "Wrong body's formula",
        "description": (
            "The standard results are one interchangeable family — MR2/2, MR2, "
            "2MR2/5 — and you use whichever one comes to mind; a rod and a disc "
            "are close enough that ML2/2 and MR2/2 feel like the same formula."
        ),
        "remedy": (
            "Derive two of them from the integral in one sitting — the ring and "
            "the rod — so the results stop being a list to pick from. Then a "
            "two-minute drill: shape named, and the student says which integral "
            "it came from before quoting the formula."
        ),
    },
    {
        "code": "MIS-SIGN-FIELD",
        "subject": "Physics",
        "name": "Field and force directions signed wrongly",
        "description": (
            "A negative charge feels a force along E rather than against it, "
            "potential energy falls whichever way the charge moves, and v x B "
            "can be read off with the fingers pointed whichever way is "
            "convenient. The magnitude is the physics; the sign is bookkeeping "
            "you can patch at the end."
        ),
        "remedy": (
            "One rule, said out loud, every time: F = qE, and if q is negative "
            "the arrow reverses — the arrow gets drawn before anything is "
            "computed. For magnetic force the student physically sets their "
            "right hand and names the three directions aloud before writing. "
            "Mark sign errors as fully wrong for two weeks; in the exam they "
            "are."
        ),
    },
    {
        "code": "MIS-KIN-AVG",
        "subject": "Physics",
        "name": "Average and instantaneous treated as the same",
        "description": (
            "Average speed is the average of the speeds, and the velocity at a "
            "moment is total distance over total time. Whether the question "
            "asks for the value at t = 2 s or over the first 2 s does not "
            "change what gets calculated."
        ),
        "remedy": (
            "Two questions side by side on the same motion — 'velocity at "
            "t = 2 s' and 'average velocity over the first 2 s' — with the "
            "student saying which is a derivative and which is a ratio before "
            "solving either. Then the equal-distance trip at 40 and 60 km/h: "
            "compute the time for each half and see why the answer is not 50."
        ),
    },
    {
        "code": "MIS-KIN-RELVEL",
        "subject": "Physics",
        "name": "Relative motion computed in the wrong frame",
        "description": (
            "All the velocities in a problem are in the same frame, so the "
            "given numbers can be used directly; the velocity of A relative to "
            "B is just whichever of the two the question is about, and the "
            "umbrella tilts along the rain's own direction."
        ),
        "remedy": (
            "Every relative-motion answer opens with the line "
            "v(A rel B) = v(A) - v(B), written as components, before any "
            "triangle is drawn. Do rain-and-man, river-crossing and two-trains "
            "on one page so the student sees a single subtraction doing all "
            "three."
        ),
    },
    # --- Maths ---------------------------------------------------------
    {
        "code": "MIS-CALC-CHAIN",
        "subject": "Maths",
        "name": "Chain rule inner derivative dropped",
        "description": (
            "d/dx of sin(3x) is cos(3x), and the integral of cos(3x) is "
            "sin(3x): the outer function is the thing you differentiate or "
            "integrate, and the 3 inside is part of the name of the variable."
        ),
        "remedy": (
            "Ban writing the answer directly for one session. Every composite "
            "gets u = inner, du = u' dx written out, the integral rewritten in "
            "u and then back-substituted — even for the integral of e^(5x). "
            "Once the factor appears mechanically three times running, remove "
            "the scaffolding and re-test on sin(2x + 5)."
        ),
    },
    {
        "code": "MIS-ALG-SQUARE",
        "subject": "Maths",
        "name": "Roots kept after squaring",
        "description": (
            "Squaring both sides is a legal step like any other, so every root "
            "of the squared equation is a root of the original. Substituting "
            "back is a check you do if there is time left."
        ),
        "remedy": (
            "State the asymmetry once: squaring is not reversible, so it can "
            "only add roots, never lose them — which makes substitution back "
            "part of the method, not a check. Then work root(x + 3) = x + 1 and "
            "sin x + cos x = 1 in full, finding the extraneous roots and "
            "crossing them out explicitly, so the student sees the step pay for "
            "itself."
        ),
    },
    {
        "code": "MIS-TRIG-DOMAIN",
        "subject": "Maths",
        "name": "Inverse-trig range and domain ignored",
        "description": (
            "sin-inverse of sin(theta) is theta and cos-inverse of cos(theta) "
            "is theta for every theta, because the inverse undoes the function; "
            "and the domain of an inverse-trig expression is wherever the thing "
            "inside makes sense."
        ),
        "remedy": (
            "Draw y = sin x, shade the piece from -pi/2 to pi/2 that is "
            "actually inverted, and show 3pi/4 folding back onto pi/4 on the "
            "graph. Then a domain drill: for cos-inverse of g(x) the student "
            "writes -1 <= g(x) <= 1 and solves that inequality before touching "
            "the question."
        ),
    },
    {
        "code": "MIS-ALG-MODULUS",
        "subject": "Maths",
        "name": "Modulus sign cases dropped",
        "description": (
            "The square root of a squared quantity is the quantity itself, and "
            "|x - 3| is x - 3. A modulus equation has two sign cases, so it has "
            "two answers, and once you have two you stop."
        ),
        "remedy": (
            "Fix the identity first: root(a^2) = |a|, with a = -2 substituted "
            "to show why. Then case-split properly — critical points on a "
            "number line, each interval taken in turn, every candidate checked "
            "against the interval it came from. End on |x-1| + |x-3| = 2, where "
            "the middle interval is a whole segment of solutions and the "
            "two-answers habit misses it."
        ),
    },
]


# ---------------------------------------------------------------- questions
#
# Each entry:
#   stem, chapter, difficulty, solution, options
#   options   : [(label, text, is_correct, misconception_code_or_None), ...]
#   counter_to: codes for which this question is deliberate counter-evidence.
#               The trigger for that belief is absent, so no option may carry
#               that code — the seeder enforces it — and the student who
#               holds the belief answers correctly.
#
# `chapter` must already exist in the seeded syllabus tree; seed_questions
# raises a named error if it does not.

QUESTIONS = [

    # ======================================================================
    # PHYSICS — 15
    # ======================================================================

    # ----- Rotational Motion · axis errors (Kunal's signature) -----------
    {
        "stem": (
            "A uniform rod of mass M and length L rotates about an axis through "
            "one end, perpendicular to its length. Its moment of inertia is:"
        ),
        "chapter": "Rotational Motion", "difficulty": "easy",
        "solution": (
            "About the centre of mass I = ML^2/12. The axis is a distance L/2 "
            "away, so the parallel-axis theorem adds M(L/2)^2 = ML^2/4, giving "
            "ML^2/12 + ML^2/4 = ML^2/3."
        ),
        "options": [
            ("A", "ML^2/3", True, None),
            ("B", "ML^2/12", False, "MIS-ROT-AXIS"),
            ("C", "ML^2/2", False, "MIS-ROT-SHAPE"),
            ("D", "ML^2", False, None),
        ],
    },
    {
        "stem": (
            "A uniform disc of mass M and radius R rotates about one of its "
            "diameters. Its moment of inertia is:"
        ),
        "chapter": "Rotational Motion", "difficulty": "medium",
        "solution": (
            "About the central axis perpendicular to the plane, I = MR^2/2. By "
            "the perpendicular-axis theorem that equals the sum of the two "
            "in-plane diameters, which are equal, so each is MR^2/4."
        ),
        "options": [
            ("A", "MR^2/4", True, None),
            ("B", "MR^2/2", False, "MIS-ROT-AXIS"),
            ("C", "MR^2", False, "MIS-ROT-SHAPE"),
            ("D", "2MR^2/5", False, "MIS-ROT-SHAPE"),
        ],
    },
    {
        "stem": (
            "A solid sphere of mass M and radius R rotates about a tangent to "
            "its surface. Its moment of inertia is:"
        ),
        "chapter": "Rotational Motion", "difficulty": "hard",
        "solution": (
            "About a diameter I = 2MR^2/5. A tangent is parallel to a diameter "
            "at distance R, so add MR^2: 2MR^2/5 + MR^2 = 7MR^2/5."
        ),
        "options": [
            ("A", "7MR^2/5", True, None),
            ("B", "2MR^2/5", False, "MIS-ROT-AXIS"),
            ("C", "3MR^2/2", False, "MIS-ROT-SHAPE"),
            ("D", "5MR^2/3", False, "MIS-ROT-SHAPE"),
        ],
    },
    {
        "stem": (
            "A uniform rod of mass M and length L rotates about an axis "
            "perpendicular to the rod through a point L/4 from one end. Its "
            "moment of inertia is:"
        ),
        "chapter": "Rotational Motion", "difficulty": "hard",
        "solution": (
            "The centre of mass is at L/2, so the axis is d = L/4 from it. "
            "I = ML^2/12 + M(L/4)^2 = ML^2/12 + ML^2/16 = 7ML^2/48."
        ),
        "options": [
            ("A", "7ML^2/48", True, None),
            ("B", "ML^2/12", False, "MIS-ROT-AXIS"),
            ("C", "ML^2/3", False, "MIS-ROT-AXIS"),
            ("D", "ML^2/16", False, None),
        ],
    },
    {
        "stem": (
            "A thin circular ring of mass M and radius R rotates about a "
            "tangent lying in the plane of the ring. Its moment of inertia is:"
        ),
        "chapter": "Rotational Motion", "difficulty": "medium",
        "solution": (
            "About a diameter I = MR^2/2. The tangent in the plane is parallel "
            "to a diameter at distance R, so add MR^2, giving 3MR^2/2."
        ),
        "options": [
            ("A", "3MR^2/2", True, None),
            ("B", "MR^2/2", False, "MIS-ROT-AXIS"),
            ("C", "2MR^2", False, "MIS-ROT-AXIS"),
            ("D", "MR^2/4", False, "MIS-ROT-SHAPE"),
        ],
    },
    {
        "stem": (
            "A uniform rod of mass M and length L carries a small bead, also of "
            "mass M, fixed at one end. The system rotates about an axis through "
            "the other end, perpendicular to the rod. Its moment of inertia is:"
        ),
        "chapter": "Rotational Motion", "difficulty": "hard",
        "solution": (
            "The rod about its end contributes ML^2/3. The bead is a point mass "
            "at distance L, contributing ML^2. Total = ML^2/3 + ML^2 = 4ML^2/3."
        ),
        "options": [
            ("A", "4ML^2/3", True, None),
            ("B", "13ML^2/12", False, "MIS-ROT-AXIS"),
            ("C", "ML^2/3", False, None),
            ("D", "2ML^2", False, None),
        ],
    },
    # ----- Rotational Motion · counter-evidence for MIS-ROT-AXIS ---------
    # Same chapter, same family of results, but the axis named is the
    # tabulated one (or the theorem is handed over), so the belief that the
    # tabulated value always applies cannot produce a wrong answer. No
    # option carries MIS-ROT-AXIS.
    {
        "stem": (
            "A uniform disc of mass M and radius R rotates about the axis "
            "through its centre, perpendicular to its plane. Its moment of "
            "inertia is:"
        ),
        "chapter": "Rotational Motion", "difficulty": "easy",
        "solution": (
            "This is the standard central axis for a disc, so no shift of axis "
            "is involved: I = MR^2/2."
        ),
        "options": [
            ("A", "MR^2/2", True, None),
            ("B", "MR^2", False, "MIS-ROT-SHAPE"),
            ("C", "2MR^2/5", False, "MIS-ROT-SHAPE"),
            ("D", "3MR^2/2", False, None),
        ],
        "counter_to": ["MIS-ROT-AXIS"],
    },
    {
        "stem": (
            "The moment of inertia of a uniform rod of mass M and length L "
            "about an axis through its centre of mass, perpendicular to its "
            "length, is ML^2/12. Using the parallel-axis theorem, its moment of "
            "inertia about a parallel axis a distance L/3 from the centre of "
            "mass is:"
        ),
        "chapter": "Rotational Motion", "difficulty": "easy",
        "solution": (
            "I = I_cm + Md^2 = ML^2/12 + M(L/3)^2 = 3ML^2/36 + 4ML^2/36 = "
            "7ML^2/36. Both the centre-of-mass value and the theorem are given, "
            "so the only work left is the arithmetic."
        ),
        "options": [
            ("A", "7ML^2/36", True, None),
            ("B", "ML^2/9", False, None),
            ("C", "13ML^2/36", False, None),
            ("D", "7ML^2/12", False, None),
        ],
        "counter_to": ["MIS-ROT-AXIS"],
    },
    # ----- Rotational Motion · shape confusion --------------------------
    {
        "stem": (
            "Four bodies each of mass M and radius R rotate about the axis "
            "named. Which has the largest moment of inertia?"
        ),
        "chapter": "Rotational Motion", "difficulty": "medium",
        "solution": (
            "Ring about its central perpendicular axis MR^2; hollow sphere "
            "about a diameter 2MR^2/3; solid cylinder about its own axis "
            "MR^2/2; solid sphere about a diameter 2MR^2/5. "
            "1 > 2/3 > 1/2 > 2/5, so the ring is largest."
        ),
        "options": [
            ("A", "A thin ring about its central axis, perpendicular to its plane",
             True, None),
            ("B", "A hollow sphere about a diameter", False, "MIS-ROT-SHAPE"),
            ("C", "A solid cylinder about its own axis", False, "MIS-ROT-SHAPE"),
            ("D", "A solid sphere about a diameter", False, "MIS-ROT-SHAPE"),
        ],
    },
    # ----- Electrostatics / Magnetism · sign of field and force ---------
    {
        "stem": (
            "A proton is released from rest in a uniform electric field E that "
            "points along the +x direction. The proton:"
        ),
        "chapter": "Electrostatics", "difficulty": "easy",
        "solution": (
            "F = qE with q positive, so the force is along E, i.e. along +x, "
            "and the proton accelerates in that direction, gaining kinetic "
            "energy as it moves to lower potential."
        ),
        "options": [
            ("A", "accelerates along +x, gaining kinetic energy", True, None),
            ("B", "accelerates along -x, gaining kinetic energy", False,
             "MIS-SIGN-FIELD"),
            ("C", "remains at rest, since the field does no work on it", False, None),
            ("D", "moves perpendicular to E", False, None),
        ],
    },
    {
        "stem": (
            "A negative charge is moved from a point at higher electric "
            "potential to a point at lower electric potential. Its electric "
            "potential energy:"
        ),
        "chapter": "Electrostatics", "difficulty": "medium",
        "solution": (
            "U = qV, so dU = q dV. Here dV is negative and q is negative, so "
            "dU is positive: the potential energy increases."
        ),
        "options": [
            ("A", "increases", True, None),
            ("B", "decreases", False, "MIS-SIGN-FIELD"),
            ("C", "is unchanged, because only potential difference matters",
             False, None),
            ("D", "becomes zero", False, None),
        ],
    },
    {
        "stem": (
            "A positive charge moves with velocity v along the +x direction in "
            "a uniform magnetic field B directed along +y. The magnetic force "
            "on the charge is directed along:"
        ),
        "chapter": "Magnetic Effects of Current and Magnetism", "difficulty": "medium",
        "solution": (
            "F = q(v x B). With v along +x and B along +y, x-hat cross y-hat is "
            "z-hat, and q is positive, so F is along +z, of magnitude qvB."
        ),
        "options": [
            ("A", "+z", True, None),
            ("B", "-z", False, "MIS-SIGN-FIELD"),
            ("C", "+y", False, None),
            ("D", "the force is zero", False, None),
        ],
    },
    # ----- Kinematics · average vs instantaneous, relative velocity -----
    {
        "stem": (
            "A car covers the first half of a journey at 40 km/h and the second "
            "half at 60 km/h. Its average speed for the whole journey is:"
        ),
        "chapter": "Kinematics", "difficulty": "easy",
        "solution": (
            "The two halves are equal in distance, not in time, so the average "
            "is the harmonic mean: 2(40)(60)/(40 + 60) = 4800/100 = 48 km/h."
        ),
        "options": [
            ("A", "48 km/h", True, None),
            ("B", "50 km/h", False, "MIS-KIN-AVG"),
            ("C", "52 km/h", False, None),
            ("D", "100 km/h", False, None),
        ],
    },
    {
        "stem": (
            "A particle moves along a straight line with x = 3t^2, where x is "
            "in metres and t in seconds. Its velocity at t = 2 s is:"
        ),
        "chapter": "Kinematics", "difficulty": "easy",
        "solution": (
            "v = dx/dt = 6t, so v(2) = 12 m/s. The value 6 m/s is x/t, the "
            "average velocity over the first two seconds, which is a different "
            "quantity."
        ),
        "options": [
            ("A", "12 m/s", True, None),
            ("B", "6 m/s", False, "MIS-KIN-AVG"),
            ("C", "3 m/s", False, None),
            ("D", "24 m/s", False, None),
        ],
    },
    {
        "stem": (
            "Rain is falling vertically downwards at 4 m/s. A man runs "
            "horizontally at 3 m/s. He must hold his umbrella tilted forward "
            "from the vertical at an angle theta, where:"
        ),
        "chapter": "Kinematics", "difficulty": "medium",
        "solution": (
            "In the man's frame the rain's velocity is v(rain) - v(man), with "
            "components (-3, -4). Measured from the vertical that direction has "
            "tan theta = 3/4, so theta = 37 degrees, tilted forward."
        ),
        "options": [
            ("A", "tan theta = 3/4", True, None),
            ("B", "tan theta = 4/3", False, "MIS-KIN-RELVEL"),
            ("C", "theta = 0; the umbrella stays vertical", False, "MIS-KIN-RELVEL"),
            ("D", "tan theta = 3/5", False, None),
        ],
    },

    # ======================================================================
    # CHEMISTRY — 16
    # ======================================================================

    # ----- Electrophilic aromatic substitution (Aarav's signature) ------
    {
        "stem": (
            "Nitration of toluene with a HNO3/H2SO4 mixture gives "
            "predominantly:"
        ),
        "chapter": "Hydrocarbons", "difficulty": "easy",
        "solution": (
            "-CH3 releases electron density by hyperconjugation and inductive "
            "effect, raising it most at the ortho and para positions, so the "
            "major products are o- and p-nitrotoluene."
        ),
        "options": [
            ("A", "o- and p-nitrotoluene", True, None),
            ("B", "m-nitrotoluene", False, "MIS-ORG-EAS"),
            ("C", "An equimolar mixture of all three isomers", False, None),
            ("D", "No reaction under these conditions", False, None),
        ],
        # Same chapter as Ishita's addition questions, and no HX addition is
        # involved, so the Markovnikov belief has nothing to act on.
        "counter_to": ["MIS-ORG-MARKOV"],
    },
    {
        "stem": "Nitration of nitrobenzene gives mainly:",
        "chapter": "Hydrocarbons", "difficulty": "easy",
        "solution": (
            "-NO2 is strongly deactivating and withdraws density from the ortho "
            "and para positions in particular, leaving meta the least "
            "deactivated, so m-dinitrobenzene dominates."
        ),
        "options": [
            ("A", "m-dinitrobenzene", True, None),
            ("B", "o- and p-dinitrobenzene", False, "MIS-ORG-EAS"),
            ("C", "p-dinitrobenzene only", False, "MIS-ORG-EAS"),
            ("D", "1,3,5-trinitrobenzene", False, None),
        ],
    },
    {
        "stem": "Bromination of phenol with bromine water gives:",
        "chapter": "Organic Compounds Containing Oxygen", "difficulty": "medium",
        "solution": (
            "-OH is strongly activating and ortho/para-directing. In aqueous "
            "medium the ring is activated enough for all three of those "
            "positions to react, giving 2,4,6-tribromophenol."
        ),
        "options": [
            ("A", "2,4,6-tribromophenol", True, None),
            ("B", "3-bromophenol", False, "MIS-ORG-EAS"),
            ("C", "3,5-dibromophenol", False, "MIS-ORG-EAS"),
            ("D", "Bromobenzene", False, None),
        ],
    },
    {
        "stem": (
            "Which of the following substituents directs an incoming "
            "electrophile predominantly to the meta position?"
        ),
        "chapter": "Hydrocarbons", "difficulty": "easy",
        "solution": (
            "-COOH withdraws electron density by resonance and induction, "
            "deactivating ortho and para most strongly, so substitution occurs "
            "at meta. The other three release density and are o/p-directing."
        ),
        "options": [
            ("A", "-COOH", True, None),
            ("B", "-OCH3", False, "MIS-ORG-EAS"),
            ("C", "-CH3", False, "MIS-ORG-EAS"),
            ("D", "-NH2", False, "MIS-ORG-EAS"),
        ],
    },
    {
        "stem": "Chlorination of anisole (methoxybenzene) occurs predominantly at:",
        "chapter": "Organic Compounds Containing Oxygen", "difficulty": "medium",
        "solution": (
            "-OCH3 donates a lone pair into the ring by resonance, raising "
            "electron density at ortho and para. Para dominates over ortho "
            "because the methoxy group blocks the neighbouring positions."
        ),
        "options": [
            ("A", "The para position", True, None),
            ("B", "The meta position", False, "MIS-ORG-EAS"),
            ("C", "The carbon bearing the -OCH3 group", False, None),
            ("D", "The methyl carbon of the -OCH3 group", False, None),
        ],
    },
    {
        "stem": (
            "Chlorobenzene is treated with fuming sulphuric acid. The major "
            "product is:"
        ),
        "chapter": "Organic Compounds Containing Halogens", "difficulty": "hard",
        "solution": (
            "A halogen is deactivating by induction but ortho/para-directing by "
            "resonance, because its lone pair stabilises the arenium ion only "
            "for ortho and para attack. The reaction is slower than with "
            "benzene, but the product is para: 4-chlorobenzenesulphonic acid."
        ),
        "options": [
            ("A", "4-chlorobenzenesulphonic acid", True, None),
            ("B", "3-chlorobenzenesulphonic acid", False, "MIS-ORG-EAS"),
            ("C", "Benzenesulphonic acid, the chlorine being displaced",
             False, None),
            ("D", "No reaction, because chlorobenzene is deactivated",
             False, None),
        ],
    },
    # ----- Counter-evidence for MIS-ORG-EAS ------------------------------
    # Same chapters, same reaction type, but the stem states which way the
    # substituent directs. The reversed rule has nothing to reverse, so no
    # option carries MIS-ORG-EAS.
    {
        "stem": (
            "In benzenesulphonic acid the -SO3H group is strongly deactivating "
            "and meta-directing. Nitration of benzenesulphonic acid therefore "
            "gives mainly:"
        ),
        "chapter": "Hydrocarbons", "difficulty": "medium",
        "solution": (
            "The directing behaviour is given, so the only step left is to "
            "place the nitro group at the meta position: "
            "3-nitrobenzenesulphonic acid."
        ),
        "options": [
            ("A", "3-nitrobenzenesulphonic acid", True, None),
            ("B", "4-nitrobenzenesulphonic acid", False, None),
            ("C", "2,4-dinitrobenzenesulphonic acid", False, None),
            ("D", "Nitrobenzene, the -SO3H group being displaced", False, None),
        ],
        "counter_to": ["MIS-ORG-EAS"],
    },
    {
        "stem": (
            "The -OH group of phenol is strongly activating and directs "
            "incoming electrophiles to the ortho and para positions. Nitration "
            "of phenol with dilute nitric acid at 298 K therefore gives:"
        ),
        "chapter": "Organic Compounds Containing Oxygen", "difficulty": "easy",
        "solution": (
            "With the directing behaviour given and the conditions mild, the "
            "products are the mononitrated ortho and para isomers: "
            "2-nitrophenol and 4-nitrophenol. Concentrated nitric acid would be "
            "needed to reach 2,4,6-trinitrophenol."
        ),
        "options": [
            ("A", "A mixture of 2-nitrophenol and 4-nitrophenol", True, None),
            ("B", "2,4,6-trinitrophenol", False, None),
            ("C", "Benzene-1,2-diol", False, None),
            ("D", "Nitrobenzene", False, None),
        ],
        "counter_to": ["MIS-ORG-EAS"],
    },
    # ----- Addition of HX to alkenes (Ishita's signature) ----------------
    {
        "stem": (
            "HBr adds to propene in the absence of peroxide. The major product "
            "is:"
        ),
        "chapter": "Hydrocarbons", "difficulty": "easy",
        "solution": (
            "The proton adds so as to give the more stable carbocation. Adding "
            "H to C-1 gives a secondary cation at C-2; adding it to C-2 would "
            "give a primary cation. So Br ends up on C-2: 2-bromopropane."
        ),
        "options": [
            ("A", "2-bromopropane", True, None),
            ("B", "1-bromopropane", False, "MIS-ORG-MARKOV"),
            ("C", "1,2-dibromopropane", False, None),
            ("D", "Propan-2-ol", False, None),
        ],
    },
    {
        "stem": (
            "HBr adds to propene in the presence of benzoyl peroxide. The major "
            "product is:"
        ),
        "chapter": "Hydrocarbons", "difficulty": "medium",
        "solution": (
            "Peroxide switches the mechanism to free-radical addition. Br adds "
            "first, and it adds so as to give the more stable secondary "
            "radical, putting Br on C-1: anti-Markovnikov 1-bromopropane."
        ),
        "options": [
            ("A", "1-bromopropane", True, None),
            ("B", "2-bromopropane", False, "MIS-ORG-MARKOV"),
            ("C", "Propane", False, None),
            ("D", "No reaction", False, None),
        ],
    },
    {
        "stem": "HBr adds to 2-methylpropene. The major product is:",
        "chapter": "Hydrocarbons", "difficulty": "easy",
        "solution": (
            "Adding H to the terminal CH2 gives a tertiary carbocation, which "
            "is far more stable than the primary alternative, so Br ends up on "
            "the central carbon: 2-bromo-2-methylpropane."
        ),
        "options": [
            ("A", "2-bromo-2-methylpropane", True, None),
            ("B", "1-bromo-2-methylpropane", False, "MIS-ORG-MARKOV"),
            ("C", "2-bromobutane", False, None),
            ("D", "1,2-dibromo-2-methylpropane", False, None),
        ],
    },
    {
        "stem": (
            "HBr adds to but-1-ene in the presence of benzoyl peroxide. The "
            "major product is:"
        ),
        "chapter": "Hydrocarbons", "difficulty": "medium",
        "solution": (
            "The peroxide effect applies to HBr, so the addition is "
            "anti-Markovnikov and proceeds through the more stable secondary "
            "radical, giving 1-bromobutane."
        ),
        "options": [
            ("A", "1-bromobutane", True, None),
            ("B", "2-bromobutane", False, "MIS-ORG-MARKOV"),
            ("C", "1,2-dibromobutane", False, None),
            ("D", "Butan-2-ol", False, None),
        ],
    },
    {
        "stem": "HBr adds to 3-methylbut-1-ene. The major product is:",
        "chapter": "Hydrocarbons", "difficulty": "hard",
        "solution": (
            "H adds to C-1, giving a secondary cation at C-2. A 1,2-hydride "
            "shift from C-3 converts it to a tertiary cation, which is more "
            "stable, and Br is captured there: 2-bromo-2-methylbutane is the "
            "major product."
        ),
        "options": [
            ("A", "2-bromo-2-methylbutane", True, None),
            ("B", "2-bromo-3-methylbutane", False, "MIS-ORG-STABILITY"),
            ("C", "1-bromo-3-methylbutane", False, "MIS-ORG-MARKOV"),
            ("D", "2-bromopentane", False, None),
        ],
    },
    # ----- Counter-evidence for MIS-ORG-MARKOV ---------------------------
    # But-2-ene is symmetric: Markovnikov and anti-Markovnikov addition give
    # the same product, so the belief cannot produce a wrong answer and no
    # option carries the code.
    {
        "stem": "HBr adds to but-2-ene. The major product is:",
        "chapter": "Hydrocarbons", "difficulty": "medium",
        "solution": (
            "But-2-ene is symmetric about the double bond: whichever carbon the "
            "proton adds to, a secondary cation forms and Br ends up on C-2. "
            "The product is 2-bromobutane either way, so the regiochemistry "
            "question does not arise."
        ),
        "options": [
            ("A", "2-bromobutane", True, None),
            ("B", "1-bromobutane", False, None),
            ("C", "2,3-dibromobutane", False, None),
            ("D", "Butan-2-ol", False, None),
        ],
        "counter_to": ["MIS-ORG-MARKOV"],
    },
    # ----- Bonding -------------------------------------------------------
    {
        "stem": (
            "For propenal, CH2=CH-CHO, the number of sigma bonds, the number of "
            "pi bonds, and the hybridisation of the carbonyl carbon are:"
        ),
        "chapter": "Chemical Bonding and Molecular Structure", "difficulty": "medium",
        "solution": (
            "Every bond between two atoms contains one sigma: four C-H, two "
            "C-C and one C-O, so seven sigma. The extras in the two double "
            "bonds give two pi. The carbonyl carbon has three sigma bonds and "
            "no lone pair, steric number 3, so it is sp2."
        ),
        "options": [
            ("A", "7 sigma, 2 pi; carbonyl carbon sp2", True, None),
            ("B", "5 sigma, 2 pi; carbonyl carbon sp2", False, "MIS-BOND-COUNT"),
            ("C", "7 sigma, 2 pi; carbonyl carbon sp3", False, "MIS-BOND-HYBRID"),
            ("D", "9 sigma, 2 pi; carbonyl carbon sp2", False, None),
        ],
    },
    # ----- Equilibrium ---------------------------------------------------
    {
        "stem": (
            "A catalyst is added to a gaseous reaction that has already reached "
            "equilibrium, at constant temperature. Which statement is correct?"
        ),
        "chapter": "Equilibrium", "difficulty": "easy",
        "solution": (
            "A catalyst lowers the activation energy of the forward and reverse "
            "steps by the same amount, so both rate constants rise by the same "
            "factor. K is their ratio, so K and the equilibrium composition are "
            "unchanged; equilibrium is simply reached sooner."
        ),
        "options": [
            ("A", "Both rates increase by the same factor; the equilibrium "
                  "composition is unchanged", True, None),
            ("B", "The equilibrium shifts towards the products and the yield "
                  "increases", False, "MIS-EQM-CATALYST"),
            ("C", "The value of Kc increases", False, "MIS-EQM-CATALYST"),
            ("D", "Equilibrium is reached more slowly", False, None),
        ],
    },

    # ======================================================================
    # MATHS — 15
    # ======================================================================

    # ----- Chain rule (Tanvi's signature) --------------------------------
    {
        "stem": "The integral of cos(3x) with respect to x is:",
        "chapter": "Integral Calculus", "difficulty": "easy",
        "solution": (
            "Put u = 3x, so du = 3 dx and dx = du/3. The integral becomes "
            "(1/3) times the integral of cos u, i.e. (1/3)sin(3x) + C."
        ),
        "options": [
            ("A", "(1/3)sin(3x) + C", True, None),
            ("B", "sin(3x) + C", False, "MIS-CALC-CHAIN"),
            ("C", "3sin(3x) + C", False, "MIS-CALC-CHAIN"),
            ("D", "-(1/3)sin(3x) + C", False, None),
        ],
    },
    {
        "stem": "d/dx of sin(x^2) is:",
        "chapter": "Limits, Continuity and Differentiability", "difficulty": "easy",
        "solution": (
            "Chain rule: the derivative of the outer function is cos(x^2), "
            "multiplied by the derivative of the inner function, 2x."
        ),
        "options": [
            ("A", "2x cos(x^2)", True, None),
            ("B", "cos(x^2)", False, "MIS-CALC-CHAIN"),
            ("C", "2x sin(x^2)", False, None),
            ("D", "-2x cos(x^2)", False, None),
        ],
    },
    {
        "stem": "The integral of e^(5x) with respect to x is:",
        "chapter": "Integral Calculus", "difficulty": "easy",
        "solution": (
            "With u = 5x, du = 5 dx, so the integral is (1/5)e^(5x) + C. The "
            "factor 1/5 is the reciprocal of the inner derivative."
        ),
        "options": [
            ("A", "(1/5)e^(5x) + C", True, None),
            ("B", "e^(5x) + C", False, "MIS-CALC-CHAIN"),
            ("C", "5e^(5x) + C", False, "MIS-CALC-CHAIN"),
            ("D", "e^(5x)/x + C", False, None),
        ],
    },
    {
        "stem": "d/dx of ln(2x + 1) is:",
        "chapter": "Limits, Continuity and Differentiability", "difficulty": "easy",
        "solution": (
            "The derivative of ln(u) is u'/u. Here u = 2x + 1 and u' = 2, so "
            "the answer is 2/(2x + 1)."
        ),
        "options": [
            ("A", "2/(2x + 1)", True, None),
            ("B", "1/(2x + 1)", False, "MIS-CALC-CHAIN"),
            ("C", "1/(2x)", False, None),
            ("D", "2 ln(2x + 1)", False, None),
        ],
    },
    {
        "stem": "The integral of sin(2x + 5) with respect to x is:",
        "chapter": "Integral Calculus", "difficulty": "medium",
        "solution": (
            "With u = 2x + 5, du = 2 dx, the integral is -(1/2)cos(2x + 5) + C."
        ),
        "options": [
            ("A", "-(1/2)cos(2x + 5) + C", True, None),
            ("B", "-cos(2x + 5) + C", False, "MIS-CALC-CHAIN"),
            ("C", "(1/2)cos(2x + 5) + C", False, None),
            ("D", "-2cos(2x + 5) + C", False, "MIS-CALC-CHAIN"),
        ],
    },
    {
        "stem": "d/dx of (3x + 2)^4 is:",
        "chapter": "Limits, Continuity and Differentiability", "difficulty": "medium",
        "solution": (
            "Power rule on the outer function gives 4(3x + 2)^3, multiplied by "
            "the derivative of the inner function, 3, giving 12(3x + 2)^3."
        ),
        "options": [
            ("A", "12(3x + 2)^3", True, None),
            ("B", "4(3x + 2)^3", False, "MIS-CALC-CHAIN"),
            ("C", "3(3x + 2)^3", False, None),
            ("D", "12(3x + 2)^4", False, None),
        ],
    },
    # ----- Counter-evidence for MIS-CALC-CHAIN ---------------------------
    # Same two chapters. In the first there is no composite function at all;
    # in the second the inner derivative is already sitting in the integrand
    # and the substitution is handed over. Nothing to drop, so no option
    # carries the code.
    {
        "stem": "d/dx of x^2 sin x is:",
        "chapter": "Limits, Continuity and Differentiability", "difficulty": "medium",
        "solution": (
            "Product rule: (x^2)' sin x + x^2 (sin x)' = 2x sin x + x^2 cos x. "
            "There is no composite function here, so no chain factor arises."
        ),
        "options": [
            ("A", "2x sin x + x^2 cos x", True, None),
            ("B", "2x cos x", False, None),
            ("C", "x^2 cos x", False, None),
            ("D", "2x sin x", False, None),
        ],
        "counter_to": ["MIS-CALC-CHAIN"],
    },
    {
        "stem": (
            "Using the substitution u = x^2 + 1, for which du = 2x dx, the "
            "integral of 2x(x^2 + 1)^5 with respect to x is:"
        ),
        "chapter": "Integral Calculus", "difficulty": "medium",
        "solution": (
            "The factor 2x in the integrand is exactly du, so the integral "
            "becomes the integral of u^5 du = u^6/6, that is "
            "(x^2 + 1)^6/6 + C. The inner derivative is already present, so "
            "there is no factor to supply or to lose."
        ),
        "options": [
            ("A", "(x^2 + 1)^6/6 + C", True, None),
            ("B", "(x^2 + 1)^6/12 + C", False, None),
            ("C", "2x(x^2 + 1)^6/6 + C", False, None),
            ("D", "(x^2 + 1)^6 + C", False, None),
        ],
        "counter_to": ["MIS-CALC-CHAIN"],
    },
    # ----- Squaring both sides -------------------------------------------
    {
        "stem": "The number of real solutions of root(x + 3) = x + 1 is:",
        "chapter": "Complex Numbers and Quadratic Equations", "difficulty": "medium",
        "solution": (
            "Squaring gives x + 3 = x^2 + 2x + 1, so x^2 + x - 2 = 0 and "
            "x = 1 or x = -2. Substituting back: x = 1 gives 2 = 2, which "
            "holds; x = -2 gives 1 = -1, which does not. Squaring introduced "
            "that root, so there is exactly one solution."
        ),
        "options": [
            ("A", "1", True, None),
            ("B", "2", False, "MIS-ALG-SQUARE"),
            ("C", "0", False, None),
            ("D", "Infinitely many", False, None),
        ],
    },
    {
        "stem": "The solution set of root(2x + 9) = x + 3 is:",
        "chapter": "Complex Numbers and Quadratic Equations", "difficulty": "medium",
        "solution": (
            "Squaring gives 2x + 9 = x^2 + 6x + 9, so x^2 + 4x = 0 and x = 0 or "
            "x = -4. Checking: x = 0 gives 3 = 3, which holds; x = -4 gives "
            "1 = -1, which does not. The solution set is {0}."
        ),
        "options": [
            ("A", "{0}", True, None),
            ("B", "{0, -4}", False, "MIS-ALG-SQUARE"),
            ("C", "{-4}", False, None),
            ("D", "The empty set", False, None),
        ],
    },
    {
        "stem": (
            "The number of solutions of sin x + cos x = 1 in the interval "
            "[0, 2pi) is:"
        ),
        "chapter": "Trigonometry", "difficulty": "medium",
        "solution": (
            "Squaring gives 1 + sin 2x = 1, so sin 2x = 0 and x = 0, pi/2, pi "
            "or 3pi/2. Substituting back into the original equation, x = pi "
            "gives -1 and x = 3pi/2 gives -1, so both are extraneous. Only "
            "x = 0 and x = pi/2 satisfy it: two solutions."
        ),
        "options": [
            ("A", "2", True, None),
            ("B", "4", False, "MIS-ALG-SQUARE"),
            ("C", "1", False, None),
            ("D", "0", False, None),
        ],
    },
    # ----- Inverse trigonometry ------------------------------------------
    {
        "stem": "The value of sin-inverse( sin(3pi/4) ) is:",
        "chapter": "Trigonometry", "difficulty": "medium",
        "solution": (
            "sin(3pi/4) = 1/root2. The principal range of sin-inverse is "
            "[-pi/2, pi/2], and 3pi/4 lies outside it, so the answer is the "
            "angle inside that range with the same sine: pi/4."
        ),
        "options": [
            ("A", "pi/4", True, None),
            ("B", "3pi/4", False, "MIS-TRIG-DOMAIN"),
            ("C", "-pi/4", False, None),
            ("D", "pi/2", False, None),
        ],
    },
    {
        "stem": "The domain of f(x) = cos-inverse(2x - 1) is:",
        "chapter": "Trigonometry", "difficulty": "easy",
        "solution": (
            "cos-inverse is defined only on [-1, 1], so the requirement is "
            "-1 <= 2x - 1 <= 1, giving 0 <= 2x <= 2 and hence 0 <= x <= 1."
        ),
        "options": [
            ("A", "[0, 1]", True, None),
            ("B", "All real x", False, "MIS-TRIG-DOMAIN"),
            ("C", "[-1, 1]", False, "MIS-TRIG-DOMAIN"),
            ("D", "[-1, 0]", False, None),
        ],
    },
    # ----- Modulus --------------------------------------------------------
    {
        "stem": "The number of solutions of |x - 1| + |x - 3| = 2 is:",
        "chapter": "Complex Numbers and Quadratic Equations", "difficulty": "medium",
        "solution": (
            "Split at the critical points 1 and 3. For x < 1 the equation gives "
            "x = 1, outside that interval. For x > 3 it gives x = 3, outside "
            "that interval. For 1 <= x <= 3 it reduces to 2 = 2, true "
            "throughout. The solution set is the whole interval [1, 3], so "
            "there are infinitely many solutions."
        ),
        "options": [
            ("A", "Infinitely many: every x in [1, 3]", True, None),
            ("B", "Two", False, "MIS-ALG-MODULUS"),
            ("C", "One", False, None),
            ("D", "None", False, None),
        ],
    },
    {
        "stem": "For all real x, root((x - 3)^2) equals:",
        "chapter": "Sets, Relations and Functions", "difficulty": "easy",
        "solution": (
            "The square root sign denotes the non-negative root, so "
            "root(a^2) = |a| for every real a. Here that is |x - 3|, which "
            "equals x - 3 only when x >= 3."
        ),
        "options": [
            ("A", "|x - 3|", True, None),
            ("B", "x - 3", False, "MIS-ALG-MODULUS"),
            ("C", "plus or minus (x - 3)", False, None),
            ("D", "3 - x", False, None),
        ],
    },
]
