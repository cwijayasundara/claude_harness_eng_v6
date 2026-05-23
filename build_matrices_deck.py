"""Generate matrices.pptx — Productivity & ROI measurement deck.

Matches the design language of Claude_Harness_Engine_Design.pptx:
  16:9, slate-900 background, sky-400 top bar, Calibri, card grid.
"""

from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR

BG = RGBColor(0x0F, 0x17, 0x2A)
ACCENT_BAR = RGBColor(0x38, 0xBD, 0xF8)
CARD = RGBColor(0x1E, 0x29, 0x3B)
TITLE_FG = RGBColor(0xF8, 0xFA, 0xFC)
SUBTITLE_FG = RGBColor(0x38, 0xBD, 0xF8)
BODY_FG = RGBColor(0xCB, 0xD5, 0xE1)
MUTED_FG = RGBColor(0x94, 0xA3, 0xB8)
TABLE_HEADER_BG = RGBColor(0x33, 0x41, 0x55)
TABLE_ALT_BG = RGBColor(0x16, 0x20, 0x33)
TABLE_ROW_BG = RGBColor(0x1E, 0x29, 0x3B)
CALLOUT_BG = RGBColor(0x0C, 0x4A, 0x6E)
ACCENTS = [
    RGBColor(0x38, 0xBD, 0xF8), RGBColor(0xFB, 0x92, 0x3C),
    RGBColor(0x4A, 0xDE, 0x80), RGBColor(0xA7, 0x8B, 0xFA),
    RGBColor(0xFB, 0xBF, 0x24), RGBColor(0xF8, 0x71, 0x71),
]
FONT = "Calibri"
SLIDE_W, SLIDE_H = 10.0, 5.625
TOTAL_SLIDES = 6
BRAND = "Claude Harness Engine v4   ·   Productivity & ROI Measurement"

def add_bg(slide):
    bg = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0), Inches(0), Inches(SLIDE_W), Inches(SLIDE_H))
    bg.fill.solid(); bg.fill.fore_color.rgb = BG; bg.line.fill.background()
    bar = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0), Inches(0), Inches(SLIDE_W), Inches(0.06))
    bar.fill.solid(); bar.fill.fore_color.rgb = ACCENT_BAR; bar.line.fill.background()

def add_text(slide, text, x, y, w, h, *, size=12, bold=False, color=BODY_FG, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP):
    tb = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = Emu(0)
    tf.margin_top = tf.margin_bottom = Emu(0)
    tf.vertical_anchor = anchor
    for i, line in enumerate(text.split("\n")):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        r = p.add_run(); r.text = line
        r.font.name = FONT; r.font.size = Pt(size); r.font.bold = bold
        r.font.color.rgb = color
    return tb

def add_card(slide, x, y, w, h, fill=CARD):
    shp = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    shp.fill.solid(); shp.fill.fore_color.rgb = fill; shp.line.fill.background()
    shp.adjustments[0] = 0.06
    return shp

def add_chrome(slide, page_num, title, subtitle):
    add_bg(slide)
    add_text(slide, title, 0.45, 0.20, 9.10, 0.55, size=26, bold=True, color=TITLE_FG)
    add_text(slide, subtitle, 0.45, 0.78, 9.10, 0.35, size=12, color=SUBTITLE_FG)
    add_text(slide, BRAND, 0.45, 5.30, 6.50, 0.20, size=8, color=MUTED_FG)
    add_text(slide, f"{page_num} / {TOTAL_SLIDES}", 8.50, 5.30, 1.10, 0.20, size=8, color=MUTED_FG, align=PP_ALIGN.RIGHT)

def add_card_with_text(slide, x, y, w, h, heading, body, accent):
    add_card(slide, x, y, w, h)
    add_text(slide, heading, x + 0.18, y + 0.12, w - 0.36, 0.30, size=13, bold=True, color=accent)
    add_text(slide, body, x + 0.18, y + 0.45, w - 0.36, h - 0.55, size=10, color=BODY_FG)

GRID = [(0.45,1.30),(3.50,1.30),(6.55,1.30),(0.45,3.05),(3.50,3.05),(6.55,3.05)]
CARD_W, CARD_H = 2.95, 1.65

