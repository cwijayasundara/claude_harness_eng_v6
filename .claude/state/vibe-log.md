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
