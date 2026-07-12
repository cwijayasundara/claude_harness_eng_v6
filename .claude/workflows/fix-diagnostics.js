/**
 * Dynamic workflow exemplar (Bun Phase C).
 *
 * This is the harness's first *non-duplicate* shipped workflow: it orchestrates
 * the diagnostics work queue (Phase B skill + scripts) as a multi-phase fan-out,
 * instead of re-wrapping evaluate/gate or implement skills.
 *
 * Bun lesson: when agents misbehave mid-loop, **edit this workflow** (and
 * process-rules.md) — do not only hand-fix the tree.
 *
 * Prerequisites: Dynamic workflows enabled (Pro+/Max; see workflows/README.md).
 * Prefer the skill form when you only need a single-agent pass:
 *   .claude/skills/fix-from-diagnostics/SKILL.md
 *
 * Invoke: /fix-diagnostics   or mention "workflow" + diagnostics fix.
 */

export const meta = {
  name: 'fix-diagnostics',
  description:
    'Shard tsc/eslint/ruff/mypy errors into a work queue; fix per package with optional dual review — no full suite mid-shard',
  phases: [
    { title: 'Capture', detail: 'Run or load diagnostic output; write errors.jsonl + shards.json' },
    { title: 'Shard fix', detail: 'Per-package fix loops (ownership-scoped); dual review on large shards' },
    { title: 'Close queue', detail: 'Re-check tool clean; only then full suite / smoke' },
    { title: 'Process learn', detail: 'Append process-rules if agents stubbed or thrashed the suite' },
  ],
}

// Dynamic workflow runtime injects: agent, parallel, pipeline, phase, log, args.
// Body is documentation-first: Claude executes these steps when the workflow runs.

const toolHint =
  (typeof args !== 'undefined' && args && String(args).trim()) ||
  'auto-detect from project (tsc | eslint | ruff | mypy)'

await phase('Capture', async () => {
  log(
    `Build diagnostics queue for tool=${toolHint}. ` +
      `Capture tool output to a temp file, then run: ` +
      `node .claude/scripts/diagnostics-shard.js --auto --from-file <capture> ` +
      `(or --tool tsc|eslint|ruff|mypy). ` +
      `Confirm .claude/state/diagnostics/shards.json has total_errors and shards.`
  )
  await agent(
    `Capture the project's failing type/lint command output for: ${toolHint}. ` +
      `Write the capture to .claude/state/diagnostics/last-capture.txt if needed. ` +
      `Run node .claude/scripts/diagnostics-shard.js --auto --from-file <that file> ` +
      `(or the matching --tool). Report total_errors and shard_count from shards.json. ` +
      `If total_errors is 0, stop successfully — nothing to fix.`,
    { label: 'diagnostics-capture' }
  )
})

await phase('Shard fix', async () => {
  log(
    'For each shard: edit only shard.files; no stub-to-green; no git stash/reset --hard; ' +
      'no full monorepo test suite until all shards are clean. ' +
      'If a shard is large, run dual code-reviewer + merge-review-verdicts.js (union). ' +
      'If agents step on each other, create parallel-implement.lock and set HARNESS_PARALLEL_AGENTS=1.'
  )
  await agent(
    `Read .claude/state/diagnostics/shards.json. ` +
      `If missing or total_errors===0, stop. ` +
      `Otherwise process shards in order (smaller first). For each shard: ` +
      `1) Fix real diagnostics in shard.files only (no todo!/NotImplementedError stubs). ` +
      `2) Re-run scoped lint/type on those paths when possible. ` +
      `3) If files>=8 or large diff, spawn two independent code-reviewer passes and ` +
      `node .claude/scripts/merge-review-verdicts.js --policy union. ` +
      `4) Optional commit using: node .claude/scripts/review-commit-msg.js --subject "fix <shard.id> diagnostics" --from-audit specs/reviews/adversarial-review-audit.json ` +
      `when dual review ran. ` +
      `Do NOT run the full monorepo suite between shards. ` +
      `Follow .claude/skills/fix-from-diagnostics/SKILL.md and .claude/state/process-rules.md.`,
    { label: 'diagnostics-shard-fix' }
  )
})

await phase('Close queue', async () => {
  await agent(
    `Re-run the full diagnostic tool. If errors remain, re-run diagnostics-shard.js and ` +
      `fix remaining shards (max 3 full queue passes). When the tool is clean, run the ` +
      `project test suite + lint/types (implement Step 6 style). Optionally boot health/smoke. ` +
      `Report final green evidence (commands + exit codes).`,
    { label: 'diagnostics-close' }
  )
})

await phase('Process learn', async () => {
  await agent(
    `If this run saw stub-to-green, destructive git, or full-suite thrash mid-shard, ` +
      `append a short process rule to .claude/state/process-rules.md (workflow constraint, not code style). ` +
      `If the workflow itself should change (new deny, different shard size), document the edit ` +
      `for a human to apply to .claude/workflows/fix-diagnostics.js — fix the process, not only the tree. ` +
      `Summarize outcomes for the user.`,
    { label: 'diagnostics-process-learn' }
  )
})