def add_six_cards(slide, cards):
    for i, (heading, body) in enumerate(cards):
        x, y = GRID[i]
        add_card_with_text(slide, x, y, CARD_W, CARD_H, heading, body, ACCENTS[i % len(ACCENTS)])

def add_table(slide, rows_data, x, y, w, h, col_widths_rel):
    n_rows = len(rows_data); n_cols = len(rows_data[0])
    tbl_shape = slide.shapes.add_table(n_rows, n_cols, Inches(x), Inches(y), Inches(w), Inches(h))
    tbl = tbl_shape.table
    total = sum(col_widths_rel)
    for ci, rel in enumerate(col_widths_rel):
        tbl.columns[ci].width = Inches(w * rel / total)
    for ri, row in enumerate(rows_data):
        for ci, val in enumerate(row):
            cell = tbl.cell(ri, ci)
            cell.margin_left = Inches(0.08); cell.margin_right = Inches(0.08)
            cell.margin_top = Inches(0.04); cell.margin_bottom = Inches(0.04)
            cell.vertical_anchor = MSO_ANCHOR.TOP
            is_header = (ri == 0)
            cell.fill.solid()
            cell.fill.fore_color.rgb = TABLE_HEADER_BG if is_header else (TABLE_ALT_BG if ri % 2 == 0 else TABLE_ROW_BG)
            tf = cell.text_frame; tf.word_wrap = True
            p = tf.paragraphs[0]; p.alignment = PP_ALIGN.LEFT
            r = p.add_run(); r.text = val
            r.font.name = FONT; r.font.size = Pt(11 if is_header else 9)
            r.font.bold = is_header
            r.font.color.rgb = TITLE_FG if is_header else BODY_FG
    return tbl_shape

def add_callout(slide, x, y, w, h, text, color=ACCENT_BAR):
    shp = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    shp.fill.solid(); shp.fill.fore_color.rgb = CALLOUT_BG
    shp.line.color.rgb = color; shp.line.width = Pt(1.0)
    shp.adjustments[0] = 0.10
    add_text(slide, text, x + 0.20, y + 0.10, w - 0.40, h - 0.20, size=11, bold=True, color=TITLE_FG, anchor=MSO_ANCHOR.MIDDLE)

def slide1(prs):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    add_chrome(s, 1, "Measuring the Harness", "Two-layer architecture: Claude Code native OTEL for standard metrics + harness-custom for lane/iteration/contract concepts")
    add_six_cards(s, [
        ("Native OTEL (reuse)", "Claude Code ships 8 metrics + 24 events via OpenTelemetry: tokens, cost, sessions, commits, PRs, LOC, tool acceptance, active time. Enable with CLAUDE_CODE_ENABLE_TELEMETRY=1. No custom code."),
        ("Harness-custom (build)", "Lane, mode, iteration, group, contract pass/fail — concepts that exist only in the harness. Captured by record-run.js → .claude/runs/*.jsonl + Harness-Lane: commit trailers."),
        ("External (join)", "PR merge state, rework rate, reviewer wall-clock, defect-escape — live in Jira/ADO/GitHub/CI. The Harness-Lane: trailer is the join key so external dashboards can segment by lane."),
        ("Three buckets, never averaged", "Greenfield, brownfield, and review-displaced are reported separately. A single blended number hides regressions in the hard mode."),
        ("Yield > Throughput", "Attempt-to-merge ratio, rework rate, and verification tax survive Goodhart. Throughput alone is gameable with low-quality PRs."),
        ("ROI = saved $ − cost", "(Engineer-hours saved × loaded rate) − (agent cost from native OTEL). Token cost reads directly from claude_code.cost.usage metric."),
    ])

def slide2(prs):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    add_chrome(s, 2, "The 4-Dimension Model", "Adapted from DX Core 4 — split per lane, because greenfield and brownfield behave nothing alike")
    add_six_cards(s, [
        ("1. Throughput", "Shippable work per week. Merged-PRs/week, story-groups completed, contract-pass rate. Easy to inflate — never report alone."),
        ("2. Yield", "Fraction of attempts that merge and stick. Attempt-to-merge, evaluator-pass-on-first-try, 7/30-day rework rate. The honest number."),
        ("3. Cost", "Tokens + cost from native OTEL (claude_code.cost.usage). Verification tax (human review-time vs. agent wall-clock) is the hidden line item."),
        ("4. Quality drift", "Silent debt. Lint/complexity rise ~18–39% in AI-heavy repos. Defect-escape per 1k LOC. Contract-erosion mid-iteration."),
        ("Reporting rule", "Every dashboard splits Greenfield · Brownfield · Review-displaced. Tag every commit with Harness-Lane: to make segmentation cheap."),
        ("Baseline rule", "Numbers without a baseline are noise. Maintain reference BRDs (in-house SWE-bench) and tag pre-harness vs. post-harness work."),
    ])

