"""JEE Main syllabus tree.

⚠️  PLACEHOLDER STRUCTURE — verify against the official NTA syllabus PDF
    (nta.ac.in) before using with a real institute. NTA has revised the
    syllabus more than once; chapter names and inclusions drift.

`weight` is the typical marks a chapter carries in the paper. These are
plausible estimates, not measured values. Replace them with counts derived
from ~10 years of previous papers (Track C1) — the planner uses weight to
decide what to prioritise when time runs short.

Shape: {subject: {unit: [(chapter, weight), ...]}}
"""

JEE_MAIN = {
    "Physics": {
        "Mechanics": [
            ("Physics and Measurement", 4),
            ("Kinematics", 4),
            ("Laws of Motion", 4),
            ("Work, Energy and Power", 4),
            ("Rotational Motion", 8),
            ("Gravitation", 4),
            ("Properties of Solids and Liquids", 8),
        ],
        "Thermal Physics": [
            ("Thermodynamics", 8),
            ("Kinetic Theory of Gases", 4),
        ],
        "Oscillations and Waves": [
            ("Oscillations", 4),
            ("Waves", 4),
        ],
        "Electrodynamics": [
            ("Electrostatics", 8),
            ("Current Electricity", 8),
            ("Magnetic Effects of Current and Magnetism", 8),
            ("Electromagnetic Induction and Alternating Currents", 8),
            ("Electromagnetic Waves", 4),
        ],
        "Optics and Modern Physics": [
            ("Ray Optics", 4),
            ("Wave Optics", 4),
            ("Dual Nature of Matter and Radiation", 4),
            ("Atoms and Nuclei", 4),
            ("Electronic Devices", 4),
        ],
    },
    "Chemistry": {
        "Physical Chemistry": [
            ("Some Basic Concepts in Chemistry", 4),
            ("Atomic Structure", 4),
            ("Chemical Bonding and Molecular Structure", 8),
            ("Chemical Thermodynamics", 8),
            ("Solutions", 4),
            ("Equilibrium", 8),
            ("Redox Reactions and Electrochemistry", 8),
            ("Chemical Kinetics", 4),
        ],
        "Inorganic Chemistry": [
            ("Classification of Elements and Periodicity", 4),
            ("p-Block Elements", 8),
            ("d- and f-Block Elements", 4),
            ("Coordination Compounds", 8),
        ],
        "Organic Chemistry": [
            ("Purification and Characterisation", 4),
            ("Some Basic Principles of Organic Chemistry", 8),
            ("Hydrocarbons", 8),
            ("Organic Compounds Containing Halogens", 4),
            ("Organic Compounds Containing Oxygen", 8),
            ("Organic Compounds Containing Nitrogen", 4),
            ("Biomolecules", 4),
        ],
    },
    "Maths": {
        "Algebra": [
            ("Sets, Relations and Functions", 4),
            ("Complex Numbers and Quadratic Equations", 8),
            ("Matrices and Determinants", 8),
            ("Permutations and Combinations", 4),
            ("Binomial Theorem", 4),
            ("Sequences and Series", 4),
        ],
        "Calculus": [
            ("Limits, Continuity and Differentiability", 8),
            ("Integral Calculus", 12),
            ("Differential Equations", 4),
        ],
        "Coordinate Geometry": [
            ("Straight Lines", 4),
            ("Circles", 4),
            ("Conic Sections", 8),
            ("Three Dimensional Geometry", 8),
        ],
        "Vectors, Statistics and Trigonometry": [
            ("Vector Algebra", 4),
            ("Statistics and Probability", 8),
            ("Trigonometry", 4),
        ],
    },
}
