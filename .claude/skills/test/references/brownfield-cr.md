# `--from-cr` — brownfield change-request lane

The greenfield lane grounds tests against story ACs. This lane grounds them
against a **change request** over existing code: pin behavior that must stay,
and prove behavior that must change.

**Prerequisites:** existing source; `specs/brownfield/code-graph.json` (run
`/code-map` or `/brownfield` if absent). The CR is a markdown file, or a
GitHub issue: `gh issue view N --json title,body -q '.title + "\n\n" + .body' > specs/changes/cr-N.md`.

Work under `specs/test_artefacts/cr-<id>/`.

## CR1 — CR acceptance index [HARD BLOCK if empty]

```bash
node .claude/scripts/cr-index.js --cr specs/changes/cr-<id>.md --out specs/test_artefacts/cr-<id>/cr-acceptance.json
```

If empty, STOP — route to `/clarify` before writing tests.

## CR2 — Blast radius

Run `/seam-finder "<cr goal>"` and `checking-coverage-before-change` on the
symbols the CR touches.

## CR3 — Regression-pin set

Write `regression-pins.md`:

- **UNCOVERED** at a usable seam: `pinning-down-behavior`, then
  `mutation-smoke.js --files <seam-file> --test-cmd "<pin test cmd>"`.
- **COVERED:** list existing oracle tests that must stay green.
- **UNCOVERED, no usable seam:** `sprouting-instead-of-editing`.

## CR4 — Delta test plan

Apply `test-design.md` to each CR acceptance line. If the CR changes a schema,
run `constraints-extract.js` and cover every new `OBL-`. Write
`delta-test-cases.md` and `delta-traces.json` (each case → `CR-AC{n}`).

## CR5 — Delta grounding [HARD BLOCK]

```bash
node .claude/scripts/trace-check.js \
  --required specs/test_artefacts/cr-<id>/cr-acceptance.json \
  --downstream specs/test_artefacts/cr-<id>/delta-traces.json \
  --layer cr \
  --out specs/reviews/cr-grounding.json
```

`/change` then implements test-first against this set.
