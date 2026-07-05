---
name: pe-ic-memo
description: Draft a private equity investment committee memo and render it as a branded PowerPoint deck. Adapted from the installed private-equity vertical's ic-memo skill (same 9-section structure), with PPTX output instead of Word. Use when preparing IC materials, writing up a deal, or creating a formal recommendation as a deck rather than a document. Triggers on "write IC memo deck", "PE IC memo PowerPoint", "IC deck", or "investment committee deck".
---

# PE IC Memo (PPTX)

This skill is a PPTX-output sibling of the installed `private-equity` vertical's `ic-memo` skill. The content-gathering and structure (Steps 1-2 below) are adapted from that skill; only the rendering step differs. If the installed `ic-memo` skill's content guidance changes upstream, this file will not automatically follow — see Gotchas.

## Workflow

### Step 1: Gather Inputs

Collect from the user (or from prior analysis in the session):

- Company overview and business description
- Industry/market context
- Historical financials (3-5 years)
- Management assessment
- Deal terms (price, structure, financing)
- Due diligence findings (commercial, financial, legal, operational)
- Value creation plan / 100-day plan
- Returns analysis (base, upside, downside)

### Step 2: Structure the Memo

Build a `memo` dict with this exact shape (this is what `scripts/render_deck.py`'s `build_deck` consumes):

```python
memo = {
    "title": {"company": str, "deal_name": str, "date": str},
    "sections": [
        {
            "heading": str,
            "bullets": [str, ...],
            "table": {"headers": [str, ...], "rows": [[str, ...], ...]} | None,
        },
        ...
    ],
}
```

Use these 9 sections, in order (same structure as the stock `ic-memo` skill):

1. **Executive Summary** — company description, deal rationale, key terms, recommendation, headline returns, top 3 risks
2. **Company Overview** — business description, products/services, customer base, competitive positioning, management team
3. **Industry & Market** — market size/growth, competitive landscape, secular trends, regulatory environment
4. **Financial Analysis** — historical performance (revenue, EBITDA, margins, cash flow); include a `table` with years as rows
5. **Investment Thesis** — 3-5 pillars, value creation levers, 100-day priorities
6. **Deal Terms & Structure** — enterprise value/multiples, sources & uses, capital structure; include a `table` for sources & uses
7. **Returns Analysis** — base/upside/downside scenarios, IRR/MOIC, key assumptions; include a `table` for the scenarios
8. **Risk Factors** — key risks ranked by severity/likelihood, mitigants, deal-breakers
9. **Recommendation** — Proceed / Pass / Conditional proceed, key conditions or next steps

Only sections 4, 6, and 7 need a `table`; all others should set `"table": None`.

### Step 3: Render the Deck

`render_deck.py` exposes one function, no CLI: `build_deck(memo: dict, out_path: str) -> str` (returns `out_path`; creates the output directory if it doesn't exist). Call it directly from a short inline Python invocation with the `memo` dict from Step 2:

```python
import sys
sys.path.insert(0, ".claude/skills/pe-ic-memo/scripts")
from render_deck import build_deck

build_deck(memo, "specs/ic-memos/<deal-name>.pptx")
```

## Firm Branding (not yet built)

This skill currently renders a generic layout via `python-pptx`'s default template — no firm branding yet. Once the firm's actual PowerPoint template is available:

1. Run the `ppt-template-creator` skill on it to produce a `<firm>-ppt-template` skill (documents the template's layout indices and placeholder positions).
2. Update `render_deck.py`'s `build_deck` to load `Presentation("path/to/<firm>-ppt-template/assets/template.pptx")` instead of a blank `Presentation()`, and map `memo["sections"]` onto that template's documented layout indices instead of the generic `_add_content_slide` helper.

This is a rendering-layer swap only — Steps 1-2 above do not change.

## Gotchas

- **Requires `python-pptx`.** Confirm it's installed (`pip install python-pptx`) before running the renderer — do not assume it's present.
- **Content drift from the stock `ic-memo` skill.** Steps 1-2 above are adapted from `private-equity`'s `ic-memo` skill, not generated from it. If that skill's content guidance changes upstream, this file will not automatically follow — periodically diff against the installed skill's `SKILL.md` and hand-port relevant changes.
- **Not part of the SDLC pipeline.** This skill is not registered in `.claude/scripts/scaffold-copy.js`'s `CORE_SKILLS`/`BROWNFIELD_SKILLS` lists, so it is not copied under the default `core` or `brownfield` scaffold profiles. (The `full` profile copies the entire skills tree wholesale, so it would be included there.) Copy `.claude/skills/pe-ic-memo/` manually into a project on the lean profiles.
