# `--plan-only` — seams + matrix

Use this when `/test --plan-only` (or `/build` Phase 3). The review pair is
`test-plan.md` + `verification-matrix.json`. Do not write Playwright. Do not
write AT source files. Do not write `test-cases.md`. Do not write `test-data/`
fixtures. Do not spawn a nested generator. Do not load the evaluate skill.

**The matrix is a script, not an LLM job.** A forked generator writing 23
rows by hand is what billed ~200K tokens on a 6-story API.

## Prerequisites

- `specs/stories/` with ready stories. Orient with:

```bash
node .claude/scripts/phase-digest.js --phase test
```

Do **not** read `acceptance-criteria.json` whole. The digest lists AC count and
ids by story. Read one `E*-S*.md` only when a matrix row turns on that wording.

- `node .claude/scripts/plan-approval.js check --phase spec` must exit 0.
  This gates on `spec`, not `design`, because `/build` Phase 3 can run both.

- If `handoff-check` printed a design-not-rendered warning, prefer
  `/design --render-only` first unless this is `--in-session`.

## Step 0 — Context Handoff [HARD BLOCK]

```bash
node .claude/scripts/handoff-check.js --phase test
```

Exit 1: this session approved `/design`. Stop and tell the human to `/clear`,
then `/test --plan-only`. Add `--in-session` only when `/build` is conducting.

## Step 1 — Write the review pair (script first)

```bash
node .claude/scripts/test-plan-write.js
```

It prints a count (`N matrix rows over M stories`). Do **not** read
`verification-matrix.json` or `test-traces.json` back into this session.
Pass `--force` only when the human asked to rebuild.

Then edit **`test-plan.md`** only:

- Named **seams** (Ports-and-Adapters) the implementer will test at.
- What is being tested and what is explicitly **untested**, with a reason.
- Test levels planned (`unit`, `api`, `e2e` only when a UI story exists).
- Environment assumptions. Pass/fail for the sprint.

**`verification-matrix.json`** — one row per AC: stable `matrix_id`, story/AC
refs, `required_layers`, group, `implementation_paths` (empty if design has
not rendered), planned checks.

**`test-traces.json`** — one entry per matrix row, tracing to `{story}-AC{n}`
and, when `brd-acceptance.json` exists, a `BR-n-AC` / `FR-n-AC` id.

Do not invent a prose case catalog. The matrix *is* the case list.

## Step 2 — Constraint obligations [when schemas exist]

Skip silently when `specs/design/*.schema.json` is absent.

```bash
node .claude/scripts/constraints-extract.js \
  --schemas specs/design/data-models.schema.json \
  --schemas specs/design/api-contracts.schema.json \
  --out specs/test_artefacts/constraint-obligations.json \
  --index-out specs/test_artefacts/obligation-index.json
```

Each `OBL-` must appear on a matrix row / `test-traces.json` entry. One
representative negative per obligation — method in `test-design.md`.

## Step 3 — Grounding + matrix gates [HARD BLOCK]

```bash
node -e "const fs=require('fs');const s=JSON.parse(fs.readFileSync('specs/stories/story-traces.json'));fs.writeFileSync('specs/test_artefacts/ac-index.json',JSON.stringify(s.flatMap(x=>(x.acs||[]).map(id=>({id})))))"

node .claude/scripts/trace-check.js \
  --required specs/test_artefacts/ac-index.json \
  --downstream specs/test_artefacts/test-traces.json \
  --layer test \
  --out specs/reviews/test-grounding.json

node .claude/scripts/verification-matrix-gate.js --phase plan
node .claude/scripts/bundle-write.js
```

Pass `--required specs/test_artefacts/obligation-index.json` only when Step 2
ran. Skip the grounding command when `story-traces.json` does not exist.

When `.claude/state/current-sprint` is set:

```bash
SPRINT=$(cat .claude/state/current-sprint)
mkdir -p specs/test_artefacts/sprint-$SPRINT
cp specs/test_artefacts/verification-matrix.json specs/test_artefacts/sprint-$SPRINT/verification-matrix.json
cp specs/test_artefacts/test-traces.json specs/test_artefacts/sprint-$SPRINT/test-traces.json 2>/dev/null || true
node .claude/scripts/matrix-append.js --incoming specs/test_artefacts/sprint-$SPRINT/verification-matrix.json --sprint $SPRINT
```

## Step 4 — Phase eval [`--eval` only]

If and only if the invocation includes `--eval`, read `test-eval.md` and run
it. Auth in the stories is not enough.

## Step 5 — Human review [REQUIRED SUB-SKILL: `plan-review-loop`]

This skill is forked. Prepare the brief and **return it to the caller**.
`/build` runs `--phase test` after the agent returns. Standalone, do not
answer your own questions.

**Challenge sources for this phase:**

- `specs/reviews/test-grounding.json` and `verification-matrix-verdict.json`
- `constraint-obligations.json` when Step 2 ran
- ACs planned at `unit` only, with no api/e2e evidence
- What you decided not to test, each with a reason

Brief: which ACs at which layer, and **what you decided not to test**. Record
with `plan-approval.js`, naming `test-plan.md` and `verification-matrix.json`
on the approving round. In `--auto` / `--autonomous`, waive with `--lane`.

**STOP HERE.** Report the three artefacts and exit.
