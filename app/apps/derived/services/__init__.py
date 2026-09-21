"""Derived-state services — the deterministic engines.

Everything in this package computes numbers. Nothing in it calls an LLM.
That boundary is the core principle of the product (TECHNICAL_DOC.md §2):
the model narrates, it never computes. A Gemini import appearing anywhere
under this package is a bug, not a feature.

    features.py    rung-0 mastery + per-student rollups (the feature store)
    detectors.py   typed, evidenced flags built on top of the feature store

Both are rebuildable from the event tables alone. Drop everything in
`derived/` and run `recompute_features` + `run_detectors` and you are back
where you started.
"""
