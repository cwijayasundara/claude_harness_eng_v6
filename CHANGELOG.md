# Changelog

All notable changes to the Claude Harness Engine are documented here.

## Unreleased

### `/design` and `/test` are the operator commands (2026-08-19)

`--render-only` and `--plan-only` are aliases, not separate phases. After
`/clear`, type `/design` and `/test`. `--render-only` still runs the
human gate (`mode-13-gate.md`); a render that stopped at the deterministic
checks left `/auto` blocked with no `design-approval.json`. Unflagged
`/design` with decisions on disk takes the next unfinished hop (render, or
the gate when `architecture.md` already exists). Unflagged `/test` is the
plan hop when no application source exists; `--e2e-only` is the Playwright
hop after source exists.

### `/test` writer preserves reviewed state (2026-08-19)

A shortlink-p3 `/test` run finished the matrix in ~4 minutes, then spent
more than an hour remapping 65 `OBL-` ids by hand. `test-plan-write.js`
now extracts schema obligations, attaches each `OBL-` to a matrix row,
fills `implementation_paths` from `design-traces.json`, and tags extra
layers from AC wording. `--force` rebuilds that spine and merges reviewed
`required_layers` / `checks` / `obligations` by `ac_id`; it does not wipe
`test-plan.md` unless `--reset-plan` is passed. The model fills seams and
the untested table only. `/test` does not edit `specs/stories/` or
`features.json`.

### SSDD join sensors are catalog-enforced (2026-08-19)

Skipping `/auto` SECTION 5 no longer skips the generate sensors.

- `GATE_CATALOG` now includes `generation-contract`, `story-bundle-check`,
  `canvas-sync-check`, and (when `claude-progress.txt` has `current_group`)
  G16 `impact-scoped-regression`. Same list as the git hook.
- `node .claude/scripts/spdd-sync.js --write` is the `/spdd-sync` rewrite:
  applies Canvas Governs/Operations stubs and bundle ownership, then
  reports remaining issues. Report-only without `--write`.
- `--once` on the last wave (every feature passing) runs G15 + the evaluator
  before exiting, instead of skipping SECTION 11 verification.

### `/auto` generate is SSDD-wired (2026-08-19)

`/auto` is `/spdd-generate`: execute implementable `specs/bundles/{id}.json`,
not a second pass over `E*-S*.md` / `brd.md`. Doctrine in
`plan-review-loop/references/ssdd.md`.

- Sprint contracts and teammate prompts take ACs / owned files / matrix ids
  from the bundle. Generation Contracts persist (`--mode implementable`)
  before spawn.
- Per-group ratchet now runs the SSDD join sensors after `story-sync`:
  `validate-generation-contract.js`, `bundle-check.js`, `canvas-sync-check.js`.
  `run-gate-checks.js` still owns `GATE_CATALOG` (secrets, types, coverage,
  stub-smell, …; cycle/hub/clone/mutation on `strict`).
- Sequential `/auto` was skipping G15 (`regression-gate.js --replay`) because
  that sweep lived only on the parallel `WAVE_BASE` merge. It now runs when
  a passing group lands on trunk after a prior group, and again before the
  draft PR if the verdict is missing.
- Amendments edit `design-decisions.json` / Canvas / bundles first, then
  transcribed `api-contracts.md`.

### SSDD on the human planning gates (2026-08-19)

Structured Story-Driven Development is the harness's SPDD adaptation: the
**story bundle** is the first-class artifact, not a prompt file. Doctrine lives
in `plan-review-loop/references/ssdd.md`.

- **`/spec` is now a progressive index** (shape / render / review). Entry
  under the 80-line budget; same-session render still requires `/clear` then
  `--render-only`.
- **`/scaffold` wizard is on-demand.** Infer + confirm stay in the command;
  Step 1.E moved to `commands/references/scaffold-wizard.md`.
- **Review is of the structured record.** Lean surface now includes Generation
  Contracts, `reasons-canvas.md`, and `specs/bundles/`. `plan-review-loop`
  requires *fix the record first, then re-render*.
- **`spec-render-write.js` writes skeleton bundles**; `/design` re-joins after
  the Canvas so Structure/owned files land before `/test`.
- **`design-render` orients from `stories.json`**, not every `E*-S*.md`.

### Front-half cost leaks closed (2026-08-18)

