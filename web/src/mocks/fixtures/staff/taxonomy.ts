import type { Misconception } from "@/api/types";

/**
 * `GET /api/misconceptions/` — the whole taxonomy, all fifteen entries,
 * transcribed verbatim from the live server. It has no Biology entries yet,
 * which is true of the live taxonomy too: a NEET Botany or Zoology option can
 * only be given a proposal until someone adds one.
 */
export const TAXONOMY: Misconception[] = [
  {
    "code": "MIS-BOND-COUNT",
    "subject": "Chemistry",
    "name": "sigma and pi bonds miscounted",
    "description": "A double bond is a pi bond and a triple bond is two pi bonds, so when counting sigma bonds you count only the single ones. C–H bonds often get left out of the sigma count too, because the bonding that matters is between the heavy atoms.",
    "remedy": "One rule, stated and then drilled: every bond between two atoms — single, double or triple — contains exactly one sigma, and the extras are pi. Count on three molecules with the structure drawn out, not from the formula: propenal, but-2-yne, benzene, ticking each sigma on the drawing as it is counted."
  },
  {
    "code": "MIS-BOND-HYBRID",
    "subject": "Chemistry",
    "name": "Hybridisation read off the formula",
    "description": "Carbon forms four bonds, so carbon is sp3; you get the hybridisation from how many atoms the central atom is joined to in the formula. Lone pairs are not bonds, so they do not count.",
    "remedy": "Replace the habit with the steric number: sigma bonds plus lone pairs, then read off sp / sp2 / sp3 / sp3d. Run it on SF4, XeF4, NH3 and H2O, where the lone pairs decide the answer, and on the carbonyl carbon of propenal, where the double bond does. The steric number gets written down before the hybridisation is named, every time."
  },
  {
    "code": "MIS-EQM-CATALYST",
    "subject": "Chemistry",
    "name": "Catalyst believed to shift equilibrium",
    "description": "A catalyst speeds the forward reaction up, so it pushes the equilibrium towards the products and raises the yield; K goes up because more product ends up being formed.",
    "remedy": "One energy profile on the board with Ea(forward) and Ea(reverse) both marked. Lower the barrier and show the two arrows shortening by the same amount, then ask what that does to the ratio of the two rate constants — nothing, and K is that ratio. Follow with Haber: why a catalyst is used, and why it is pressure and not the catalyst that buys the yield."
  },
  {
    "code": "MIS-ORG-EAS",
    "subject": "Chemistry",
    "name": "Directing effects reversed",
    "description": "An activating group (–CH3, –OH, –NH2) sends the incoming group to meta; a deactivating group (–NO2, –COOH, –SO3H) sends it to ortho and para. Whether a substituent is o/p- or meta-directing is decided by whether it speeds the reaction up or slows it down.",
    "remedy": "Twenty minutes at the board on nitration of toluene and of nitrobenzene, drawing all three arenium-ion resonance structures for ortho, meta and para attack in each case, with the student marking which structures put positive charge on the substituted carbon. Then six substituents cold: position only, from the structures. Finish with chlorobenzene — deactivating but o/p-directing — because it is the case that breaks the 'activating therefore o/p' shortcut and shows the rule is about resonance, not about rate."
  },
  {
    "code": "MIS-ORG-MARKOV",
    "subject": "Chemistry",
    "name": "Markovnikov rule misapplied",
    "description": "In HX addition the halogen goes to the carbon that already carries more hydrogens — the rule recited the wrong way round — and a peroxide makes no difference to the product because a peroxide is just a catalyst.",
    "remedy": "Stop teaching it as a rule. The student draws both possible carbocations for propene + HBr and labels which is secondary and which is primary; the product then follows without the rule. Do the peroxide case as a radical mechanism on the same board so the reversal is visibly a different mechanism rather than an exception to memorise. Test on 2-methylpropene and on but-2-ene — the second gives the same answer either way, which shows whether they are reasoning or reciting."
  },
  {
    "code": "MIS-ORG-STABILITY",
    "subject": "Chemistry",
    "name": "Carbocation stability order wrong",
    "description": "Carbocation stability follows group size or the order I happened to memorise, so a primary cation can outrank a tertiary one; and whichever cation forms first is the one that reacts, because cations do not rearrange.",
    "remedy": "Count hyperconjugative structures out loud on each candidate — nine for tert-butyl, six for isopropyl, three for ethyl, none for methyl. Then run 3-methylbut-1-ene + HBr on the board and ask why the observed product is not the one the first-formed cation gives; the 1,2-hydride shift makes the point that stability drives the outcome, not order of formation."
  },
  {
    "code": "MIS-ALG-MODULUS",
    "subject": "Maths",
    "name": "Modulus sign cases dropped",
    "description": "The square root of a squared quantity is the quantity itself, and |x - 3| is x - 3. A modulus equation has two sign cases, so it has two answers, and once you have two you stop.",
    "remedy": "Fix the identity first: root(a^2) = |a|, with a = -2 substituted to show why. Then case-split properly — critical points on a number line, each interval taken in turn, every candidate checked against the interval it came from. End on |x-1| + |x-3| = 2, where the middle interval is a whole segment of solutions and the two-answers habit misses it."
  },
  {
    "code": "MIS-ALG-SQUARE",
    "subject": "Maths",
    "name": "Roots kept after squaring",
    "description": "Squaring both sides is a legal step like any other, so every root of the squared equation is a root of the original. Substituting back is a check you do if there is time left.",
    "remedy": "State the asymmetry once: squaring is not reversible, so it can only add roots, never lose them — which makes substitution back part of the method, not a check. Then work root(x + 3) = x + 1 and sin x + cos x = 1 in full, finding the extraneous roots and crossing them out explicitly, so the student sees the step pay for itself."
  },
  {
    "code": "MIS-CALC-CHAIN",
    "subject": "Maths",
    "name": "Chain rule inner derivative dropped",
    "description": "d/dx of sin(3x) is cos(3x), and the integral of cos(3x) is sin(3x): the outer function is the thing you differentiate or integrate, and the 3 inside is part of the name of the variable.",
    "remedy": "Ban writing the answer directly for one session. Every composite gets u = inner, du = u' dx written out, the integral rewritten in u and then back-substituted — even for the integral of e^(5x). Once the factor appears mechanically three times running, remove the scaffolding and re-test on sin(2x + 5)."
  },
  {
    "code": "MIS-TRIG-DOMAIN",
    "subject": "Maths",
    "name": "Inverse-trig range and domain ignored",
    "description": "sin-inverse of sin(theta) is theta and cos-inverse of cos(theta) is theta for every theta, because the inverse undoes the function; and the domain of an inverse-trig expression is wherever the thing inside makes sense.",
    "remedy": "Draw y = sin x, shade the piece from -pi/2 to pi/2 that is actually inverted, and show 3pi/4 folding back onto pi/4 on the graph. Then a domain drill: for cos-inverse of g(x) the student writes -1 <= g(x) <= 1 and solves that inequality before touching the question."
  },
  {
    "code": "MIS-KIN-AVG",
    "subject": "Physics",
    "name": "Average and instantaneous treated as the same",
    "description": "Average speed is the average of the speeds, and the velocity at a moment is total distance over total time. Whether the question asks for the value at t = 2 s or over the first 2 s does not change what gets calculated.",
    "remedy": "Two questions side by side on the same motion — 'velocity at t = 2 s' and 'average velocity over the first 2 s' — with the student saying which is a derivative and which is a ratio before solving either. Then the equal-distance trip at 40 and 60 km/h: compute the time for each half and see why the answer is not 50."
  },
  {
    "code": "MIS-KIN-RELVEL",
    "subject": "Physics",
    "name": "Relative motion computed in the wrong frame",
    "description": "All the velocities in a problem are in the same frame, so the given numbers can be used directly; the velocity of A relative to B is just whichever of the two the question is about, and the umbrella tilts along the rain's own direction.",
    "remedy": "Every relative-motion answer opens with the line v(A rel B) = v(A) - v(B), written as components, before any triangle is drawn. Do rain-and-man, river-crossing and two-trains on one page so the student sees a single subtraction doing all three."
  },
  {
    "code": "MIS-ROT-AXIS",
    "subject": "Physics",
    "name": "Wrong axis of rotation",
    "description": "Moment of inertia is a property of the body, so the tabulated value is the value — ML2/12 for a rod, MR2/2 for a disc — whatever axis the question names. The parallel-axis theorem is for questions that say 'parallel axis'.",
    "remedy": "Before any number is written, the axis gets drawn on the diagram and the distance from the centre of mass to it labelled d. Make that the first mark on every rotation answer for a week. Then give the same rod four times — about the centre, about an end, about a point L/4 from an end, and with a bead fixed at one end — so the body is constant and only the axis moves."
  },
  {
    "code": "MIS-ROT-SHAPE",
    "subject": "Physics",
    "name": "Wrong body's formula",
    "description": "The standard results are one interchangeable family — MR2/2, MR2, 2MR2/5 — and you use whichever one comes to mind; a rod and a disc are close enough that ML2/2 and MR2/2 feel like the same formula.",
    "remedy": "Derive two of them from the integral in one sitting — the ring and the rod — so the results stop being a list to pick from. Then a two-minute drill: shape named, and the student says which integral it came from before quoting the formula."
  },
  {
    "code": "MIS-SIGN-FIELD",
    "subject": "Physics",
    "name": "Field and force directions signed wrongly",
    "description": "A negative charge feels a force along E rather than against it, potential energy falls whichever way the charge moves, and v x B can be read off with the fingers pointed whichever way is convenient. The magnitude is the physics; the sign is bookkeeping you can patch at the end.",
    "remedy": "One rule, said out loud, every time: F = qE, and if q is negative the arrow reverses — the arrow gets drawn before anything is computed. For magnetic force the student physically sets their right hand and names the three directions aloud before writing. Mark sign errors as fully wrong for two weeks; in the exam they are."
  }
];
