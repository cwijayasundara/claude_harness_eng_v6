---
name: fix-from-diagnostics
description: "[Internal pipeline stage — run by /auto self-heal and /implement validation when lint/type error volume is high; invoke directly only as a power user.] Turn compiler/linter output into a sharded work queue; fix per package with optional adversarial review — no full monorepo suite mid-shard."
argument-hint: "[--tool tsc|eslint|ruff|mypy] [--from-file path | capture from last command]"
---

# Fix-From-Diagnostics Skill

Turn typechecker/linter failures into a **Bun-style work queue**: parse once → shard by package → fix per shard (optionally dual-review large shards) → re-check diagnostics → only then run the full suite / smoke.

Use when:

- `tsc` / `mypy` / `ruff` / `eslint` reports **many** errors (rough rule: **≥ 15** distinct findings, or ≥ 3 packages), or
- `/auto` self-heal classifies `lint_format` / `type_error` and a single-file fix is clearly insufficient, or
- `/implement` Step 6 validation fails with a wall of type/lint noise.

Do **not** use for one-off annotation fixes (≤ ~5 errors in one file) — fix those inline.

---

## Process

### 1. Capture diagnostics

Run the project's type/lint command(s) and capture full stdout+stderr to a file, e.g.:

```bash
# examples — use project-manifest / package scripts when present
npx tsc --noEmit 2>&1 | tee /tmp/harness-tsc.txt
npx eslint . -f stylish 2>&1 | tee /tmp/harness-eslint.txt
ruff check . 2>&1 | tee /tmp/harness-ruff.txt
mypy . 2>&1 | tee /tmp/harness-mypy.txt
```

Prefer the command that failed. If multiple tools failed, run this skill once per tool (or merge captures only when the same tool).

### 2. Build the work queue

```bash
node .claude/scripts/diagnostics-shard.js --tool tsc --from-file /tmp/harness-tsc.txt
# or auto-detect:
node .claude/scripts/diagnostics-shard.js --auto --from-file /tmp/harness-tsc.txt
```

Writes:

- `.claude/state/diagnostics/errors.jsonl` — one JSON object per error  
- `.claude/state/diagnostics/shards.json` — shards grouped by package/module  

If `total_errors` is 0, stop — diagnostics are clean.

### 3. Parallel safety

If processing **2+ shards** concurrently:

1. Create `.claude/state/parallel-implement.lock` (empty).  
2. Set `HARNESS_PARALLEL_AGENTS=1` for the window.  
3. Teammates **must not** run full monorepo `npm test` / full-suite until all shards report clean diagnostics for this tool.  
4. Git safety (stash / reset --hard / force-push) remains denied while the lock exists.  
5. Remove the lock when done.

### 4. Fix each shard

For each shard in `shards.json` (dependency order optional; prefer smaller shards first):

1. **Ownership:** only edit files listed in `shard.files` (plus minimal import/type neighbors if required for the fix — note them).  
2. **Fix real errors** — no stub-to-green (`todo!`, `NotImplementedError`, empty `pass` solely to clear compile).  
3. Re-run the **scoped** tool on those files when possible (e.g. `tsc --noEmit` still whole-project is OK; prefer `eslint path1 path2`).  
4. **Review (tiered):** if the shard touches ≥ `review.adversarial_min_files` files or ≥ `review.adversarial_min_lines` lines, run dual adversarial code-review via `review-tier.js` + `merge-review-verdicts.js` (same as `/implement` Step 7). Otherwise one `code-reviewer` is enough for the shard diff.  
5. Commit owned paths only when the shard's diagnostic count for those files drops (optional mid-queue commits; at least one commit before the final suite). After dual review, prefer:
   ```bash
   git commit -m "$(node .claude/scripts/review-commit-msg.js --subject "fix $(shard.id) diagnostics" --from-audit specs/reviews/adversarial-review-audit.json)"
   ```

### 5. Close the queue

1. Re-run the full tool check; re-shard if errors remain (`diagnostics-shard.js` again).  
2. Max **3** full queue passes; if still red, stop and escalate with remaining `errors.jsonl`.  
3. Only after **zero** errors for this tool: run project tests + lint/type as in `/implement` Step 6 (or resume `/auto` failed gate).  
4. Optional smoke: if the app has a health check, boot per resume-smoke conventions before claiming success.

### 6. Process learning

If the queue failed because agents stubbed, ran full-suite mid-shard, or used destructive git, append a rule to `.claude/state/process-rules.md` (workflow constraint, not code style).

---

## Rules

- **No full monorepo suite between shards** when error count was ≥ 15 at queue start — mid-queue suite thrash is the failure mode this skill exists to prevent.  
- **No stub-to-green** to empty the queue.  
- **Implementer does not self-review** large shards — use fresh-context `code-reviewer`.  
- Prefer fixing production code over weakening types (`any`, `@ts-ignore`) unless the story explicitly allows.

---

## Outputs

| Path | Purpose |
|------|---------|
| `.claude/state/diagnostics/errors.jsonl` | Flat error list |
| `.claude/state/diagnostics/shards.json` | Work queue + progress input |
| Commits on owned paths | Per-shard or end-of-queue |

---

## Gotchas

- **Pretty-printed multi-line tsc notes:** only the primary `error TSxxxx` lines are parsed; related "note:" lines are ignored (by design).  
- **Absolute paths from eslint:** packages still shard correctly via path segments.  
- **Mixed tools:** do not feed eslint JSON into `--tool tsc` — use `--auto` or the matching `--tool`.  
