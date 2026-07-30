# PE IC Memo (PPTX) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a new skill, `.claude/skills/pe-ic-memo/`, that produces a PowerPoint IC memo deck using the same 9-section structure as the installed `private-equity` vertical's `ic-memo` skill, instead of that skill's default Word output.

**Architecture:** A pure Python renderer (`render_deck.py`, no CLI — one function, `build_deck(memo, out_path)`) builds a title slide plus one slide per section via `python-pptx`, with native PPTX tables on the financials/deal-terms/returns sections. `SKILL.md` carries the adapted workflow instructions (content structure reused from the stock `ic-memo` skill) plus a documented, not-yet-built "swap in a firm template later" extension point. The skill is deliberately excluded from `.claude/scripts/scaffold-copy.js`'s `CORE_SKILLS`/`BROWNFIELD_SKILLS` lists.

**Tech Stack:** Python 3 + `python-pptx` (already installed in this environment, version 1.0.2 confirmed). Tests via Node's `node:test`, shelling out to `python3` — matching this repo's existing convention for testing Python scripts (`test/code-index.test.js`), not a new `pytest` runner.

## Global Constraints

- `render_deck.py` exposes exactly one public function: `build_deck(memo: dict, out_path: str) -> str`. No CLI, no `argparse`, no `if __name__ == '__main__'` block — it is imported, not invoked as a standalone script.
- `memo` dict shape (fixed, used identically by the skill's Step 3 instructions, the test helper, and `build_deck` itself):
  ```python
  {
      "title": {"company": str, "deal_name": str, "date": str},
      "sections": [
          {"heading": str, "bullets": [str, ...], "table": {"headers": [str, ...], "rows": [[str, ...], ...]} | None},
          ...
      ],
  }
  ```
- This skill is **not** added to `CORE_SKILLS` or `BROWNFIELD_SKILLS` in `.claude/scripts/scaffold-copy.js` — pinned by a test, not just left alone by omission.
- No firm-template swapping logic is built — only documented in `SKILL.md` as a future manual step (per the approved spec, `docs/superpowers/specs/2026-07-05-pe-ic-memo-design.md`).
- Approved spec: `docs/superpowers/specs/2026-07-05-pe-ic-memo-design.md` (commit `25e71ec`).

---

### Task 1: `render_deck.py` — PPTX renderer + test

**Files:**
- Create: `.claude/skills/pe-ic-memo/scripts/render_deck.py`
- Create: `.claude/skills/pe-ic-memo/scripts/_test_build_sample.py`
- Test: `test/pe-ic-memo-render.test.js`

**Interfaces:**
- Produces: `build_deck(memo: dict, out_path: str) -> str` from `.claude/skills/pe-ic-memo/scripts/render_deck.py`. Task 2 (the `SKILL.md` content) references this function's exact name and the `memo` dict shape above — no other task calls it directly.

- [ ] **Step 1: Write the failing test**

Create `test/pe-ic-memo-render.test.js`:

```js
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { test } = require('node:test');

const repoRoot = path.join(__dirname, '..');
const helper = path.join(
  repoRoot, '.claude', 'skills', 'pe-ic-memo', 'scripts', '_test_build_sample.py'
);

test('build_deck renders a title slide plus one slide per section, with a real table shape on the table section', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-ic-memo-'));
  const outPath = path.join(dir, 'sample.pptx');
  const res = spawnSync('python3', [helper, outPath], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  const summary = JSON.parse(res.stdout);

  assert.strictEqual(summary.slide_count, 3); // title + 2 sections
  assert.deepStrictEqual(summary.titles, ['Acme Corp', 'Executive Summary', 'Financial Analysis']);
  assert.strictEqual(summary.table_dims_by_slide[0], null);
  assert.strictEqual(summary.table_dims_by_slide[1], null);
  assert.deepStrictEqual(summary.table_dims_by_slide[2], { rows: 3, cols: 3 });
});

test('build_deck creates the output directory if it does not exist yet', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-ic-memo-'));
  const outPath = path.join(dir, 'nested', 'deeper', 'sample.pptx');
  const res = spawnSync('python3', [helper, outPath], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  assert.ok(fs.existsSync(outPath));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/pe-ic-memo-render.test.js`
Expected: FAIL — `.claude/skills/pe-ic-memo/scripts/_test_build_sample.py` does not exist (spawnSync fails or python3 raises "No such file")

- [ ] **Step 3: Write `render_deck.py`**

Create `.claude/skills/pe-ic-memo/scripts/render_deck.py`:

```python
"""Render a PE IC memo as a PPTX deck.

memo shape:
{
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

Renders a generic layout using python-pptx's default template: a title slide
followed by one content slide per section. Sections with a `table` also get
a native PPTX table shape. See this skill's SKILL.md "Firm Branding" section
for how a real firm template gets swapped in later -- that swap is not
implemented here.
"""

import os

from pptx import Presentation
from pptx.util import Inches


def _add_title_slide(prs, title):
    slide = prs.slides.add_slide(prs.slide_layouts[0])
    slide.shapes.title.text = title["company"]
    subtitle = slide.placeholders[1]
    subtitle.text = "{} — CONFIDENTIAL — Investment Committee\n{}".format(
        title["deal_name"], title["date"]
    )


def _add_bullets(body_placeholder, bullets):
    tf = body_placeholder.text_frame
    tf.clear()
    tf.text = bullets[0]
    for bullet in bullets[1:]:
        p = tf.add_paragraph()
        p.text = bullet


def _add_table(slide, table_data, top):
    rows = len(table_data["rows"]) + 1
    cols = len(table_data["headers"])
    left = Inches(0.5)
    width = Inches(12.33)
    height = Inches(0.4 * rows)
    shape = slide.shapes.add_table(rows, cols, left, top, width, height)
    table = shape.table
    for c, header in enumerate(table_data["headers"]):
        table.cell(0, c).text = header
    for r, row in enumerate(table_data["rows"]):
        for c, value in enumerate(row):
            table.cell(r + 1, c).text = str(value)


def _add_content_slide(prs, section):
    slide = prs.slides.add_slide(prs.slide_layouts[1])
    slide.shapes.title.text = section["heading"]
    body = slide.placeholders[1]
    if section.get("bullets"):
        _add_bullets(body, section["bullets"])
    else:
        body.text_frame.clear()
    if section.get("table"):
        top = Inches(4.2) if section.get("bullets") else Inches(1.8)
        _add_table(slide, section["table"], top)
    return slide


def build_deck(memo, out_path):
    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)

    _add_title_slide(prs, memo["title"])
    for section in memo["sections"]:
        _add_content_slide(prs, section)

    out_dir = os.path.dirname(out_path)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    prs.save(out_path)
    return out_path
```

- [ ] **Step 4: Write the test helper script**

Create `.claude/skills/pe-ic-memo/scripts/_test_build_sample.py`:

```python
#!/usr/bin/env python3
"""Test helper for pe-ic-memo (not a public entry point): builds a small
sample deck via build_deck, re-opens the real generated file with
python-pptx, and prints a JSON summary for test/pe-ic-memo-render.test.js
to assert against.

Usage: python3 _test_build_sample.py <out_path>
"""

import json
import os
import sys

from pptx import Presentation

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from render_deck import build_deck  # noqa: E402


def _table_dims(slide):
    for shape in slide.shapes:
        if getattr(shape, "has_table", False):
            table = shape.table
            return {"rows": len(table.rows), "cols": len(table.columns)}
    return None


def main():
    out_path = sys.argv[1]

    memo = {
        "title": {"company": "Acme Corp", "deal_name": "Project Falcon", "date": "2026-07-05"},
        "sections": [
            {
                "heading": "Executive Summary",
                "bullets": ["Deal rationale", "Recommendation: Proceed"],
                "table": None,
            },
            {
                "heading": "Financial Analysis",
                "bullets": ["Revenue grew 22% YoY"],
                "table": {
                    "headers": ["Year", "Revenue", "EBITDA"],
                    "rows": [["2024", "$50M", "$10M"], ["2025", "$61M", "$14M"]],
                },
            },
        ],
    }

    build_deck(memo, out_path)

    prs = Presentation(out_path)
    slides = list(prs.slides)
    summary = {
        "slide_count": len(slides),
        "titles": [s.shapes.title.text if s.shapes.title else None for s in slides],
        "table_dims_by_slide": [_table_dims(s) for s in slides],
    }
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test test/pe-ic-memo-render.test.js`
Expected: PASS (both tests)

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/pe-ic-memo/scripts/render_deck.py .claude/skills/pe-ic-memo/scripts/_test_build_sample.py test/pe-ic-memo-render.test.js
git commit -m "feat: add pe-ic-memo PPTX renderer"
```

---

### Task 2: `SKILL.md` workflow + scaffold-copy exclusion pin

**Files:**
- Create: `.claude/skills/pe-ic-memo/SKILL.md`
- Test: `test/pe-ic-memo-skill.test.js`

**Interfaces:**
- Consumes: `build_deck(memo, out_path)` from Task 1 (referenced by name and the fixed `memo` dict shape in the Global Constraints section — do not redefine or rename it here).
- Produces: nothing consumed by a later task — this plan has only 2 code tasks plus a verification task.

- [ ] **Step 1: Write the failing tests**

Create `test/pe-ic-memo-skill.test.js`:

```js
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const repoRoot = path.join(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
}

test('pe-ic-memo SKILL.md has the right frontmatter and references the renderer', () => {
  const skill = read('.claude/skills/pe-ic-memo/SKILL.md');
  assert.match(skill, /^---\nname: pe-ic-memo\n/);
  assert.match(skill, /render_deck\.py/);
  assert.match(skill, /build_deck/);
});

test('pe-ic-memo SKILL.md documents the 9-section structure and the Firm Branding extension point', () => {
  const skill = read('.claude/skills/pe-ic-memo/SKILL.md');
  assert.match(skill, /Executive Summary/);
  assert.match(skill, /Recommendation/);
  assert.match(skill, /Firm Branding/);
  assert.match(skill, /ppt-template-creator/);
});

test('pe-ic-memo is NOT registered in scaffold-copy.js CORE_SKILLS or BROWNFIELD_SKILLS', () => {
  const scaffoldCopy = read('.claude/scripts/scaffold-copy.js');
  const coreMatch = scaffoldCopy.match(/const CORE_SKILLS = \[([\s\S]*?)\];/);
  assert.ok(coreMatch, 'could not find CORE_SKILLS array in scaffold-copy.js');
  assert.doesNotMatch(coreMatch[1], /pe-ic-memo/);
  const brownfieldMatch = scaffoldCopy.match(/const BROWNFIELD_SKILLS = \[([\s\S]*?)\];/);
  assert.ok(brownfieldMatch, 'could not find BROWNFIELD_SKILLS array in scaffold-copy.js');
  assert.doesNotMatch(brownfieldMatch[1], /pe-ic-memo/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/pe-ic-memo-skill.test.js`
Expected: FAIL — `.claude/skills/pe-ic-memo/SKILL.md` does not exist (first two tests); third test passes trivially (nothing to find yet, but written now for TDD discipline and to lock in the constraint going forward)

- [ ] **Step 3: Write `SKILL.md`**

Create `.claude/skills/pe-ic-memo/SKILL.md`:

```markdown
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
- **Not part of the SDLC pipeline.** This skill is not registered in `.claude/scripts/scaffold-copy.js`'s `CORE_SKILLS`/`BROWNFIELD_SKILLS` lists, so it is not copied into projects this harness scaffolds. Copy `.claude/skills/pe-ic-memo/` manually into a project that needs it.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/pe-ic-memo-skill.test.js`
Expected: PASS (all 3 tests)

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/pe-ic-memo/SKILL.md test/pe-ic-memo-skill.test.js
git commit -m "feat: add pe-ic-memo SKILL.md workflow"
```

---

### Task 3: Full verification sweep

**Files:** None created or modified — this task only runs verification across everything Tasks 1-2 touched.

**Interfaces:** None.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including the two new files (`test/pe-ic-memo-render.test.js`, `test/pe-ic-memo-skill.test.js`), with no regressions to the pre-existing suite (1205 tests passing before this plan started).

- [ ] **Step 2: Confirm `python-pptx` is documented, not silently assumed**

Read `.claude/skills/pe-ic-memo/SKILL.md`'s Gotchas section and confirm the `python-pptx` dependency note is present (Task 2, Step 3 already wrote this — this step just double-checks it survived).

- [ ] **Step 3: Manually generate a full 9-section sample deck and open it**

This goes beyond the automated test's 2-section sample — confirm the full 9-section structure renders without error:

```bash
python3 -c "
import sys
sys.path.insert(0, '.claude/skills/pe-ic-memo/scripts')
from render_deck import build_deck

memo = {
    'title': {'company': 'Acme Corp', 'deal_name': 'Project Falcon', 'date': '2026-07-05'},
    'sections': [
        {'heading': 'Executive Summary', 'bullets': ['Deal rationale', 'Recommendation: Proceed'], 'table': None},
        {'heading': 'Company Overview', 'bullets': ['B2B SaaS, 500 employees'], 'table': None},
        {'heading': 'Industry & Market', 'bullets': ['\$10B TAM, 15% CAGR'], 'table': None},
        {'heading': 'Financial Analysis', 'bullets': ['Revenue grew 22% YoY'], 'table': {'headers': ['Year','Revenue','EBITDA'], 'rows': [['2024','\$50M','\$10M'],['2025','\$61M','\$14M']]}},
        {'heading': 'Investment Thesis', 'bullets': ['Margin expansion', 'Buy-and-build'], 'table': None},
        {'heading': 'Deal Terms & Structure', 'bullets': ['8.5x EBITDA entry'], 'table': {'headers': ['Source','Amount'], 'rows': [['Debt','\$60M'],['Equity','\$40M']]}},
        {'heading': 'Returns Analysis', 'bullets': ['Base case 25% IRR'], 'table': {'headers': ['Case','IRR','MOIC'], 'rows': [['Base','25%','2.8x'],['Upside','32%','3.5x']]}},
        {'heading': 'Risk Factors', 'bullets': ['Customer concentration'], 'table': None},
        {'heading': 'Recommendation', 'bullets': ['Proceed'], 'table': None},
    ],
}
out = build_deck(memo, '/tmp/pe-ic-memo-full-sample.pptx')
print('wrote', out)
"
```

Expected: prints `wrote /tmp/pe-ic-memo-full-sample.pptx` with no traceback. Optionally open the file to eyeball it (`open /tmp/pe-ic-memo-full-sample.pptx` on macOS).

- [ ] **Step 4: Final review against the spec**

Re-read `docs/superpowers/specs/2026-07-05-pe-ic-memo-design.md` section by section and confirm each is implemented:
- Architecture / file structure → Task 1 + Task 2
- Content Structure (9 sections, adapted from stock `ic-memo`) → Task 2
- Slide Structure → Task 1 (`render_deck.py`)
- Rendering Approach (`build_deck` signature, `memo` shape) → Task 1
- Firm Branding (documented, not built) → Task 2
- Testing (node:test shelling out to python3, real round-trip) → Task 1
- Out of Scope (not in `CORE_SKILLS`, no template-swap code, no other output format) → Task 2's third wiring test + this task's manual check that no template-swap code was added

No step in this task modifies files — it is a checklist confirmation. If any spec section lacks a corresponding completed task, stop and add a task before considering this plan done.
