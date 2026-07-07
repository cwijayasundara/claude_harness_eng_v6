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
