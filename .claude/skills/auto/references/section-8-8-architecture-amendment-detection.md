## SECTION 8: Architecture Amendment Detection

After each agent team completes (before the ratchet gate):

1. Check `specs/design/amendments/` for new files that were not present at the start of this iteration.
2. If new amendment files are found:
   - Read each amendment file to understand the architectural change.
   - Spawn a planner agent to update affected architecture artifacts (`api-contracts.md`, `component-map.md`, schema files).
   - Commit the amendment: `git add specs/design/ && git commit -m "refactor: update api-contracts for {change description}"`
3. Proceed to the ratchet gate with the updated architecture.

Amendments are a signal that the implementation discovered a design gap. They must be incorporated before evaluation, not deferred.

---
