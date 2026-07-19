# Branch-Protection Provisioner + CODEOWNERS + Fleet Retrofit — Design

Date: 2026-07-19
Status: Approved for implementation (Increment 2 of the 4-increment security-compliance program)
Lane: `/change` (security/gate + platform-provisioning code — whole-branch review before merge)
Predecessor: Increment 1 (secure-repo baseline + `/auto` security ratchet), merged to main f4f81ca.

## Context

The client CISO mandate requires (point c, Aug 1) branch protection, CODEOWNERS, and
deployment-approval gates operational on **all active repositories**. Increment 1 made gitleaks +
SAST real, propagated, ratcheted controls and shipped a `.github/workflows/security.yml` with two
blocking jobs (`gitleaks`, `sast`). But — per Increment 1's own review (CR-002 / VULN-002) — the
scanners only *run*; whether a non-compliant PR is actually **blocked from merging** depends on
GitHub branch-protection marking those checks *required*, which the harness does not provision.

This increment provisions that platform-level enforcement across the portfolio, plus the CODEOWNERS
file a "require code-owner review" rule needs to bite.

### Hard constraint

**No client-specific identifiers in code.** No org names, team handles, repo slugs, or external
labels hardcoded in any script, template, schema, or state file. All such values are read from
`project-manifest.json` / config and are empty/placeholder by default.

### Decisions (locked with stakeholder, 2026-07-19)

- Provisioning: **org-level GitHub Ruleset** primary (one `orgs/{org}/rulesets` call targets all
  repos by pattern; new repos auto-covered), **per-repo ruleset fallback** for exceptions.
- CODEOWNERS: **generated in this increment** (config-driven), so `require_code_owner_review`
  is not inert.

### Grounding (from the Increment-2 scout)

- No shared `gh` wrapper exists; every consumer (`auto-merge.js`, `pr-poll.js`, `wave-pr.js`) uses
  an injected `runner`/`gh` around `execFileSync('gh', ...)` + try/catch→result-object, never
  throwing. Reuse that idiom.
- `scaffold-upgrade.js` is the plan-first / dry-run-by-default / `--apply`-to-mutate template.
- No repo registry / fleet list exists anywhere — a fleet concept is net-new.
- Required status-check contexts are exactly `gitleaks` and `sast` (job ids in `security.yml`,
  stable across sast engines).
- `project-manifest.json` (schema_version 2) has no `github`/`repo`/`org` section.
- CODEOWNERS is absent with no generator; `ownership-check.js` + `specs/design/component-map.md`
  parse *path* ownership but not *team* ownership.
- External-command tests use an arg-matching runner stub (`ghStub` in `test/pr-poll.test.js`).

## Goals

1. A `github` config section in `project-manifest.json` driving the provisioner.
2. `provision-protection.js` — plan (default) / `--apply` / `--verify`, org-level ruleset primary
   with per-repo fallback, idempotent, no-throw.
3. `generate-codeowners.js` — config-driven `.github/CODEOWNERS`, wired into `scaffold-copy`.
4. The `secure-baseline-wiring` gate additionally requires `.github/CODEOWNERS` when
   `github.require_code_owner_review` is true.
5. Optional `fleet.json` registry for per-repo apply and the Increment 4 rollup seed.
6. One new registered control (`branch-protection-verify`) + a thin `provision-protection` skill.

## Non-goals (later increments)

- Deployment-approval GitHub Environments (Increment 3).
- Durable evidence / attestation generator / portfolio rollup / version-drift (Increment 4).
- Credential rotation / history-scrub / incident-report tooling (Phase A runbook).
- Enriching CODEOWNERS from the component-map (Increment 2 ships a config-driven owners list only).

## Components

### C1. `github` config section (`project-manifest.json`, schema_version stays 2)

```jsonc
"github": {
  "org": "",                              // required at apply time; empty default (no literal)
  "default_branch": "main",
  "required_checks": ["gitleaks", "sast"],
  "required_approvals": 1,
  "require_code_owner_review": true,
  "enforce_admins": true,
  "ruleset_scope": "org",                 // "org" | "repo"
  "ruleset_name": "harness-baseline-protection",
  "target_repos": "~ALL",                 // org mode: include pattern; repo mode: unused
  "default_owners": []                    // e.g. ["@org/team"] → CODEOWNERS "* <owners>"
}
```

- Read by the provisioner and the CODEOWNERS generator. Scaffold writes this block with empty
  `org`/`default_owners` (placeholders, no literals).
- A missing `github` section → provisioner prints a "not configured" plan and exits 0 (never errors);
  CODEOWNERS generation is skipped when `default_owners` is empty.

### C2. `provision-protection.js`

CLI modes (models `scaffold-upgrade.js`):
- **`plan`** (default): `GET` the current ruleset (by `ruleset_name`), diff against the desired
  spec, print `would create` / `would update (field: a→b)` / `already compliant`; exit 0. Prints the
  "requires org-admin to `--apply`" note.
- **`--apply`**: idempotent. List rulesets (`GET orgs/{org}/rulesets` or
  `repos/{owner}/{repo}/rulesets`), match by `ruleset_name`; `POST` to create or
  `PUT .../rulesets/{id}` to update. Org mode = one call; repo mode iterates `--repo <owner/repo>`
  or `--fleet fleet.json`.
- **`--verify`**: read back the live ruleset and report `compliant` vs a structured `drift[]`
  (missing/extra/mismatched rules). Machine-readable JSON to
  `specs/reviews/branch-protection-verify.json` (feeds Increment 4). Exit non-zero on drift so CI /
  an admin can gate on it.

