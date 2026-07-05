# PE IC Memo — PPTX Skill

**Date:** 2026-07-05
**Goal:** Give the user a firm-usable investment committee memo skill that outputs a branded PowerPoint deck, built on top of the already-installed `private-equity` vertical's `ic-memo` skill rather than replacing it.

## Motivation

The user works with a PE client and already has the official `financial-analysis` and `private-equity` vertical plugins installed (from `anthropics/financial-services` via the `claude-for-financial-services` marketplace). The stock `ic-memo` skill (`~/.claude/plugins/cache/claude-for-financial-services/private-equity/0.1.2/skills/ic-memo/SKILL.md`) already covers the right content — a 9-section IC memo structure — and outputs a Word `.docx` by default. The gap is output format: the user's firm needs the memo as a branded PowerPoint deck, not a Word document, and wants this as a standalone skill living in this harness repo rather than a one-off edit to the installed plugin.

No firm-branded `.pptx` template exists yet, so this skill ships with a clean generic layout now and documents (but does not build) the swap-in path for a real firm template later.

## Scope

- New skill `.claude/skills/pe-ic-memo/` in this repo (`claude_harness_eng_v5`), reusing the stock `ic-memo` skill's input-gathering and 9-section content structure, with a PPTX rendering step replacing the stock skill's Word output.
- Generic, professional PPTX layout: title slide + one slide per section, with native PPTX tables for financials/deal-terms/returns.
- A documented (not implemented) extension point for swapping in a firm-branded template once one exists, via the already-installed `ppt-template-creator` skill.
- A smoke test that runs the real rendering script and opens the real generated `.pptx` with `python-pptx` to assert structure.

Out of scope (see below): auto-detecting/swapping a firm template, registering this skill in `CORE_SKILLS`/`scaffold-copy.js`, building any UI or non-PPTX output format, touching the installed plugin's own files.

## Architecture

```
.claude/skills/pe-ic-memo/
├── SKILL.md              # workflow instructions (adapted from ic-memo) + Firm Branding note
├── scripts/
│   └── render_deck.py    # python-pptx renderer: takes structured memo content -> .pptx
└── assets/
    └── (empty for now — a firm .pptx template lands here once ppt-template-creator produces one)
```

This is a content skill, not part of the SDLC pipeline — it is **not** added to `CORE_SKILLS`/`BROWNFIELD_SKILLS` in `.claude/scripts/scaffold-copy.js`, so it does not get copied into every project this harness scaffolds. It lives in this repo for reuse across the user's own PE-related work; copying it into a specific client project's `.claude/skills/` is a manual step, same as any skill not on the universal list.

## Content Structure (unchanged from stock `ic-memo`)

Steps 1 (Gather Inputs) and 2 (Memo Structure) in `SKILL.md` are adapted directly from the stock skill — same 9 sections, same required inputs (company overview, financials, deal terms, DD findings, value-creation plan, returns scenarios). `SKILL.md` states plainly that this skill is a PPTX-output sibling of the installed `ic-memo` skill, not a fork of its judgment/content logic — if the stock skill's content guidance changes upstream, this skill's Step 1/2 should be manually kept in sync (documented as a Gotcha, not automated).

## Slide Structure

`render_deck.py` produces one deck with this slide sequence:

1. **Title** — company name, deal name, "CONFIDENTIAL — Investment Committee", date
2. **Executive Summary**
3. **Company Overview**
4. **Industry & Market**
5. **Financial Analysis** — historical financials as a native PPTX table (revenue/EBITDA/margins/FCF by year)
6. **Investment Thesis**
7. **Deal Terms & Structure** — sources & uses as a native PPTX table
8. **Returns Analysis** — base/upside/downside IRR/MOIC as a native PPTX table
9. **Risk Factors**
10. **Recommendation**

Each content slide uses a simple, consistent layout: title placeholder + body text/bullets, with the three data-heavy slides (5, 7, 8) additionally carrying a `python-pptx` table shape.

