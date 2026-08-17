# Lean `/brd --prd` (default)

Use this when `/brd --prd <path>` or `/brd --frd <path>` is invoked **without** `--full`. `/build --auto` and a `/build --lite` escalation onto a PRD use this path.

Goal: adopt a well-formed PRD in minutes, without an interview, analysis pack, or phase evaluator.

## Do not run

- Superpowers brainstorm
- Five-dimension interview
- `brd-render` / `brd-analysis.json`
- Phase evaluator (`brd-eval`) unless the user passed `--eval`
- Invented clarifications beyond the PRD's own Open Questions

## Steps

### 1 — Shape gate

```bash
node .claude/scripts/validate-prd.js <path-to-prd.md>
```

A non-zero exit is not a hard stop. Put structural errors to the human before adopting. Missing acceptance postconditions become a C-n: author them in the PRD now, or accept and let `/spec` write them.

### 2 — Extract + adopt + tag + short BRD

```bash
node .claude/scripts/prd-extract.js <path-to-prd.md> --tag --write-brd
```

Optional `--out-dir specs/brd/sprint-N` for `--delta`.

The script prints counts. It also writes `specs/brd/analysis-seed.json` (domain terms + the PRD's own questions/risks/safeguards — no FR paraphrase). Do not read `frd-requirements.json` or the seed back into the session; `/spec` consumes the seed from disk.

### 3 — Open questions only

Read `specs/brd/brd-open-questions.json`.

- **Interactive:** ask those questions (cap 10). Record answers in `clarification-log.json` with `basis: "user decision"`. Then re-run:

```bash
node .claude/scripts/brd-lean-write.js --source <path-to-prd.md>
node .claude/scripts/analysis-seed.js
node .claude/scripts/phase-cost.js --write --step brd-clarifications
```

  so `brd.md` lists the answers, `analysis-seed.json` picks up clarification risks, and the step bill is logged.
- **Headless (`/build --auto`, `--lite --auto`):** do not invent answers. Leave the questions open. Do not add C7–C10-style net-new scope.

Do not invoke the full `clarify` interview budget on lean `--prd`.

### 4 — Hard gates

```bash
node .claude/skills/brd/scripts/grounding-check.js \
  --frd specs/brd/frd-requirements.json \
  --clarifications specs/brd/clarification-log.json \
  --brd specs/brd/brd-adoption.json \
  --out specs/reviews/brd-grounding.json

node .claude/scripts/brd-taxonomy-check.js \
  --requirements specs/brd/brd-requirements.json \
  --coverage specs/brd/taxonomy-coverage.json \
  --out specs/reviews/brd-taxonomy.json

node .claude/scripts/brd-adopt.js --verify
```

Both grounding and taxonomy must pass. `--verify` must exit 0.

```bash
node .claude/scripts/phase-cost.js --write --step brd-gates
```

### 5 — Approval

`plan-review-loop` with `--phase brd`. Brief is `brd.md` (≤80 lines) + `brd-requirements.json`. In `--auto` / `--autonomous`, waive with `--lane` instead of interviewing.

On approval:

```bash
node .claude/scripts/phase-cost.js --write --step brd-approval
```

Then `/clear` before `/spec` (except when `/build` is conducting in-session). The Stop hook also writes the same rollup to `.claude/state/phase-cost.json`.

## `--eval`

After Step 4, if and only if the user passed `--eval`, run SKILL.md Step 4.5. Auth in the PRD is not enough.
