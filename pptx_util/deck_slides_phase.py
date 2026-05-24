"""Slide 12: Phase Ratchet Evaluators."""

from .deck_primitives import (
    MUTED_FG,
    chrome,
    tbl,
    call,
    txt,
)


def s12(p):
    s = p.slides.add_slide(p.slide_layouts[6])
    chrome(
        s,
        12,
        title="Phase Ratchet Evaluators",
        sub="Opus 4.6 generates · Opus 4.7 validates · Ratchet: scores only go up · Human gate preserved",
    )

    # Table showing 6 phases with their rubrics
    tbl(
        s,
        [
            ["Phase", "Upstream", "Max Iter", "Key Checks"],
            [
                "BRD",
                "None (root)",
                "3",
                "13 sections complete, >= 3 quantified metrics,\nMVP maps to scope, >= 2 alternatives",
            ],
            [
                "Spec",
                "BRD goals",
                "3",
                "Every story -> BRD goal, ACs testable,\ndeps acyclic, features.json complete",
            ],
            [
                "Design",
                "Spec stories",
                "3",
                "Component-map covers all stories,\nschemas valid, mockup fields match API",
            ],
            [
                "Brownfield",
                "Codebase",
                "2",
                "Modules exist in repo, evidence-cited,\ncoupling matches graph, concrete strategy",
            ],
            [
                "Seam-Finder",
                "code-graph.json",
                "2",
                "Top 3 candidates exist in code,\n3 axes scored, independent cut-points",
            ],
            [
                "Deploy",
                "system-design.md",
                "2",
                "Services match design, no port conflicts,\nhealth checks defined, init.sh complete",
            ],
        ],
        0.45,
        1.15,
        9.10,
        2.80,
        [1.2, 1.3, 0.7, 5.8],
    )

    # Callout showing the ratchet pattern
    call(
        s,
        0.45,
        4.10,
        9.10,
        0.55,
        "5 criteria (completeness, traceability, specificity, consistency, actionability) · "
        "Pass: avg >= 7.0 AND all >= 5 · Ratchet: score[i] >= score[i-1] always",
    )

    txt(
        s,
        "Telemetry: harness_phase_eval_score + harness_phase_eval_iterations_total · "
        "4 Grafana panels in Phase Quality section",
        0.45,
        4.75,
        9.10,
        0.20,
        sz=8,
        c=MUTED_FG,
    )


ALL = [s12]