- **`/spec` mid-phase `/clear`.** After `validate-spec-decisions.js`, stop → `/clear` → `/spec --render-only`. Same-session render is only for `/build --in-session`.
- **`/design` shaping.** Superpowers brainstorm is `--brainstorm` or `ceremony: full` only. Render/gates live in `mode-10-render-and-gates.md`. Long `chosen`/`rules_out`/`rationale` warn, do not fail.
- **`/brd` is an index.** Lean `--prd` loads `prd-lean.md` only; interview/delta moved to references.
- **Product default `execution.ceremony` is `trimmed`** for web-app and api-service.
- Shortened always-on descriptions on `code-map`, `fastapi-code`, `promote`, `retro`, `writing-acceptance-tests-first`, `checking-migration-safety`.

### `/test --plan-only` must not fork a generator (2026-08-18)

A 6-story API billed **~200K tokens** on `/test` because the skill was
`context: fork` + `agent: generator` and the scaffolded project still had the
485-line procedure. Plan-only now runs in the main session. `test-plan-write.js`
emits the matrix, traces, and a skeleton plan from `story-traces.json` in one
process. The model fills seams and the untested table only.

### Lean `/design` + `/test --plan-only` (2026-08-18)

Phase-eval is **`--eval` only**. Auth, tenant, migration, or a trust boundary
no longer auto-spawns the artefact evaluator (that is what made shortlink-p3's
`/test` write an 11 KB `phase-test-eval.json` for a 6-story API).

`/test` is a progressive index. `--plan-only` loads `references/test-plan.md`
and writes the review pair (`test-plan.md` + `verification-matrix.json` +
`test-traces.json`). It does not write `test-cases.md`, fixtures, Playwright,
or AT source, and it does not spawn a nested generator. `handoff-check --phase
test` warns when `design-decisions.json` exists but `architecture.md` does not.
`phase-digest.js --phase test` lists AC ids by story.

### Planning path: fewer turns, less cache (2026-08-18)

`/clear` between phases is necessary but not sufficient. Cache-read cost is **turn count × prefix size** inside the phase. The shortlink-p3 run spent ~$10 and 52 minutes on `/scaffold`+`/brd`+`/spec` mostly re-billing a 1,082-line scaffold command and a 650-line spec-render skill.

- **`/scaffold` is confirm → `scaffold-apply.js` → report.** Apply now writes module `CLAUDE.md`, `CODEBASE_MAP.md`, mutation starters, model-tier pins, git hooksPath, and `docs/`. Command file 1082 → ~210 lines. Generation contract lives in `commands/references/scaffold-generation.md`.
- **`spec-render-write.js`** expands `stories.json` into story files, features, traces, clusters. The renderer writes one index and runs one bash block. Load/crypto ACs get `verification: "characterization"`.
- **`fill-spec-scope.js` + `requirements_in_scope` gate.** The renderer must not invent or patch the milestone set.
- **`/status`** reads planning approvals. A spec-approved project is phase `spec` / `on_track`, not `Run /brd` / `failing` on the 80% coverage seed.
- **Cluster warning** when a `contract` edge is cancelled by a hard edge (the D4 "two clusters" that became C1).

### Story bundles — structured story-driven execution (2026-08-17)

- **`specs/bundles/{id}.json`** is the per-story execution contract: a deterministic join of ACs, generation contract, component-map ownership, verification-matrix rows, and originating BRD acceptance ids. Not a prompt library.
- **`bundle-write.js` / `bundle-check.js`** emit and gate the join. `/build` writes bundles before `plan-seal`. `/implement` and `/auto` hard-block on `--mode implementable`. `/test` must trace each case to the story AC **and** a `brd-acceptance.json` id when that spine exists.
- Sealed `/auto` pack includes `specs/bundles/`. Control budget 166 → 168 (`story-bundle` + `story-bundle-check`).
- **P1 close the loop.** `/story-sync` (`story-sync.js --write`) pushes refactor-only file moves back into the bundle + Canvas `Governs`. AC drift fails closed. `/change` and `/implement` run it after code. Sprint `/test` writes `specs/test_artefacts/sprint-N/` and `matrix-append.js` merges into the living matrix (changed ACs become `VM-id@sN`, never deleted).
- **P2 team surface.** `tracker-body.js` renders the bundle as the Jira/ADO/Linear issue body. `publish-to-ado.js` creates or PATCHes Azure DevOps work items. Jira re-publish updates in place. `/sprint` publishes at story granularity. `/status` shows bundle count and last-sync age.

### `/spec` produces the story graph in one invocation (2026-08-17)

