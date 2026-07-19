---
name: provision-environments
description: Provision GitHub deployment-approval Environments (per-repo) so a deploy job pauses for required-reviewer approval before it runs. Plan-first, dry-run by default; --apply mutates, --verify checks drift + the approval-gate floor. Use when a repo needs an enforced deploy-approval gate wired, or to verify a configured environment has not drifted or lost its reviewers.
argument-hint: "[plan|--apply|--verify] --repo <owner/repo> | --fleet fleet.json"
---

# Provision Deployment-Approval Environments

Turns the deploy-approval gate from *absent* into *enforced* by provisioning a GitHub
**Environment** with required reviewers, so a deploy job that references `environment: <name>` pauses
for approval before it runs (Increment 3). Every identifier (repo, environment name, reviewer ids)
comes from `project-manifest.json#github.environments` — nothing is hardcoded. Empty/absent
`environments` is a safe no-op ("no environments configured", exit 0), and empty reviewers are a loud
`ACTION REQUIRED` warning on apply and non-compliant at `--verify`.

## When to use

- A repo needs a deployment-approval gate (required reviewers + protected-branch policy) provisioned
  or updated on a GitHub Environment.
- You want to verify a previously-applied environment has not drifted and still has ≥1 reviewer.

## Do not use

- To author the deploy workflow itself — the `deploy.yml` skeleton is materialized at scaffold time
  (`environment:` already wired to the configured name).
- Branch protection / CODEOWNERS — that is Increment 2 (`provision-protection`).

## Prerequisites

- `gh` installed, authenticated, and reasonably recent.
- **Environments are per-repo** — there is no org-level environments API. `--apply` / `--verify`
  require `--repo <owner/repo>` or `--fleet fleet.json`; with neither they exit 2.
- **`--apply` requires org-admin (or repo-admin) rights.** `plan` and `--verify` are read-only.
- **Reviewer ids must be configured for the gate to require approval.** Set
  `github.environments[].reviewers` to `[{ "type": "User"|"Team", "id": <numeric> }]`. Until then the
  environment exists but approval is not required, and `--verify` reports it non-compliant.

## Exit codes

- **0** — success and the gate is live (plan/verify clean; apply provisioned every environment with ≥1 reviewer).
- **2** — error or bad config: `gh` absent/unauthenticated, missing `--repo`/`--fleet`, a malformed reviewer, or an invalid environment name.
- **3** — `--apply` only: environments were provisioned but at least one has **empty reviewers**, so the deploy-approval gate is **not** live yet. Distinct from 0 so automation never reads a successful PUT as "gate enforced." Configure reviewer ids, then re-apply.

## Procedure

1. **Plan (default, read-only — always run first):**

   ```bash
   node .claude/scripts/provision-environments.js plan --repo owner/repo
   ```

   Prints `would CREATE` / `would UPDATE (field: a→b)` / `already compliant`, plus the org-admin
   note. Never errors (exit 0), even with no config or no `gh`.

2. **Configure reviewer ids** in `project-manifest.json#github.environments[].reviewers` so the gate
   actually requires approval (empty reviewers ⇒ no approval required, and non-compliant at verify).

3. **Apply** (an org-admin runs this — it mutates GitHub):

   ```bash
   node .claude/scripts/provision-environments.js --apply --repo owner/repo   # single repo
   node .claude/scripts/provision-environments.js --apply --fleet fleet.json  # repo fleet
   ```

   Idempotent: an environment PUT creates it if absent and updates it in place if present (no
   POST/PUT split). A provisioned environment with empty reviewers prints a loud `ACTION REQUIRED`
   notice. `gh` absent/unauthenticated/too-old, a missing `--repo`/`--fleet`, or a malformed reviewer
   entry ⇒ exit 2 with a clear reason.

4. **Verify** (read-only drift + approval-gate floor):

   ```bash
   node .claude/scripts/provision-environments.js --verify --repo owner/repo
   ```

   Reads back each live environment, diffs it against the desired spec, and applies the
   **approval-gate floor**: an environment whose live reviewers is empty OR whose `protected_branches`
   is false is non-compliant regardless of config (a deploy-approval gate needs ≥1 approver and a
   branch restriction). Writes `specs/reviews/deploy-gate-verify.json` and exits non-zero on drift so
   CI or an org-admin can gate on it.

## Notes

- All `gh` calls run through an injected runner with literal argv (repo/name never shell-
  interpolated) and result-object error handling — the provisioner never throws.
- `deploy-gate-verify.json` is the durable evidence artifact (seeds Increment 4 attestation, as
  `branch-protection-verify.json` does).
