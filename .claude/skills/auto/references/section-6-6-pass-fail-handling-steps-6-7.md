## SECTION 6: PASS/FAIL Handling (Steps 6-7)

### On PASS (All Gates Clear)

**Sequential mode (`--sequential` or wave-of-one):**

1. **Commit:** `git add -A && git commit -m "feat: implement group {group}"`
2. **Update features.json:** Set `passes: true` for all features in this group's sprint contract.
3. **Update claude-progress.txt:** Append a new session block (see SECTION 10 for format).
4. **Update iteration-log.md:** Append entry with group ID, timestamp, verdict, and summary.
5. **Update coverage-baseline.txt:** Write the new coverage percentage (ratchet up).
6. **Next group:** Return to SECTION 2 (context recovery) for the next iteration.

**Parallel mode (wave of ≥ 2 groups):**

The above steps are split across the group-orchestrator subagent and the parent orchestrator:

*Group-orchestrator (per group, runs in subagent):*
1. **Commit to per-group branch:** `git commit -m "feat: implement group {group}" auto/group-{group}` (already checked out).
2. **Update per-group state:** Write proposed `features.json` updates to `.claude/state/wave-{N}/group-{group}/features-update.json` and the per-group `iteration-log.md` and `learned-rule-candidates.md`. Do NOT touch parent-owned files.
3. **Return summary** to the parent (see Section 4B Group-Orchestrator Spawn Protocol for schema).

*Parent (after all group-orchestrators in the wave return):*
4. **Roll-up state** (Section 4B Wait + Merge Protocol): merge per-group `features-update.json` files into `features.json`, append per-group `iteration-log.md` sections to the canonical log, triage `learned-rule-candidates.md` into `learned-rules.md`.
5. **Merge branches sequentially** into `WAVE_BASE` in dependency-graph order (passing groups only).
6. **Update parent state:** append a new session block to `claude-progress.txt` with the wave summary; ratchet `coverage-baseline.txt` to the new repo-wide coverage after all merges.
7. **Next wave:** Return to SECTION 2 (context recovery) to compute the next wave.

### On FAIL — Self-Healing Loop (Max 3 Attempts)

Do not immediately revert. Attempt targeted self-healing first.

**Attempt 1-3:**

1. **Diagnose:** Invoke `superpowers:systematic-debugging` to analyze the failure before attempting a fix. This prevents jumping to conclusions and ensures the root cause is identified. Read the evaluator report (`specs/reviews/evaluator-report.md`) and, for security failures, the security verdict (`specs/reviews/security-verdict.json`) for specific failure details. Identify the exact check or finding that failed and the error output.

2. **Classify** the failure into one of 10 categories:

| Category | Signal | Auto-Fix Strategy |
|----------|--------|-------------------|
| Lint/format | ruff/eslint error output | `ruff check --fix && ruff format` |
| Type error | mypy/tsc error with file:line | Fix the type annotation at the specified location |
| Test failure | pytest/vitest assertion error | Fix the production code, NOT the test |
| Import error | ImportError / ModuleNotFoundError | Fix the import path or `__init__.py` |
| Coverage drop | Coverage % below baseline | Add tests for the specific uncovered lines |
| API check fail | HTTP 500/404/wrong schema | Read `docker compose logs backend --tail=50`, identify root cause from stack trace, fix service/router |
| Playwright fail | Element not found / assertion error | Read the selector, fix the component |
| Design score low | Score below threshold | Apply the critique text, regenerate the UI |
| Docker fail | Container exit code / won't start | Read `docker compose logs`, fix config or deps |
| Architecture drift | Schema mismatch / missing file | Read the schema, fix the response or create the file |
| Security (BLOCK) | `security-verdict.json#pass === false` (critical/high finding) | Apply the finding's `fix`; parameterize queries, add authz/validation, remove hardcoded secrets. Re-run the security-reviewer to confirm the verdict clears |
| Verification matrix | `verification-matrix-verdict.json#pass === false` or missing `matrix_ids` / trace sidecar coverage | Add or execute the missing traced verification, preserving the matrix requirement. Never weaken or remove matrix rows to make the gate pass |

3. **Spawn generator** to apply the targeted fix. The generator prompt must include:
   - The structured failure JSON from `specs/reviews/eval-failures-NNN.json` (see evaluator agent for schema).
   - The category and auto-fix strategy from the table above.
   - All learned rules.
   - Instruction to fix ONLY the failing issue — no other changes.
   - **Accumulated `prior_attempts`:** On attempt 2, include attempt 1's fix description and result. On attempt 3, include both. This prevents the generator from re-trying the same fix.

   **Error type to fix strategy mapping:**

   | error_type | Strategy |
   |-----------|----------|
   | `lint_format` | Run auto-fix tools (`ruff check --fix`, `eslint --fix`) |
   | `type_error` | Fix annotation at file:line from stack trace |
   | `import_error` | Check module path, fix import statement |
   | `key_error` | Check data shape at source — log incoming data, fix accessor |
   | `timeout` | Check if service is started, increase timeout, add retry |
   | `connection_refused` | Verify service URL in config, check port mapping |
   | `validation_error` | Compare request/response against schema, fix model |
   | `assertion_error` | Read test assertion, compare expected vs actual, fix logic |
   | `api_transient` | Retry evaluator check once (code may be correct, API was flaky). If retry passes, do not count as a self-heal attempt. |
   | `api_permanent` | Fix wrapper error handling or request format |

4. **Re-run the failed gate** (not all gates — just the one that failed).

5. **3rd failure — hard stop for this group:**
   - Revert ONLY this group's files, scoped via the file ownership list in `specs/design/component-map.md`: `git checkout -- {file1} {file2} ...`. Never `git checkout -- .` — in parallel-group mode that discards other groups' in-flight work.
   - Log the failure to `.claude/state/failures.md` with group ID, failure category, all three attempt summaries.
   - Extract a learned rule (see SECTION 12).
   - Mark the group as BLOCKED in `claude-progress.txt`.
   - Escalate to the user with a summary.
   - Continue to the next unblocked group.

---
