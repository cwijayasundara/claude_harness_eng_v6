---
name: provision-protection
description: Provision GitHub branch protection (org-level ruleset primary, per-repo fallback) so the gitleaks + sast checks and code-owner review actually block merges. Plan-first, dry-run by default; --apply mutates, --verify checks drift. Use when a repo/org needs enforced branch protection or CODEOWNERS wired, or to verify an existing ruleset has not drifted.
argument-hint: "[plan|--apply|--verify] [--repo <owner/repo>] [--fleet fleet.json]"
---

# Provision Branch Protection

Turns Increment 1's scanners (`gitleaks`, `sast`) from *running* into *merge-blocking* by
provisioning a GitHub **Ruleset** that marks those checks required and requires code-owner review.
Every identifier (org, repo, checks, owners) comes from `project-manifest.json#github` — nothing is
hardcoded. Empty config is a safe no-op.

## When to use

- An org or repo needs enforced branch protection (required checks + code-owner review + no
  force-push / deletion) provisioned or updated.
- You want to verify a previously-applied ruleset has not drifted from the desired spec.

## Do not use

- To author scanners/workflows themselves — that is Increment 1 (`security.yml`).
- Deployment-approval environments — Increment 3.

## Prerequisites

- `gh` installed, authenticated, and reasonably recent.
- `project-manifest.json#github.org` set (org scope) — or pass `--repo` / `--fleet` (repo scope).
- **`--apply` requires org-admin (or repo-admin) rights.** `plan` and `--verify` are read-only.

## Procedure

1. **Plan (default, read-only — always run first):**

   ```bash
   node .claude/scripts/provision-protection.js plan
   ```

   Prints `would create` / `would update (field: a→b)` / `already compliant`, plus the org-admin
   note. Never errors (exit 0), even with no `github` config or no `gh`.

2. **Generate CODEOWNERS** (so `require_code_owner_review` is not inert) once
   `github.default_owners` is set:

   ```bash
   node .claude/scripts/generate-codeowners.js
   ```

3. **Apply** (an org-admin runs this — it mutates GitHub):

   ```bash
   node .claude/scripts/provision-protection.js --apply                 # org scope
   node .claude/scripts/provision-protection.js --apply --repo owner/repo   # single repo
   node .claude/scripts/provision-protection.js --apply --fleet fleet.json  # repo fleet
   ```

   Idempotent: creates the ruleset if absent (POST), updates it in place if present (PUT). **Once
   applied, merge-blocking is real** — a PR failing `gitleaks`/`sast` or lacking code-owner approval
   can no longer merge. `gh` absent/unauthenticated/too-old ⇒ exit 2 with a clear reason.

4. **Verify** (CI or an admin can gate on this):

   ```bash
   node .claude/scripts/provision-protection.js --verify
   ```

   Reads back the live ruleset, writes `specs/reviews/branch-protection-verify.json`, and exits
   non-zero on drift (missing/extra/mismatched rules).

## Config (`project-manifest.json#github`)

| Key | Meaning |
|---|---|
| `org` | GitHub org (org scope). Empty ⇒ use `--repo` / `--fleet` |
| `default_branch` | Protected default branch |
| `required_checks` | Status-check contexts to require (default `gitleaks`, `sast`) |
| `required_approvals` | Required approving reviews |
| `require_code_owner_review` | Require CODEOWNERS approval (also gated by the wiring guard) |
| `enforce_admins` | `true` ⇒ empty `bypass_actors` (admins cannot bypass) |
| `ruleset_scope` | `org` \| `repo` |
| `ruleset_name` | Ruleset name matched for idempotent create/update |
| `default_owners` / `path_owners` | CODEOWNERS owners (no literals ship by default) |

## Related

- `fleet.json` — optional `{ "org": "", "repos": [{ "owner": "", "repo": "" }] }` registry consumed
  by `--apply --fleet` (and the Increment 4 portfolio rollup). Empty by default.
- `secure-baseline-wiring` (strict) additionally requires a non-empty `.github/CODEOWNERS` when
  `require_code_owner_review` is true.
