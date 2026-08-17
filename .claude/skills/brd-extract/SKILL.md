---
name: brd-extract
description: "[Internal pipeline stage — dispatched only as a fallback when prd-extract.js cannot parse a source document. Prefer `node .claude/scripts/prd-extract.js`.] Extract the source document's requirement spine into frd-requirements.json, adopt it deterministically, and return counts only."
argument-hint: "--prd <path> | --frd <path> [--sprint N]"
context: fork
agent: generator
---

# BRD Extract — Requirement Spine (sidekick)

Prefer the script. This skill exists for a document `prd-extract.js` cannot
parse (no `FR-`/`NFR-` bullets). On a canonical PRD, `/brd` runs the script
in the main session and never dispatches this fork.

```bash
node .claude/scripts/prd-extract.js <path-to-prd.md> --tag --write-brd
```

Add `--out-dir specs/brd/sprint-N` when `--sprint N` was passed.

## Return counts, not content

Return **only** the script's stdout (counts). Do not restate requirements,
quote the document, or invoke `/clarify`. Copy requirement text **verbatim**.
Adoption leaves `taxonomy: null` on every requirement until `brd-taxonomy-tag.js`
runs.

## If the script exits non-zero with an empty spine

Then and only then transcribe by hand into `specs/brd/frd-requirements.json`
using these section labels (brd-adopt routes by them):

| Source content | `section` must look like |
|---|---|
| A requirement | `4. Functional Requirements / FR-2` |
| Its acceptance postcondition | `6. Acceptance / FR-2 AC` |
| Out of Scope / Non-goals | `7. Out of Scope` |
| Open Questions | `10. Open Questions` |
| Risks | `9. Risks` |

Copy the document to `specs/brd/source-frd.md` first. Do not paraphrase.
Then `node .claude/scripts/brd-adopt.js`. Taxonomy stays `null` unless you
also run `brd-taxonomy-tag.js`.

A postcondition labelled anything other than `<id> AC` is adopted as a requirement
— which inflates the spine and leaves the real requirement with no oracle.

## Gotchas

- **Never invoke `/clarify`.** A forked skill cannot reach the human.
- **Do not write `brd-analysis.json`.** That is `--full` / `brd-render` only.
