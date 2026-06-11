# Failure Log
<!-- Append-only. Used for pattern detection → learned rules extraction. -->
<!-- When 2+ entries share the same Category, extract a Learned Rule to .claude/state/learned-rules.md -->

<!-- ENTRY FORMAT (copy this for each new failure):

## Group {ID} — Failure #{N}
- **Date:** {ISO 8601}
- **Category:** {lint_format | type_error | test_failure | import_error | coverage_drop | api_check_fail | playwright_fail | design_score_low | docker_fail | architecture_drift}
- **Story:** {story ID}
- **Attempt 1:**
  - Error: {error message with file:line if available}
  - Fix: {what was tried}
  - Result: FAIL — {why it failed}
- **Attempt 2:**
  - Error: {error message}
  - Fix: {what was tried}
  - Result: FAIL — {why it failed}
- **Attempt 3:**
  - Error: {error message}
  - Fix: {what was tried}
  - Result: FAIL — 3 attempts exhausted
- **Escalation:** User notified. Marked BLOCKED. Skipped to next group.
- **Pattern:** {describe the recurring pattern if visible}

-->