def slide3(prs):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    add_chrome(s, 3, "Greenfield Metrics", "Lane: /scaffold → /brd → /spec → /design → /implement → /evaluate.  Headline = wall-clock to all-features-green ÷ feature count")
    rows = [
        ["Metric", "Description", "How to measure", "Source"],
        ["Time-to-first-green", "Wall-clock from /spec accepted → first contract PASS", "ts delta between first and evaluator-pass records in .claude/runs/*.jsonl", "Harness-custom (record-run.js)"],
        ["Iterations-to-green", "Generator↔evaluator round-trips before contract pass", "Max `iteration` field per group_id in run-receipts; also `Harness-Iteration:` commit trailer", "Harness-custom"],
        ["Contract-pass-on-first-try", "% of story groups passing evaluator on iteration 1", "Count records: agent=evaluator, iteration=1, exit=ok ÷ total groups", "Harness-custom"],
        ["Tokens per feature", "Σ tokens ÷ features in features.json", "claude_code.token.usage metric, filtered by skill.name matching the group", "Native OTEL"],
        ["Cost per feature", "USD spent per shippable feature", "claude_code.cost.usage metric, filtered by agent.name + skill.name", "Native OTEL"],
        ["Design-critic convergence", "Iterations until 4-criterion score ≥ threshold", "Count `kind=subagent agent=design-critic` records per group in run-receipts", "Harness-custom"],
        ["Scaffold-to-first-PR", "Days from /scaffold → first merged PR", "First run-receipt ts + PR merge ts via PR API", "External + Harness ts"],
    ]
    add_table(s, rows, 0.45, 1.25, 9.10, 3.55, col_widths_rel=[2.0, 2.9, 3.9, 2.2])
    add_text(s, "Native OTEL = CLAUDE_CODE_ENABLE_TELEMETRY=1 (enabled by scaffold). Harness-custom = .claude/runs/*.jsonl (record-run.js). No duplication — each metric has exactly one source.", 0.45, 4.90, 9.10, 0.35, size=10, color=MUTED_FG)

def slide4(prs):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    add_chrome(s, 4, "Brownfield Metrics", "Lane: /brownfield → /seam-finder → /vibe | /improve | /refactor.  Headline = attempt-to-merge ratio, NOT throughput")
    rows = [
        ["Metric", "Description", "How to measure", "Source"],
        ["Attempt-to-merge ratio", "Merged agent PRs ÷ opened agent PRs (industry ~33%)", "PR API: count PRs with `Harness-Lane:` trailer, grouped by lane", "External + Harness trailer"],
        ["Rework rate (7 / 30-day)", "% of merged agent PRs needing follow-up fix within window", "git blame + PR cross-ref, filtered by Harness-Lane: trailer", "External + Harness trailer"],
        ["Blast radius", "LOC added+removed / files touched per PR", "Native claude_code.lines_of_code.count + git diff, bucketed by Harness-Lane:", "Native OTEL + Harness trailer"],
        ["Contract preservation", "% of pre-existing tests still passing post-change", "CI test-result delta vs. base branch", "External (CI)"],
        ["Seam fit", "% of changes inside seams ranked by /seam-finder", "Diff file paths ∩ /seam-finder artifact", "Harness-custom"],
        ["Lane correctness", "% of changes done in the right lane", ".claude/state/current-lane (lane-classify) vs. blast radius from git", "Harness-custom"],
        ["Brownfield-map staleness", "Map age × repo churn since last /brownfield", "brownfield-staleness.js warns at 14 days OR 50 commits", "Harness-custom"],
    ]
    add_table(s, rows, 0.45, 1.25, 9.10, 3.55, col_widths_rel=[2.0, 2.9, 3.9, 2.2])
    add_text(s, "External metrics join to harness via the Harness-Lane: commit trailer. Native OTEL provides LOC and cost baselines. Harness-custom provides seam/lane/staleness — concepts with no native equivalent.", 0.45, 4.90, 9.10, 0.35, size=10, color=MUTED_FG)