Desired ruleset spec (built from C1; validated against the documented GitHub **rulesets** schema):
```jsonc
{
  "name": "<ruleset_name>",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "pull_request",
      "parameters": { "required_approving_review_count": <n>,
                      "require_code_owner_review": <bool>,
                      "dismiss_stale_reviews_on_push": true } },
    { "type": "required_status_checks",
      "parameters": { "strict_required_status_checks_policy": true,
                      "required_status_checks": [ { "context": "gitleaks" }, { "context": "sast" } ] } },
    { "type": "non_fast_forward" },
    { "type": "deletion" }
  ],
  "bypass_actors": []            // empty ⇒ enforce_admins:true equivalent (no bypass)
}
```
- `enforce_admins:true` ⇒ empty `bypass_actors` (admins cannot bypass).
- gh access: injected `runner` (`execFileSync('gh', ['api', ...])`), try/catch→`{ok,reason}`
  result-object, never throws. gh absent / unauthenticated / too old → a clear reason + exit 2 in
  apply/verify, exit 0 in plan.
- Org/repo/branch never string-interpolated into a shell; passed as literal argv.

### C3. `generate-codeowners.js`

- Renders `.github/CODEOWNERS` from `github.default_owners`: a `* <owners...>` catch-all line, plus
  optional `path <owners>` entries from an optional `github.path_owners` map. Idempotent
  (regenerates deterministically). Skips (no file) when `default_owners` is empty.
- Wired into `scaffold-copy` / `scaffold-security-baseline`-style materialization so a scaffolded
  repo gets `.github/CODEOWNERS` alongside `security.yml`. No literals — owners come from config.

### C4. `secure-baseline-wiring` gate extension

In `.claude/hooks/lib/security-baseline.js` `wiringViolations` (+ caller in `gates-strict.js`): when
the target's `project-manifest.json#github.require_code_owner_review` is true, also require
`.github/CODEOWNERS` to exist and be non-empty. Absent/empty ⇒ a wiring violation (BLOCK, strict).
This is a modification of an existing control — **no new control-budget entry.**

### C5. `fleet.json` registry (optional)

- Schema: `{ "org": "", "repos": [ { "owner": "", "repo": "" } ] }`. Empty default.
- Consumed only by repo-mode `--apply --fleet fleet.json` and (later) the Increment 4 rollup. Org
  mode ignores it. Documented as the seam the portfolio rollup will read.

### C6. Registration + skill

- Register `branch-protection-verify` in `harness-manifest.json#sensors`: axis `traceability`, type
  `computational`, cadence `drift`, scope `portfolio`, status `active`, `wired_at`
  `provision-protection.js`, with `net_add_justification`. Control-budget baseline **125 → 126**.
- Update `HARNESS.md` counts. Re-run `validate-harness-manifest.js`.
- Thin `.claude/skills/provision-protection/SKILL.md` (or command): documents plan → apply → verify,
  the org-admin requirement, and that merge-blocking is now real once applied.

## Data flow

```
project-manifest.json#github  ─┬─► provision-protection.js
                               │       plan   → diff vs live ruleset (GET)         → stdout
                               │       apply  → POST/PUT orgs/{org}/rulesets        → ruleset active
                               │       verify → GET live ruleset → drift[]          → specs/reviews/branch-protection-verify.json
                               └─► generate-codeowners.js → .github/CODEOWNERS

.github/CODEOWNERS ◄─ secure-baseline-wiring gate (strict) asserts present when require_code_owner_review
```

## Error handling / policy

- `plan` never errors (exit 0) even with no `github` config or no gh — it is a read-only preview.
- `apply`/`verify` fail loudly (exit 2) on gh absence/auth/permission errors with an actionable
  reason; they never partially-apply silently.
- Idempotent: re-running `--apply` on an already-compliant ruleset is a no-op update (same PUT).
- No client literals; all identifiers from config; empty config = safe no-op.

## Testing (TDD, `ghStub` arg-matching + real-shape)

1. Desired-ruleset builder emits a payload matching the documented GitHub rulesets schema
   (required_status_checks contexts `gitleaks`+`sast`, pull_request params, non_fast_forward,
   deletion, empty bypass_actors).
2. `plan`: given a stubbed live ruleset, prints correct create/update/compliant diff; exit 0.
3. `--apply`: idempotency — no existing ruleset ⇒ POST; existing-by-name ⇒ PUT `.../rulesets/{id}`;
   assert exact gh argv via `ghStub`.
4. `--verify`: stubbed drifted ruleset ⇒ structured `drift[]` + non-zero exit; compliant ⇒ exit 0.
5. gh absent/error ⇒ result-object reason, exit 2 in apply/verify, exit 0 in plan.
6. `generate-codeowners.js`: renders `* @a @b` from config; empty owners ⇒ no file; per-path entries.
7. `secure-baseline-wiring`: `require_code_owner_review:true` + missing CODEOWNERS ⇒ violation;
   present ⇒ clean.
8. Scaffold round-trip: a scaffolded target contains `.github/CODEOWNERS` (when owners configured)
   and the `github` manifest block.
9. `validate-harness-manifest.js` passes with the new sensor; control-budget 126; `npm test` green.

## Rollout / compatibility

- Existing repos: unaffected until an org-admin runs `--apply`. `plan`/`verify` are safe read-only.
- `secure-baseline-wiring` CODEOWNERS requirement is strict-tier-only and gated on
  `require_code_owner_review` — repos with it false, or on standard tier, are unaffected.
- Control-budget +1 is a one-time expected bump, committed with the change.
- Whole-branch review on the strongest model before merge.
