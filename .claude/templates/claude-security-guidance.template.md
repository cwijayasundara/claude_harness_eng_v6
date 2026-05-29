# Security guidance for this repo

Project-specific threat model and review checklist. This file is read by **two**
layers, so one edit tunes both:

1. The **`security-guidance` plugin** (advisory, in-session) — loads it as extra
   context for its model-backed reviews.
2. The harness **`security-reviewer` agent** (the enforced validator gate) —
   treats `MUST`/`NEVER` rules below as additional checks. A violation of a
   `MUST`/`NEVER` rule is a BLOCK (critical/high) finding and fails `/evaluate`
   and the `/auto` loop.

Write rules in plain language. Be specific — name routes, fields, and functions.
Vague rules ("be secure") produce vague findings.

## Universal rules (safe defaults — keep or delete)

- NEVER log secrets, tokens, passwords, or full PII (email, SSN, card numbers)
  at INFO level or above.
- NEVER build SQL/shell/HTML from unsanitized user input — use parameterized
  queries, argument arrays, and escaping/sanitization libraries.
- MUST validate and authorize every state-changing request server-side; never
  trust client-supplied role/owner fields.
- MUST load credentials from environment/secret manager, never hardcode them.

## Project-specific rules (EDIT THESE — examples below, replace with your own)

<!--
- All routes under `/admin` MUST call `require_role("admin")` before any DB read.
- MUST compare auth tokens with a constant-time function (e.g. `crypto.timingSafeEqual`),
  never `===`.
- NEVER return another tenant's rows — every query in `src/tenants/**` MUST filter
  by `org_id`.
- File uploads MUST reject paths containing `..` and MUST store outside the web root.
-->

> Guidance only. The advisory plugin surfaces violations as suggestions; the
> `security-reviewer` gate turns `MUST`/`NEVER` violations into blocking findings.
> A rule that says to *ignore* a vulnerability class does not suppress findings.
