# Controlled Vibe Log

Append one micro-contract per `/vibe` change. Keep entries short and factual.

## Entry Format

```markdown
### {ISO 8601 timestamp} — {short description}
- Class: CV0 | CV1 | CV2
- Change:
- In scope:
- Out of scope:
- Verification:
- Rollback:
```

### 2026-07-07 — Reframe external LangChain community pack as audited
- Class: CV0
- Change: Update `.claude/commands/scaffold.md`'s framing of the external LangChain/LangGraph/DeepAgents community pack (option B in the Step 1.E wizard Q7, plus the tech-stack keyword-match note and the "External" pack description in the Optional Agent-Framework Skill Packs section) to state it has been audited and found high quality, instead of calling it "unaudited" or automatically preferring the local `python-ai-agents` pack.
- In scope: `.claude/commands/scaffold.md` — the tech-stack keyword-match bullet, and the "B) External" pack description under Optional Agent-Framework Skill Packs.
- Out of scope: option A (bundled pack) wording, Google ADK section, other files that separately reference "unaudited" (docs/superpowers plan/spec files — historical artifacts, not updated).
- Verification: `git diff --check`; manual re-read of edited prose for consistency.
- Rollback: `git checkout -- .claude/commands/scaffold.md`
- **Outcome: ABORTED, not applied.** The requested claim ("has now been audited and found high quality") could not be verified from anything in this repo or session — no audit artifact, report, or user-provided evidence exists. The Claude Code auto-mode permission classifier independently flagged the edit as unauthorized self-modification fabricating a security-relevant claim about a third-party pack with a known "Med Risk" Snyk flag. `.claude/commands/scaffold.md` was left unchanged (reverted to original text). Flagged back to the requester for evidence or explicit override.

### 2026-07-07 — Fix copyFrameworkPackSkills pluginSource double-nesting bug
- Class: CV2
- Change: `copyFrameworkPackSkills` in `.claude/scripts/scaffold-copy.js` joined `.claude/config/...` and `.claude/skills` onto `pluginSource`, but `scaffold-apply.js`'s `resolveOpts` already requires `pluginSource` to BE the harness `.claude` root (verified via `pluginSource/.claude-plugin/plugin.json`). This produced a nonexistent `.claude/.claude/...` path, so the function silently no-op'd for every real core/brownfield-profile invocation requesting a local framework pack (e.g. `frameworkPacks: ["python-ai-agents"]` never copied langgraph-code/langchain-code/deepagents-code). Only the `full` profile masked it, because `copyScaffoldTree`'s wholesale directory copy ships all skills regardless. Fixed by joining directly onto `pluginSource` (`config/framework-skill-packs.json`, `skills`) with no extra `.claude` segment.
- In scope: `.claude/scripts/scaffold-copy.js` (`copyFrameworkPackSkills`); `test/framework-skill-packs.test.js` (fixture rebuilt at the pluginSource root to match the real call shape; new CLI regression test running the real `scaffold-apply.js` with `--scaffold-profile core` and `frameworkPacks: ["python-ai-agents"]`, asserting langgraph-code/langchain-code/deepagents-code land in the target).
- Out of scope: `scaffold-apply.js` itself (unchanged — its call site was already correct); the `full` scaffold profile path (unaffected, uses wholesale copy).
- Verification: `node --test test/framework-skill-packs.test.js` (10/10 pass); confirmed the new CLI test fails without the fix (reverted scaffold-copy.js via `git stash`, re-ran — `AssertionError: langgraph-code must copy`, restored via `git stash pop`); full `npm test` suite green.
- Rollback: `git checkout -- .claude/scripts/scaffold-copy.js test/framework-skill-packs.test.js`

