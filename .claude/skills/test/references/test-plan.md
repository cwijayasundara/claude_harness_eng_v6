# `--plan-only` — seams + behavior spec + matrix

Use this when `/test` (or `/test --plan-only`) before application source
exists, or `/build` Phase 3. The review pair is
`test-plan.md` + `verification-matrix.json`. `test-plan.md` is the human
behavior spec: named seams, Given/When/Then scenarios, proposed evaluator
checks, and what is untested. Do not write Playwright files. Do not write AT source files.
Do not write `sprint-contracts/*.json`. Do not write `test-cases.md`.
Do not write `test-data/` fixtures. Do not spawn a nested generator.
Do not load the evaluate skill.

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
  `/design` first unless this is `--in-session`.

## Step 0 — Context Handoff [HARD BLOCK]

```bash
node .claude/scripts/handoff-check.js --phase test
```

Exit 1: this session approved `/design`. Stop and tell the human to `/clear`,
then `/test`. Add `--in-session` only when `/build` is conducting.

## Step 1 — Write the review pair (script first)

```bash
node .claude/scripts/test-plan-write.js
```

It prints a count (`N matrix rows over M stories; K obligations attached`).
Do **not** read `verification-matrix.json`, `test-traces.json`, or the
schemas back into this session. Pass `--force` only when the human asked
to rebuild. `--force` rebuilds the matrix from stories/schemas and merges
reviewed `required_layers` / `checks` / `obligations` by `ac_id`. It does
not overwrite a filled `test-plan.md` unless `--reset-plan` is also passed.

Then edit **`test-plan.md`** only:

- Named **seams** (Ports-and-Adapters) the implementer will test at.
- Empty **Given / When / Then** cells — keep one scenario per matrix AC; do not add extra cases.
- **Observe** on proposed sprint-contract checks (HTTP method/path, or UI steps). Kind is `api` or `playwright` from the matrix.
- What is explicitly **untested**, with a reason.
- Environment assumptions. Pass/fail for the sprint.

**`test-traces.json`** — one entry per matrix row, tracing to `{story}-AC{n}`
and, when `brd-acceptance.json` exists, a `BR-n-AC` / `FR-n-AC` id.

The matrix *is* the case list; the scenario table is that list in Given/When/Then.
Do not invent extra scenarios. Do not write Cucumber or `.feature` files.
Do not edit `specs/stories/`, `features.json`, or `spec-decisions.json`.

## Step 2 — Constraint obligations [when schemas exist]

`test-plan-write.js` already ran `constraints-extract.js` and attached each
`OBL-` to a matrix row / `test-traces.json` entry. Skip this step when
`constraint-obligations.json` exists.

Re-run the extractor only if schemas changed after the matrix was written:

```bash
node .claude/scripts/constraints-extract.js \
  --schemas specs/design/data-models.schema.json \
  --schemas specs/design/api-contracts.schema.json \
  --out specs/test_artefacts/constraint-obligations.json \
  --index-out specs/test_artefacts/obligation-index.json
```

Then `test-plan-write.js --force`. Do not map `OBL-` ids by reading schemas.
Negative-test method lives in `test-design.md`.

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
- Given/When/Then cells still `(fill)`, or scenarios that do not read as the requirement
- Proposed evaluator checks with empty Observe, or api/e2e ACs missing a check
- ACs planned at `unit` only, with no api/e2e evidence
- What you decided not to test, each with a reason

Brief: the behavior scenarios, the proposed evaluator checks, and **what you
decided not to test**. The human is reviewing what "correct" means — variable
rigor by criticality — not unit tests or implementation. Record with
`plan-approval.js`, naming `test-plan.md` and `verification-matrix.json`
on the approving round. In `--auto` / `--autonomous`, waive with `--lane`.

After an approved or waived receipt, freeze the proposed evaluator checks:

```bash
node .claude/scripts/contract-freeze.js
```

That writes `sprint-contracts/{group}.json` and `specs/reviews/contract-freeze.json`.
A non-zero exit means Observe is still `(fill)` or the test gate is not approved.
Do not hand-edit frozen contracts; `/auto` must not negotiate a replacement.

This phase reviews the test plan. A spec/design mismatch is a question, not
an in-phase rewrite. After the human answers, edit only `test-plan.md` and
`verification-matrix.json`. New ACs or story rewrites wait until `/test`
closes, then `/spec`.

**STOP HERE.** Report the three artefacts and exit.
