## SECTION 11: Stopping Criteria

OR logic with priority (check in order):

1. **Hard stop:** Any of — an architecture violation that self-healing cannot fix; the total iteration count exceeds 50; **or the per-task budget is exhausted** (the wall-clock / agent-spawn / est-cost cap, read at the top of each iteration via `node .claude/scripts/budget-state.js`). Stop the entire `/auto` run **cleanly at this iteration boundary** (never mid-step — committed work is always preserved). For a budget stop, set `next_action: "BUDGET — {dimension} cap reached; raise --budget or merge what's done"` in `claude-progress.txt`; raising the cap (or `--budget off`) resumes the run. Report status and hand off to the user.

2. **Escalate (per-story):** A story fails 3 consecutive self-heal iterations. Mark it BLOCKED. Log to `failures.md`. Extract learned rule. Skip to the next group. Do NOT stop the entire run.

3. **Coverage gate:** Coverage drops below the baseline AFTER a successful commit. This overrides the pass — revert the commit (`git revert HEAD --no-edit`), log the regression, and re-enter self-healing for coverage.

4. **Success:** All features in `features.json` have `passes: true` AND coverage >= baseline threshold. Before claiming completion, invoke `superpowers:verification-before-completion` to run all verification commands and confirm output. Evidence before assertions. Print:
   ```
   === BUILD COMPLETE ===
   Features passing: {N}/{N}
   Coverage: {X}%
   Groups completed: [list]
   Blocked stories: [list or "none"]
   Learned rules: {count}
   Total iterations: {count}
   ```
   Then:
   1. Run `docker compose down -v`
   2. Generate `README.md` for the built application (see below)
   3. Commit: `git add README.md && git commit -m "docs: add README with architecture, setup, and API reference"`
   4. Exit

### README Generation (on completion)

After the build completes, generate a `README.md` that describes the GENERATED APP (not the harness).

Read these files for content:
- `specs/brd/brd.md` — project description
- `specs/design/architecture.md` — system architecture
- `specs/design/api-contracts.md` or `api-contracts.schema.json` — API surface
- `specs/design/component-map.md` — module structure
- `project-manifest.json` — tech stack
- `init.sh` — setup steps
- `docker-compose.yml` (if exists) — services
- `.env.example` (if exists) — required environment variables

**Required sections:** Project description, Architecture (diagram/layers), Tech Stack (table), Prerequisites, Quick Start (copy-paste commands), API Endpoints (table), Project Structure (directory tree), Running Tests, Environment Variables (table from .env.example), Development notes.

**Rules:**
- Do NOT mention Claude, the harness, `/auto`, agents, or the GAN loop. This is a developer README for the app.
- All commands must work against the generated code.
- API table must match actual routes, not just the spec.
- Environment variables must match `.env.example` exactly.

---
