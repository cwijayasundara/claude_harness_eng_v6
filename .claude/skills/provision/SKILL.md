---
name: provision
description: Provision the GitHub security-compliance gates and verify they hold. Three modes — protection (branch-protection ruleset so gitleaks+sast+code-owner review block merges), environments (deploy-approval environment so a deploy pauses for a required reviewer), fleet (retrofit BOTH gates across many repos and report per-repo status). Plan-first, dry-run by default; --apply mutates, --verify checks drift. Use when a repo or org needs an enforced branch-protection or deploy-approval gate wired or updated, when verifying a gate has not drifted, or when auditing/retrofitting a whole fleet.
argument-hint: "protection|environments|fleet [plan|--apply|--verify] [--repo <owner/repo>] [--fleet fleet.json]"
---

# Provision the Security-Compliance Gates

Turns the CISO-mandate gates from *present* into *merge-* or *deploy-blocking*, and verifies
they stay that way. Every identifier (org, repo, checks, owners, reviewers, environment names)
comes from `project-manifest.json#github` — nothing is hardcoded, and empty config is a safe
no-op. The backing scripts are unchanged; this skill is the single entry point that routes to
the right one.

## Which mode

| Intent | Mode | Backing script |
|---|---|---|
| A repo/org needs required checks + code-owner review that block merges (or verify that ruleset) | **protection** | `provision-protection.js` |
| A repo needs a deploy job to pause for a required reviewer (or verify that environment) | **environments** | `provision-environments.js` |
| Audit or retrofit BOTH gates across many repos in one run | **fleet** | `fleet-retrofit.js` |

Use **protection** or **environments** for a single repo/org gate; use **fleet** to see or fix
the whole portfolio at once (it orchestrates the other two per repo). `plan` / audit / `--verify`
are read-only; `--apply` mutates GitHub and needs org- or repo-admin rights.

## Prerequisites (all modes)

- `gh` installed, authenticated, and reasonably recent (`gh` absent/unauthenticated/too-old ⇒ a clear non-zero exit, never a throw).
- The relevant `project-manifest.json#github` config set (see each mode). Empty/absent config is a safe no-op.
- **`--apply` requires org-admin (or repo-admin).** `plan` and `--verify` are read-only.

---

## Mode: protection — branch-protection ruleset

Provisions a GitHub **Ruleset** that marks `gitleaks`/`sast` required and requires code-owner
review, so a PR failing a scanner or lacking code-owner approval can no longer merge (Increment 2).

1. **Plan (read-only, run first):**
   ```bash
   node .claude/scripts/provision-protection.js plan
   ```
   Prints `would create` / `would update (field: a→b)` / `already compliant` + the org-admin note. Never errors (exit 0).
2. **Generate CODEOWNERS** once `github.default_owners` is set (so `require_code_owner_review` is not inert):
   ```bash
   node .claude/scripts/generate-codeowners.js
   ```
3. **Apply** (org-admin; mutates GitHub — idempotent create-or-update):
   ```bash
   node .claude/scripts/provision-protection.js --apply                     # org scope
   node .claude/scripts/provision-protection.js --apply --repo owner/repo    # single repo
   node .claude/scripts/provision-protection.js --apply --fleet fleet.json   # repo fleet
   ```
4. **Verify** (CI/admin gate — writes `specs/reviews/branch-protection-verify.json`, non-zero on drift):
   ```bash
   node .claude/scripts/provision-protection.js --verify
   ```

Config keys (`project-manifest.json#github`): `org`, `default_branch`, `required_checks`
(default `gitleaks`, `sast`), `required_approvals`, `require_code_owner_review`, `enforce_admins`,
`ruleset_scope` (`org`|`repo`), `ruleset_name`, `default_owners`/`path_owners`.

---

## Mode: environments — deploy-approval environment

Provisions a GitHub **Environment** with required reviewers, so a deploy job that references
`environment: <name>` pauses for approval before it runs (Increment 3). Environments are
**per-repo** (no org-level API): `--apply`/`--verify` need `--repo <owner/repo>` or `--fleet`.

1. **Plan (read-only, run first):**
   ```bash
   node .claude/scripts/provision-environments.js plan --repo owner/repo
   ```
2. **Configure reviewer ids** in `github.environments[].reviewers` (`[{ "type": "User"|"Team", "id": <numeric> }]`) — until set, the environment exists but approval is not required, and `--verify` reports it non-compliant.
3. **Apply** (org-admin; idempotent PUT):
   ```bash
   node .claude/scripts/provision-environments.js --apply --repo owner/repo   # single repo
   node .claude/scripts/provision-environments.js --apply --fleet fleet.json  # repo fleet
   ```
4. **Verify** (writes `specs/reviews/deploy-gate-verify.json`, non-zero on drift):
   ```bash
   node .claude/scripts/provision-environments.js --verify --repo owner/repo
   ```
   Applies the **approval-gate floor**: empty live reviewers OR `protected_branches:false` is non-compliant regardless of config.

Exit codes: **0** live/clean · **2** error or bad config (missing `--repo`/`--fleet`, malformed
reviewer, bad name) · **3** (`--apply` only) provisioned but empty reviewers, so the gate is not
live yet — distinct from 0 so automation never reads a PUT as "enforced."

---

## Mode: fleet — retrofit both gates across a fleet

Answers the portfolio-scoped live-platform question the single-gate modes cannot: *does every
repo have BOTH its branch-protection ruleset and its deploy-approval environment in place right
now?* Orchestrates the protection + environments provisioners per repo and aggregates their real
exit codes. Audits (read-only) by default; `--apply` provisions then re-verifies.

```bash
node .claude/scripts/fleet-retrofit.js --fleet fleet.json            # audit (read-only)
node .claude/scripts/fleet-retrofit.js --fleet fleet.json --apply    # apply then re-verify
node .claude/scripts/fleet-retrofit.js --fleet fleet.json --json     # also print the report object
```

- **`fleet.json`** = `{ org, repos:[{owner, repo}] }` (identity at runtime); the gate **specs** still come from `project-manifest.json#github`.
- **Per-repo isolation** — a repo that errors (no admin, 404, gh down) becomes a `failed` row and never aborts the rest, so the report is always the complete fleet picture.
- **Per-repo classification** — each gate is `gated` / `drifted` / `not-gating` / `not-configured` / `failed`; a repo is `gated` only when **both** gates are, else it takes its worst gate. An unconfigured gate is `not-configured`, never `gated`, so a missing gate can never read as a false green.
- **`fleet_gated`** is fail-safe: `true` only when the fleet is non-empty AND every repo is `gated`.
- Exit **0** iff `fleet_gated`; **1** if any repo is not gated (report still written to `--out`, default `specs/reviews/fleet-retrofit.json`); **2** for usage / malformed `fleet.json`.

---

## Related & scope

- Do **not** use this skill to author the scanners/workflows themselves (`security.yml`, `deploy.yml` are materialized at scaffold time) or to generate compliance **evidence** — that is `/attestation` (per repo) and `/portfolio-rollup` (aggregate). This skill reads/writes **live GitHub gate state**, not attestation files.
- `fleet.json` — optional `{ "org": "", "repos": [{ "owner": "", "repo": "" }] }` registry (empty by default), also consumed by the portfolio rollup.
- `secure-baseline-wiring` (strict tier) additionally requires a non-empty `.github/CODEOWNERS` when `require_code_owner_review` is true.
- `branch-protection-verify.json` / `deploy-gate-verify.json` are the durable evidence artifacts that seed the attestation.
- See `docs/operator-apply-runbook.md` for the full org-admin apply sequence.