- **`/spec` no longer hard-stops after `spec-decisions.json`.** The same run dispatches `spec-render` and is not finished until `specs/stories/` has epics, stories, and the dependency graph. `--render-only` is a re-expand flag, not a required second hop.
- **`phase-digest.js --phase spec` prints `NEXT` (`shape` | `render` | `review`)** so a later session cannot treat an empty `specs/stories/` as "shaping never happened".
- Same-session render is allowed for `/spec`. `/design` still uses the `/clear` then `--render-only` checkpoint.

### Per-step token and cost log (2026-08-16)

- **`phase-cost.js --write [--step NAME]`** persists the transcript bill to `.claude/state/phase-cost.json` and an append-only `.claude/state/phase-cost.jsonl` (delta vs last persist). The `record-run` hook writes this on every UserPromptSubmit / Stop / SubagentStop so `/brd`, `/spec`, `/design`, `/implement`, and `/gate` each leave a labeled step row without a collector or OTEL.
- **`/status` Cost line no longer waits for `/auto`'s `budget-start`.** Planning phases show the transcript rollup; a Phases line lists `$` per slash command.
- **Lean BRD:** clarification answers that record a risk now appear in `brd.md` Risks and in `analysis-seed.json` (re-seed after the open-question answers). The shortlink-p3 run had C2/C3 as risks that vanished from the seed.

### 6.0.0 — Lean `/brd --prd` (2026-08-16)

