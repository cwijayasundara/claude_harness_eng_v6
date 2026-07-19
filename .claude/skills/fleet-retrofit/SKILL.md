---
name: fleet-retrofit
description: Bring an existing fleet of repos into compliance across BOTH live gates (branch-protection ruleset + deploy-approval environment) in one command, returning a single per-repo report of which repos are gated, drifted, provisioned-but-not-gating, or failed. Audits (read-only) by default; --apply provisions then re-verifies. Per-repo failures are isolated so one repo's error never aborts the fleet.
argument-hint: "--fleet <file> [--apply] [--out <path>] [--json]"
---

# Fleet-Retrofit Runner

Retrofits an existing fleet of repositories with the security-compliance gates in one command,
instead of running `provision-protection` and `provision-environments` by hand per repo. It answers
the portfolio-scoped **live-platform** question none of the single-gate sensors can: *does every repo
have BOTH its branch-protection ruleset and its deploy-approval environment actually in place right
now?* It orchestrates the Increment 2/3 provisioners per repo and aggregates their real exit codes.

## When to use

- To **audit** (default, read-only) which repos in `fleet.json` are already gated and which are not —
  the retrofit worklist. Changes nothing.
- To **`--apply`** the branch-protection ruleset + deploy-approval environment across the whole fleet,
  then re-verify each, in a single run.

## Do not use

- To provision a single repo / the org ruleset — use `/provision-protection` and
  `/provision-environments` directly (this skill orchestrates them across many repos).
- To generate or aggregate compliance **evidence** — that is `/attestation` (per repo) and
  `/portfolio-rollup` (aggregate attestations). This runner reads **live GitHub gate state**, not
  attestation files.
- To generate CODEOWNERS or commit into each repo — those need a per-repo working tree and are out of
  scope (this runner is pure `gh api`, no checkout).

## How it works

```
node .claude/scripts/fleet-retrofit.js --fleet fleet.json            # audit (read-only)
node .claude/scripts/fleet-retrofit.js --fleet fleet.json --apply    # apply then re-verify
node .claude/scripts/fleet-retrofit.js --fleet fleet.json --json     # also print the report object
```

- **`fleet.json`** = `{ org, repos:[{owner, repo}] }` (identity at runtime). The branch-protection and
  environment **specs** come from `project-manifest.json#github` — the single operator config the
  provisioners read; there are no client literals in the runner.
- **Per-repo isolation** — each provisioner is invoked per repo (`--repo owner/repo`). A repo that
  errors (no admin, 404, gh down) becomes a `failed` row and **never aborts the rest**, so the report
  is always the complete fleet picture. `--apply` requires org/repo-admin on `gh`; audit is read-only.
- **Per-repo classification** — each gate is `gated` / `drifted` / `not-gating` / `not-configured` /
  `failed` from the provisioners' exit codes (`--verify`: 0 compliant / 1 drift / 2 error; env
  `--apply` code 3 = provisioned but empty reviewers = `not-gating`). A repo is `gated` only when
  **both** gates are gated; otherwise it takes its worst gate.
- **An unconfigured gate is `not-configured`, never `gated`** — the provisioners return exit 0 for
  "nothing to provision", so the runner decides configured-ness from the manifest up front: no
  `project-manifest.json#github` ⇒ branch-protection `not-configured`; empty/absent
  `github.environments` ⇒ deploy-approval `not-configured`. A `not-configured` gate is never counted as
  gated and keeps `fleet_gated:false`, so a repo whose gate simply doesn't exist can **never** read as a
  false green. Configure the ruleset/environment(s) for those gates to become meaningful.
- **`fleet_gated`** is fail-safe: `true` only when the fleet is non-empty AND every repo is `gated`; an
  empty fleet or any non-gated repo (drifted, not-gating, not-configured, failed) makes it `false`.

## Exit codes & report

- Exit **0** iff `fleet_gated` (every repo gated); **1** if any repo is not gated (the report is still
  fully written — read it for the worklist); **2** for usage / unreadable or malformed `fleet.json` /
  a traversal owner/repo entry (rejected before any `gh` call).
- The report is written to `--out` (default `specs/reviews/fleet-retrofit.json`): per-repo
  `{ repo, branch_protection, deploy_gate, status }` rows (each gate/status one of gated / drifted /
  not-gating / not-configured / failed) plus a `summary` and `fleet_gated`. It is an
  operational action-log (not a signed/evidence artifact — the durable evidence is the per-repo
  attestation and the portfolio rollup).

See `docs/operator-apply-runbook.md` for the full org-admin apply sequence. When authoring or editing
this skill, follow `docs/prompting-standards.md`.