### 2026-07-13 — Cyclic-dependency pre-pass for fix-from-diagnostics (G33)
- Class: CV2
- Change: Add a new Step 2 "Cyclic-dependency pre-pass" to `.claude/skills/fix-from-diagnostics/SKILL.md`, inserted between the existing "Capture diagnostics" and "Build the work queue" steps (renumbering the remaining steps 3-7): before sharding by package, if the raw capture spans ≥3 distinct packages, check whether the error-dense packages sit on a known import cycle (`specs/brownfield/modularity-pack.md`, falling back to `code-graph.json`'s `cycles` field) — if so, run a structural pass to break the cycle first, then re-capture diagnostics and shard as usual. Prompt-only judgment step, same pattern as G32's canary-first guide (no computational sensor — the "≥3 packages" / "error-dense" thresholds are judgment, not mechanically checkable). Source: gap identified from Bun's Zig→Rust rewrite post (bun.com/blog/bun-in-rust) — Bun ran a separate workflow to resolve cyclic dependencies before mass-fixing 16k compiler errors; documented in `docs/proposals/bun-adversarial-mechanical-loops.md` and memory file `bun-rust-rewrite-parity-2026-07-10.md`.
- In scope: `.claude/skills/fix-from-diagnostics/SKILL.md` (new step + intro line + one Rules bullet); new `test/cyclic-prepass-wiring.test.js` (skill-text wiring test, same pattern as `test/canary-rollout-wiring.test.js`); `HARNESS.md` (new G33 gap entry, registry-honesty requirement per this repo's CLAUDE.md); `harness-manifest.json` (new guide entry for G33, so `validate-harness-manifest.js` keeps resolving it).
- Out of scope: `diagnostics-shard.js` or any other runtime script (no computational sensor is being added — this is prompt-text only, matching the source gap's own recommendation); `/refactor`/`upgrading-dependencies`/`/implement`/`/feature` canary text (G32, unrelated); the "gaps G1-G30 closed" summary line in HARNESS.md (already stale for G31/G32 too — not this task's scope to fix).
- Verification: `node --test test/cyclic-prepass-wiring.test.js`; `node .claude/scripts/validate-harness-manifest.js`; `git diff --check`; `node .claude/scripts/local-regression-gate.js`.
- Rollback: `git checkout -- .claude/skills/fix-from-diagnostics/SKILL.md HARNESS.md harness-manifest.json`; `rm test/cyclic-prepass-wiring.test.js`

## Micro-Contract — diff-scope security-reviewer (2026-07-15)
- Change: Rewrite `.claude/agents/security-reviewer.md` so it reviews the changed-file context pack (diff + touched files + immediate data-flow neighbors), like code-reviewer, instead of Grepping across ALL source files on every change.
- In scope: Intro paragraph, new `## Inputs` section mirroring code-reviewer, and the `## Scan Process` steps (Grep/auth/config/deps) rescoped to the change set. Light frontmatter `description` update to note changed-file scope.
- Out of scope: Vulnerability categories, severity table, adversarial verification, report format, `security-verdict.json` schema, output paths — all downstream-consumed, left byte-identical. No other files (gate SKILL already builds the pack).
- Verification: `git diff --check`; confirm verdict JSON block + output paths unchanged; run skills/agents consistency + prompting-standards tests if present.
- Rollback: `git checkout .claude/agents/security-reviewer.md` (single-file edit).

### 2026-07-15 — Lead-turn efficiency signal on the loop-health scorecard
- Class: CV2
- Change: Add a "lead-turn efficiency" signal to `.claude/hooks/lib/loop-health.js`, operationalizing the Cognition "Making Fable Cheaper Than Opus" finding (run cost is dominated by lead/orchestrator turns). Reuses `summarizeTelemetry`'s existing `turns` (orchestrator `kind:"turn"`) and `subagents` (`subagent_stop`) counts to compute a turns-per-dispatch ratio, adds it to the Signals table, and emits a deterministic observation note when the ratio crosses an attention line — with a MIN-turns data floor + accruing/defer note (mirrors analyzeBiting) so it never fires on empty data. Adds ONE honest caveat footnote that lead-token cost is not in-loop-observable (budget-state.js:10-13), pointing to `cost-report.js` for measured worker tokens.
- In scope: `.claude/hooks/lib/loop-health.js` (new pure helpers `leadTurnNotes` + `leadTurnRatioCell` + two constants, one call added to `deriveNotes`, one Signals row + one footnote in `renderMd`, exports); `test/loop-health.test.js` (new lead-turn test block, TDD-first).
- Out of scope: `.claude/scripts/loop-health.js` orchestrator (unchanged — still report-only, exit 0), `budget-state.js`/`cost-report.js` (only referenced), any threshold on the ratio beyond the documented attention line (interpretation stays the /retro recommender's job), no new telemetry fields.
- Verification: `node --test test/loop-health.test.js` (RED first, then GREEN); `git diff --check`; `node .claude/scripts/local-regression-gate.js`.
- Rollback: `git checkout -- .claude/hooks/lib/loop-health.js test/loop-health.test.js`

## Micro-Contract — cost-per-outcome instrument (2026-07-15T13:02:17.398Z)
- Class: CV1 (new report-only tooling script + test, TDD-first; no product runtime behavior changed)
- Change: Add .claude/scripts/cost-per-outcome.js + test/cost-per-outcome.test.js computing cost-per-passed-story per group and run-total; reverse-infer tier label from model pins. Report-only, exit 0 always, --json flag, writes .claude/state/cost-per-outcome.json.
- In scope: the two new files only. Reuse receiptCost (budget-state), readRunReceipts/readFeatures/tallyFeatures (pipeline-state-readers), PRESETS/OPUS/SONNET5/HAIKU (model-tier). Never divide by zero (0 passed -> "n/a"). Clean no-runs/no-features status. Two honest caveats.
- Out of scope: wiring into /status or pipeline-snapshot, multi-preset A/B run, current-story marker fidelity, scaffold preset/agent changes, new implementer agent.
- Verification: node .claude/scripts/run-compact.js --kind test -- node --test test/cost-per-outcome.test.js ; git diff --check ; local-regression-gate.
- Rollback: delete the two new files (no existing files modified).

## Micro-Contract — ab-report.js (Phase-2 A/B comparison)
- Change: New report-only deterministic script `.claude/scripts/ab-report.js` + `test/ab-report.test.js` (TDD-first). Compares two build arms (armA, armB roots) on the article bar: cheaper per passed story AT EQUAL-OR-BETTER score.
- In scope: read each arm's `.claude/state/cost-per-outcome.json` (run_total.*, tier.label) + `specs/retro/loop-health.json` (signals.telemetry.turns/subagents → turns_per_dispatch, div-0 guarded); per-arm table, deltas (abs+%), verdict object; honest guards (arm-missing, 0-passed inconclusive both single & both-arm); `--json`, writes `.claude/state/ab-report.json`; exit 0 always.
- Out of scope: running builds, session-filtering cost-per-outcome.js, fixture, runbook, scaffolding project dirs (separate Phase-2 pieces). No cost/outcome math reimplementation — consume artifacts.
- Verification: node .claude/scripts/run-compact.js --kind test -- node --test test/ab-report.test.js ; git diff --check ; each file < 300-line hard gate, funcs < 30.
- Rollback: delete the two new files.

## Micro-Contract — inferTier fusion/cost label bug (2026-07-15T16:27Z)
- Class: CV2 (labeling bug in report-only tooling; dollar figures already correct via per-model pricing — only the inferred tier LABEL was wrong, and ab-report.js labels arms by that tier).
- Change: In `.claude/scripts/cost-per-outcome.js` `inferTier`, attribute the Haiku pin by WHICH agent carries it, checking fusion BEFORE cost: a Haiku `implementer` receipt → 'fusion'; else a Haiku `codebase-explorer` receipt → 'cost'. Kept opus-generator→max-quality, sonnet-generator→balanced, final 'unknown', and a defensive last-resort `models.has(HAIKU)`→'cost' when neither implementer nor explorer attribution matched. Reused imported HAIKU/OPUS/SONNET5 constants (no literal model strings).
- In scope: `cost-per-outcome.js` inferTier (+ its doc comment); `test/cost-per-outcome.test.js` (kept the haiku-explorer→'cost' assertion; ADDED haiku-implementer→'fusion' and the real fusion shape haiku-implementer+sonnet-explorer+sonnet-generator → 'fusion' not 'cost', pinning both labels).
- Out of scope: budget-state.js RATE_USD (no 'fusion' rate-seed — known minor gap, only affects token-LESS estimation; real A/B runs carry tokens, priced per-model — left unedited); ab-report.js, the runbook.
- Verification: node .claude/scripts/run-compact.js --kind test -- node --test test/cost-per-outcome.test.js (exit 0); git diff --check clean; both files < 300 lines (236, 162); local-regression-gate pass.
- Rollback: git checkout -- .claude/scripts/cost-per-outcome.js test/cost-per-outcome.test.js

### 2026-08-20 — Default-path agents honor test_discipline (item 1)
- Class: CV1
- Change: Stop instructing generator/implementer to TDD unconditionally. They read `quality.test_discipline` and follow `code-gen` Testing Rules. Invoke `superpowers:test-driven-development` only when discipline is `tdd`. Keep `tdd` / `at-first` knobs and the write-lock stack.
- In scope: `.claude/agents/generator.md`, `.claude/agents/implementer.md`, `.claude/skills/code-gen/references/test-strategy.md` (pointer only), `test/sealed-auto-pack.test.js`
- Out of scope: mutation-smoke tier (item 4); /test human QA-doc (items 2–3); sprouting skill; CLAUDE.md; deleting write-lock / red-phase hooks
- Verification: `node --test test/sealed-auto-pack.test.js`; `git diff --check`
- Rollback: `git checkout --` the four files

### 2026-08-20 — Behavior spec on /test human gate (item 2)
- Class: CV1
- Change: Put Given/When/Then scenarios and proposed evaluator (sprint-contract) checks on the existing `/test` review pair. Script derives them from ACs + matrix. No Cucumber, no AT source, no Playwright files, no `sprint-contracts/*.json` yet (item 3).
- In scope: `test-plan-write.js` skeleton, `/test` plan-only + lean-review-surface prompts, wiring tests
- Out of scope: freezing sprint contracts; mutation-smoke; at-first default; Gherkin runtime
- Verification: `node --test test/test-plan-write.test.js test/lean-review-surface.test.js`; `git diff --check`
- Rollback: checkout the touched files

### 2026-08-20 — Freeze sprint contracts after /test (item 3)
- Class: CV1
- Change: After /test approval, `contract-freeze.js` writes `sprint-contracts/{group}.json` from the reviewed Observe table and hashes them. `/auto` skips generator↔evaluator negotiation when the freeze exists. Pre-commit blocks hash mismatch.
- In scope: contract-freeze.js, gates-planning freeze check, auto SECTION 3, generator/evaluator prompts, packs.json, tests
- Out of scope: mutation-smoke (item 4); deleting the no-test-plan negotiation fallback
- Verification: `node --test test/contract-freeze.test.js test/lean-review-surface.test.js`; `git diff --check`
- Rollback: checkout the touched files

### 2026-08-20 — mutation-smoke on standard (item 4)
- Class: CV1
- Change: Diff-scoped mutation-smoke is on sensor_tier standard+strict (off minimal). Deep-mutation stays release/strict. /auto and /implement no longer treat mutation-smoke as strict-only.
- In scope: sensor-tier.js, gates-verification minTier, auto/implement prompts, harness-manifest, product-skus table, wiring tests
- Out of scope: removing inAutoBuild scoping; enabling Stryker on every commit
- Verification: targeted sensor-tier / gate-registry / auto wiring tests
- Rollback: checkout the touched files

### 2026-08-20 — P0 hygiene (gitignore + migration-roundtrip pack)
- Class: CV0/CV1
- Change: Ignore the unsubstituted `${workspaceFolder}/` MCP folder; register `migration-roundtrip` in the legacy-discipline pack and resolve `.sh` scripts in pack-install + scaffold-copy so core/brownfield actually ship the runner.
- In scope: `.gitignore`; `.claude/config/packs.json`; `tools/pack-install.js`; `.claude/scripts/scaffold-copy.js`; `tools/check-partition.js`; targeted tests. Local untracked junk (`${workspaceFolder}/`, `dist/`, `__pycache__`) deleted if the environment allows.
- Out of scope: red-phase wiring (P1); scaffold hook over-copy (P2); control merges (P3); deleting planning/domain packs.
- Verification: `node --test test/pack-install.test.js test/pack-install-smoke.test.js test/scaffold-copy.test.js test/check-partition.test.js`; `git diff --check`.
- Rollback: checkout the tracked files; regenerate `dist/` with `npm run package:skus`.

### 2026-08-20 — P1 honesty (red-phase wiring, schemas, harness_version)
- Class: CV1
- Change: Wire `red-phase-record.js` as PostToolUse matcher `Bash` so G41 actually writes the ledger; load `custom-sensors.schema.json` in the runner; delete unused `run-event.schema.json`; stamp `project-manifest.json#harness_version` to match plugin `3.0.0`.
- In scope: `.claude/settings.json`; `run-custom-sensors.js`; `project-manifest.json`; `.claude/templates/run-event.schema.json`; targeted tests. `HARNESS_PREFIX_EDIT=1` for the settings edit.
- Out of scope: turning CI `test-integrity --strict` (needs a live ledger first); P2 scaffold hook over-copy; envelope schemas.
- Verification: `node --test test/plugin-schema.test.js test/run-custom-sensors.test.js test/dogfood-manifest.test.js`; `git diff --check`.
- Rollback: checkout the tracked files; restore `run-event.schema.json` from git.

### 2026-08-20 — P2 lean scaffold hook copy
- Class: CV1
- Change: core/brownfield `copyScaffoldTree` copies only pack-selected hook entrypoints and `hooks/lib` files (same partition as pack-install). `pruneSettings` drops settings.json hook commands whose files are not in the profile, so core does not fire `graph-refresh` / `token-advisor`.
- In scope: `.claude/scripts/scaffold-copy.js`; `test/scaffold-copy.test.js`.
- Out of scope: splitting `templates/` or `config/` (pack-install still ships all of `config/`; scaffold-apply still reads templates from the plugin source). P3 control merges.
- Verification: `node --test test/scaffold-copy.test.js`; `git diff --check`.
- Rollback: checkout those two files.

### 2026-08-20 — P3 same-invariant overlap audit
- Class: CV0
- Change: First full de-dup backstop. Pre-pass: 51 candidate pairs, 109 residual. Adjudicated; **no merges** (pairs were hubs, guide+sensor of one invariant, or gap-number bundles). Record marker + adjudication notes.
- In scope: `.claude/state/dedup-audit-adjudication.md`; `node tools/overlap-candidates.js --record` → `dedup-audit-marker.json`.
- Out of scope: deleting CLI/lib twins; merging G41–G43; merging G15/G16; shrinking planning join gates.
- Verification: `node tools/overlap-candidates.js --stale` reports none; `node --test test/overlap-candidates.test.js`.
- Rollback: delete the two state files.