- **Default `--prd` / `--frd` is adopt-only.** `prd-extract.js` + `brd-adopt.js` + `brd-taxonomy-tag.js` + `brd-lean-write.js` replace the LLM extract fork, five-dimension interview, `brd-analysis.json`, and auto phase-eval. `brd.md` is a ≤80-line pointer. Opt into the old ceremony with `--full`; prose eval only with `--eval`.
- **Lean analysis seed + story generation contract.** `analysis-seed.js` writes `specs/brd/analysis-seed.json` on adopt (domain terms + the PRD's own questions/risks/safeguards — no FR paraphrase). Each ready story carries a `## Generation Contract`; `validate-generation-contract.js --mode skeleton` runs at spec-render, `--mode implementable` at `/implement` and `/change` (Operations must name files). System REASONS Canvas stays the constitution; the contract is the per-change delta prompt.
- **`/build --auto` and `/build --lite` escalation** call lean `/brd --prd`. Exceeding lite caps (auth, DB, >5 stories) still escalates to the full pipeline, but that pipeline no longer runs interview-shaped BRD or 99k-token eval.

### 2.4.0 — Bun Phase C (optional polish) (2026-07-12)

- **Semantic-divergence checklist:** `.claude/skills/code-gen/references/semantic-divergence.md`; `code-reviewer` lens for mechanical ports; wired into `/refactor --mechanical` + migrate `MAPPING.md`.
- **Review commit attribution:** `review-commit-msg.js` formats subjects from dual-review audit JSON (optional; audit remains source of truth).
- **Dynamic workflow exemplar:** `.claude/workflows/fix-diagnostics.js` (`/fix-diagnostics`) — multi-phase fan-out over the diagnostics queue; documents “edit the workflow / process-rules, not only the tree.” Skill form still primary.
- **Out of core (documented):** fuzz→auto-PR and cgroup isolation — see `docs/proposals/bun-phase-c-out-of-core.md`.

### 2.3.0 — Bun mechanical loops Phase B (2026-07-12)

- **Diagnostics work queue:** `hooks/lib/diagnostics-parse.js` + `diagnostics-shard.js` → `.claude/state/diagnostics/{errors.jsonl,shards.json}`; skill `fix-from-diagnostics` (no full-suite mid-shard). Wired into `/implement` Step 6 and `/auto` SECTION 6 self-heal for high-volume lint/type walls (≥~15 findings).
- **Canary generalization:** `/implement` Step 0.5 (group owns >~10 files or mechanical plan); `/feature` first ready story as canary for epics; G32 still on refactor/deps.
- **Mechanical migrate:** `/refactor --mechanical` + templates under `.claude/templates/migrate/` (`MAPPING.md`, `CONSTRAINTS.tsv`, `CANARY.md`).

### 2.2.0 — Bun adversarial Phase A (2026-07-12)

Backward-compatible minor under product line **v5** (not a v6 reboot). See [docs/proposals/bun-adversarial-mechanical-loops.md](docs/proposals/bun-adversarial-mechanical-loops.md).

- **Tiered dual adversarial code review:** `review-tier.js` + `merge-review-verdicts.js` (default policy **union**). Auto when file/line thresholds, security-boundary, or `sensor_tier=strict`; single reviewer otherwise. Wired into `/implement` Step 7, `/auto` Gate 8, `/change` S6/I8.
- **Anti stub-to-green:** code-gen + `code-reviewer` Iron Laws; commit-time `stub-smell-gate` (standard+); allow `harness:stub-ok story=…`.
- **Multi-agent git safety:** `hooks/lib/git-safety.js` + pre-bash deny for stash / reset --hard / clean -fd / force-push when `HARNESS_PARALLEL_AGENTS=1` or `parallel-implement.lock` present.
- **Process rules:** `.claude/state/process-rules.md` injected on implement/auto/change (workflow constraints, separate from learned-rules).

### Human trust + production-quality surfaces (P0–P3)

World-class human review and codebase understanding (Devin DeepWiki/Review + OpenAI harness patterns):

- **P0 quality card + walkthrough:** `quality-card.js`, `pr-walkthrough.js`, `pr-body.js` — `/gate` Step 4 always writes a trust receipt + logical PR tour; Phase 11 opens PRs via `pr-body.js --require-gate` (refuses red cards).
- **P0 human homepage:** `human-codebase.js` → `docs/CODEBASE.md` from code-graph + CONTEXT + concepts; fail-open on graph-refresh.
- **P1 observability ratchet:** `observability-gate.js` — BLOCK swallowed exceptions/empty catches; WARN unstructured logs / boundary without logger / middleware without request_id.
- **P2 Ask CLI:** `ask-codebase.js` / `npm run ask -- "…"` — human-readable context-pack answers with citations.
- **P3 perf smells + digest:** `perf-smell-gate.js` (N+1 / sync-in-async BLOCKs); `readiness-digest.js` weekly ops view.

Sensors registered in `harness-manifest.json`; scripts on `CORE_SCRIPTS` + npm scripts.

## 2.1.0 — 2026-07-10

### Unreleased follow-ups (same minor line until next tag)

- **Context-first navigation:** living DeepWiki/code-map retrieval stack — `context-pack` v2 (lexical+wiki+TF-IDF semantic+co-change+depth-2), Iron Law in change/feature/refactor/vibe/implement/generator, `nav-query` facade, lean deterministic brownfield maps, concept pages, MCP (`nav-mcp-server`), nav-bench golden queries, token-advisor (`context_search_required`, unconstrained search); see [docs/proposals/context-first-navigation.md](docs/proposals/context-first-navigation.md) and [docs/token-governor.md](docs/token-governor.md)
- **Token cost control (enterprise):** receipt model stamps, cache-aware pricing, `cost-report.js`, `/status` Cost line; product scaffold default `model_tier=cost` (Haiku explorer); `token_governor.mode=enforced` optional; `team-policy` solo_sequential; frontier `advisor` agent + `/advise`; [docs/token-cost-playbook.md](docs/token-cost-playbook.md)
- Progressive `/auto` `/design` `/build` + `/scaffold-upgrade`
- CI gitleaks; Project Zero readiness **8/8** (observability convention enabled)
- All pre-commit gates use `failBlock` / `formatBlock` (Fix / Waive / Tier)
- `docs/marketplace-publish.md`, `docs/symphony-product.md`, `npm run release:skus`

### Operability & packaging

- **Sensor tiers** (`minimal` | `standard` | `strict`) filter pre-commit via a gate registry; default `standard` preserves prior commit-time behavior.
- **Lean core scaffold** excludes vertical/framework optional skills (`pe-ic-memo`, framework packs); use `--full` or framework packs.
- **Project Zero dogfood**: root `project-manifest.json`, agent-readiness **ratchet** in CI (`min_active_pillars` + no regression vs baseline).
- **ESLint** + **gitleaks** in GitHub Actions; `npm ci` + lockfile.
- **SKU packaging**: `npm run package:skus` → `dist/skus/harness-{core,lite,full}` for `claude --plugin-dir`.
- **scaffold-upgrade**: dry-run / `--apply` refresh of hooks/scripts/git-hooks without wiping project state.
- **Progressive `/auto`**: short entry `SKILL.md` + `references/section-*.md`; skill-length budget test.
- **Retention**: `npm run retention` prunes old `.claude/runs` and state archive locally.

### Planning gate

- **`plan-confidence.js --gate`**: exit `0` for high|medium, exit `2` for low — mechanical stop for `/build --auto` after one `/clarify` pass (and lite→full escalation on low confidence).

### Docs

- `docs/product-skus-and-tiers.md` SKU + tier vocabulary.
- README install path prefers packaged SKUs; clone path for contributors.

## 2.0.0

Prior harness control-system baseline (G1–G32 gap closures, GAN evaluator, brownfield lanes). See git history and `HARNESS.md`.
