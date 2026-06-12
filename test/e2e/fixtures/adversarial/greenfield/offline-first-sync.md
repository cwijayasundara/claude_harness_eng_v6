# Adversarial Greenfield Prompt: Offline First Sync

Create a field-inspection app for warehouse auditors. The request says it must
work offline for a full shift, sync in realtime when connectivity returns, and
show managers an always-current dashboard. Those requirements are contradictory
unless conflict resolution and stale-data rules are explicit.

Constraints:
- Must support two auditors editing the same inspection while offline.
- Cannot lose local edits when sync fails.
- Cannot require a cloud database in the prototype.
- Required verification must include tests for offline edits, sync retries, and
  merge conflict behavior.

The harness should force ambiguous merge policy decisions into the BRD/spec and
must not jump straight to implementation without documenting trade-offs.
