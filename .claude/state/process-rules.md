# Process Rules

Monotonic **workflow** constraints for agents (distinct from `learned-rules.md` code patterns).
When the same agent-behaviour failure class appears 2+ times, append a rule here and keep it forever.
Inject into orchestrator, `/implement`, `/auto` teammates, and `/change` before edits.

### PR-default-01 — no destructive git during parallel implement
- **Rule:** never run `git stash`, `git reset --hard`, `git clean -fd`, or `git push --force` while parallel implement is active (`parallel-implement.lock` or `HARNESS_PARALLEL_AGENTS=1`)
- **Enforcement:** pre-bash-gate (`hooks/lib/git-safety.js`) + SECTION 4 teammate prompt
- **Added:** 2026-07-12 (Bun adversarial Phase A)

### PR-default-02 — no stub-to-green
- **Rule:** do not clear compile/lint by shipping stub markers on production paths; implement real behaviour or use an explicit `harness:stub-ok story=…` deferral
- **Enforcement:** code-gen + code-reviewer Iron Laws + `stub-smell-gate` (standard+)
- **Added:** 2026-07-12 (Bun adversarial Phase A)

### PR-default-03 — diagnostics queue: no full-suite mid-shard
- **Rule:** when `fix-from-diagnostics` is active with ≥15 errors, do not run the full monorepo test suite between shards; re-check scoped diagnostics only until the queue is empty
- **Enforcement:** fix-from-diagnostics skill + /auto SECTION 6 self-heal routing
- **Added:** 2026-07-12 (Bun Phase B)

### PR-default-04 — canary before large mechanical / multi-story fan-out
- **Rule:** canary 3 files or one story before applying a mechanical pattern or epic fan-out across more than ~10 files / remaining groups
- **Enforcement:** implement Step 0.5, feature canary story, refactor --mechanical + G32
- **Added:** 2026-07-12 (Bun Phase B)

### PR-default-05 — edit the workflow when agents misbehave
- **Rule:** after repeated workflow failures (stash races, stub-to-green, suite thrash), update process-rules and/or `.claude/workflows/fix-diagnostics.js` / skills — do not only patch product code
- **Enforcement:** workflows/README.md + fix-diagnostics Process learn phase
- **Added:** 2026-07-12 (Bun Phase C)
