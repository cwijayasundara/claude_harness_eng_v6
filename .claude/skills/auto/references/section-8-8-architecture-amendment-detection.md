## SECTION 8: Architecture Amendment Detection

After each agent team completes (before the ratchet gate):

1. Check `specs/design/amendments/` for new files that were not present at the start of this iteration.
2. If new amendment files are found, **fix the structured record first** (SSDD `/spdd-prompt-update`):
   - Edit `design-decisions.json` / `reasons-canvas.md` (and the affected stories' Generation Contracts) so the gap is named.
   - Re-join: `node .claude/scripts/bundle-write.js` then `node .claude/scripts/canvas-sync-check.js`.
   - Only then spawn a planner to update transcribed artifacts (`api-contracts.md`, `component-map.md`, schema files).
   - Commit the amendment: `git add specs/design/ specs/bundles/ && git commit -m "refactor: update design record for {change description}"`
3. Proceed to the ratchet gate with the updated architecture.

Amendments are a signal that the implementation discovered a design gap. They must be incorporated before evaluation, not deferred. Do not patch `api-contracts.md` and leave the Canvas / bundles stale.

---
