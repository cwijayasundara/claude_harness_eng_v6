# BRD: Shortlink (sprint 1 — mint and redirect)

Mode: `--prd` adopt-only. Source: `prd.md` (copied to `specs/brd/source-frd.md`).
Spine: `specs/brd/brd-requirements.json` — **14 requirements**, adopted verbatim. Do not restate them here.

## In scope

14 adopted requirements. Machine spine + acceptance: `brd-requirements.json`, `brd-acceptance.json`.

## Out of scope

- Custom or vanity codes — codes are generated, never chosen.
- Editing a link's target after creation — delete and recreate.
- Link expiry (sprint 2).
- Click counts, analytics, referrers, charts, or GeoIP (sprint 2 for a count only).
- Teams, shared ownership, or an admin role.
- Billing, plans, or usage quotas.
- Password reset by email, SSO, and multi-factor authentication.
- Rate limiting.
- Bulk import or export.
- Following redirect chains or resolving hostnames on FR-6 (an outbound fetch or DNS lookup would violate NFR-5).
- OpenAPI publication, scheduled purge jobs, and structured request logs as required deliverables.

## Open questions

- none

## Clarifications

- none — lean adopt does not invent decisions the PRD did not ask

## Risks

- none listed in the PRD

## Gates

- Grounding and taxonomy are the scripts in Step 4.4 / 4.45 — not a restated analysis pack.
- No `brd-analysis.json`. Domain/risk seed: `analysis-seed.json`. SPDD Canvas is a `/design` artifact.