def slide5(prs):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    add_chrome(s, 5, "Review & Security ROI", "The largest displaceable cost — and where the harness most clearly pays for itself")
    rows = [
        ["Metric", "Description", "How to measure", "Source"],
        ["Reviewer-hours per PR (Δ)", "Avg human review-time before vs. after harness", "PR open → approval ts from PR API, filtered by Harness-Lane: trailer", "External + Harness trailer"],
        ["Pre-merge defects caught", "Issues caught by /review + security-reviewer + clean-code-reviewer", "Count subagent records in .claude/runs/*.jsonl (agent = reviewer types)", "Harness-custom"],
        ["Review agent cost", "USD spent on automated code + security review", "claude_code.cost.usage filtered by agent.name ∈ {clean-code-reviewer, security-reviewer}", "Native OTEL"],
        ["Security findings shifted left", "Critical / high findings caught pre-merge vs. post-merge", "Subagent records (pre-merge) + post-merge SAST diff", "Harness-custom + External SAST"],
        ["Reviewer-comments-per-PR", "Drop in human comments per PR (first-pass quality proxy)", "PR comment count via PR API, filtered by Harness-Lane: trailer", "External + Harness trailer"],
        ["Verification tax", "Human review-minutes ÷ agent wall-clock", "PR open→merge ts (PR API) ÷ native claude_code.active_time.total", "Native OTEL + External"],
    ]
    add_table(s, rows, 0.45, 1.20, 9.10, 3.10, col_widths_rel=[2.0, 2.9, 3.9, 2.2])
    add_callout(s, 0.45, 4.45, 9.10, 0.75,
                "Monthly savings $  =  PRs/month × (baseline review hrs − post-harness review hrs) × loaded rate  −  review-agent cost (from native claude_code.cost.usage)\nAnchor: 200 PRs × 1.0 hr saved × $150/hr  =  $30k/month.")

def slide6(prs):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    add_chrome(s, 6, "Two-Layer Architecture", "Native OTEL for standard metrics (reuse) + harness-custom for lane/iteration/contract (build) + external for PR/CI state (join)")
    add_six_cards(s, [
        ("Layer 1: Native OTEL", "CLAUDE_CODE_ENABLE_TELEMETRY=1 (enabled by /scaffold). Exports tokens, cost, sessions, commits, PRs, LOC, tool accept/reject, active time. Cost attribution by model + agent.name + skill.name. → Grafana / Prometheus / Datadog."),
        ("Layer 2: Harness-custom", "record-run.js → .claude/runs/*.jsonl. Fields: lane, mode, iteration, group_id, agent, exit (contract pass/fail). Only concepts with no native OTEL equivalent. Lightweight journal, not a telemetry system."),
        ("Layer 3: External (join via trailer)", "PR merge state, rework rate, reviewer wall-clock, defect-escape — Jira/ADO/GitHub/CI. The Harness-Lane: commit trailer (auto-injected by prepare-commit-msg) is the join key."),
        ("Lane-classify + trailers", "/lane-classify writes .claude/state/current-lane. prepare-commit-msg reads it + mode/iteration/group. Every commit and run-receipt is segmented by lane automatically."),
        ("Brownfield-staleness", "brownfield-staleness.js soft-warns when specs/brownfield/ is >14 days or >50 commits stale. No native equivalent — harness-specific seam/map concepts."),
        ("Contract budgets", "sprint-contract.json: max_iterations + max_files_changed (harness concepts). Token/cost budgets → native claude_code.cost.usage alerts in Grafana instead of duplicating in the contract."),
    ])

def main():
    prs = Presentation()
    prs.slide_width = Inches(SLIDE_W)
    prs.slide_height = Inches(SLIDE_H)
    for fn in (slide1, slide2, slide3, slide4, slide5, slide6):
        fn(prs)
    out = "matrices.pptx"
    prs.save(out)
    print(f"wrote {out} ({TOTAL_SLIDES} slides)")

if __name__ == "__main__":
    main()