## Rendering Approach

`scripts/render_deck.py` takes structured memo content (a Python dict — one key per section, defined inline in the script's docstring so the invoking agent knows the exact shape to build) and produces the deck with plain `python-pptx`, no external template for now:

```python
from pptx import Presentation
from pptx.util import Inches, Pt

def build_deck(memo: dict, out_path: str):
    prs = Presentation()  # blank default template
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)

    _add_title_slide(prs, memo["title"])
    for section in memo["sections"]:
        _add_content_slide(prs, section)

    prs.save(out_path)
```

`memo["sections"]` is a list of `{ "heading": str, "bullets": list[str], "table": {"headers": [...], "rows": [[...]]} | None }` — the agent invoking this skill builds this structure from the gathered inputs before calling the renderer. `_add_content_slide` adds a table shape only when `table` is present (sections 5, 7, 8); other sections render as a title + bullet list.

## Firm Branding (documented extension point, not built)

`SKILL.md` includes a short section stating:

> This skill currently renders a generic layout. Once the firm's actual PowerPoint template is available: run the `ppt-template-creator` skill on it to produce a `<firm>-ppt-template` skill (it documents the template's layout indices and placeholder positions). Then update `render_deck.py`'s `build_deck` to load `Presentation("path/to/<firm>-ppt-template/assets/template.pptx")` instead of a blank `Presentation()`, and map `memo["sections"]` onto that template's documented layout indices instead of the generic `_add_content_slide` helper. This is a rendering-layer swap only — Steps 1/2 (content gathering and structure) do not change.

No template-detection code, no config flag, no conditional branching for "if a firm template exists" is built now — there is nothing to test it against yet, and it would be speculative.

## Testing

This repo has no `pytest`/`unittest` convention — its existing Python scripts (`.claude/skills/code-map/scripts/code_index/*.py`) are tested from `node:test` files that shell out to `python3` via `execFileSync` (e.g. `test/code-index.test.js`). Follow that same convention rather than introducing a new Python test runner.

Add `test/pe-ic-memo-render.test.js`:

- Write a small helper script `.claude/skills/pe-ic-memo/scripts/_test_build_sample.py` that imports `build_deck` from `render_deck.py`, builds a small sample `memo` dict (2-3 sections, one with a `table`), calls `build_deck` to a path passed via `sys.argv`, then re-opens that file with `python-pptx`'s `Presentation(path)` and prints a JSON summary (slide count, each slide's title text, whether the table slide has a table shape with the right row/column count) to stdout.
- The `node:test` file invokes this helper via `execFileSync('python3', [...])` against a temp output path, parses the JSON stdout, and asserts on it — mirroring `code-index.test.js`'s pattern of shelling out to Python and asserting on its output.

This round-trips the real renderer and the real `python-pptx` reader — no hand-built fixture standing in for the actual file format.

## Risks

- **Content drift from the stock `ic-memo` skill.** If the installed plugin's `ic-memo` content guidance is updated upstream, this skill's Steps 1/2 won't automatically follow. Documented as a Gotcha in `SKILL.md`: check the installed `ic-memo` skill's content sections periodically and hand-port relevant changes.
- **Generic layout may not satisfy IC reviewers' expectations for "looks branded."** Acceptable for now — it is explicitly a placeholder until a real template exists, not a final deliverable.
- **`python-pptx` availability.** This repo's tooling is otherwise Node-based; `SKILL.md` should note the `python-pptx` dependency explicitly and that the invoking agent should confirm it's installed (`pip install python-pptx`) before running the renderer, rather than assuming it silently.

## Out of Scope

- Registering this skill in `CORE_SKILLS`/`BROWNFIELD_SKILLS` or any new opt-in domain-skill-pack registry — revisit only if the user scaffolds multiple PE-client projects from this harness and wants it auto-included.
- Building the firm-template swap logic itself (see Firm Branding above).
- Any output format other than `.pptx`.
- Modifying the installed `private-equity` plugin's own files.
