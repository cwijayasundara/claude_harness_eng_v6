# Deployment-Approval GitHub Environments — Design

Date: 2026-07-19
Status: Approved for implementation (Increment 3 of the 4-increment security-compliance program)
Lane: `/change` (security/gate + platform-provisioning code — whole-branch review before merge)
Predecessors: Increment 1 (secure-repo baseline + ratchet, f4f81ca), Increment 2 (branch-protection
provisioner + CODEOWNERS, 26e76a2) — both merged to main.

## Context

The client CISO mandate (point c, Aug 1) requires branch protection, CODEOWNERS, **and
deployment-approval gates** operational on all active repositories. Increment 2 shipped branch
protection + CODEOWNERS. This increment adds the deployment-approval gate: a GitHub **Environment**
with required reviewers that must approve before a deploy job runs.

Audit facts: the `/deploy` skill is purely local (docker-compose + init.sh); it produces no CI deploy
workflow and references no GitHub Environment. No shipped workflow template uses `environment:`. So a
GitHub Environment approval gate — which only fires when a deployment **job references
`environment: <name>`** — is currently absent end-to-end.

### Hard constraint

**No client-specific identifiers in code.** Reviewer IDs (numeric user/team IDs), org, repo, and
environment reviewer handles are all client-specific; none are hardcoded. Reviewers default to `[]`
(the same literal-free pattern as `bypass_actors:[]` and `default_owners:[]`), with a loud
ACTION-REQUIRED notice, and `--verify` reports zero-reviewer environments non-compliant.

### Decisions (locked with stakeholder, 2026-07-19)

- **Skeleton + wiring check**: ship an environment-gated `deploy.yml` skeleton AND provision the
  environment AND enforce (wiring gate) that a deploy workflow references the environment — so the
  gate is real out-of-box and cannot be silently removed (mirrors `security.yml` +
  `secure-baseline-wiring`).
- **production only, protected-branch**: default one `production` environment with
  `deployment_branch_policy.protected_branches:true`; config-extensible to more environments.

### Reusable shapes (from the Increment-3 scout)

- `provision-protection.js` is the sibling model: `defaultGh`/injected-runner, `parseFlags` →
  plan(default)/apply/verify + `--repo`/`--fleet`, `ghJson` result-object (never throws), segment
  validation (`SEGMENT`/`validSegment`/`invalidScopeReason`), config via `readGithub(cwd)`, verify
  report under `specs/reviews/`.
- `ruleset-diff.js` is the pure-diff model → a sibling `env-diff.js`.
- `scaffold-security-baseline.js#materializeSecurityBaseline`/`materializeCodeowners` +
  `GITHUB_DEFAULTS`/`applyGithubDefault` (deep-merge) are the materializer models; the
  empty-owners `ACTION REQUIRED` stderr warning is the empty-reviewers pattern to mirror.
- Environments API: `gh api --method PUT repos/{owner}/{repo}/environments/{name}` with body
  `{wait_timer, reviewers:[{type,id}], deployment_branch_policy:{protected_branches,custom_branch_policies}}`.
  PUT is idempotent (no POST/PUT split). `deployment_branch_policy.protected_branches:true` is
  literal-free.
- control-budget baseline = **126**; a new control is #127 and MUST carry `net_add_justification`.
  `scope:"portfolio"` is a valid vocabulary value.
- Tests: `ghStub` arg-matching (`test/provision-protection.test.js`), scaffold round-trip
  (`test/scaffold-github-provisioner.test.js`).

## Goals

1. A `github.environments` config block driving the provisioner + skeleton.
2. `provision-environments.js` — plan / `--apply` / `--verify`, idempotent, no-throw,
   approval-gate floor (zero reviewers ⇒ non-compliant).
3. A generic environment-gated `deploy.yml` skeleton, materialized into scaffolded repos.
4. `secure-baseline-wiring` additionally requires a deploy workflow referencing a configured
   environment when `github.environments` is non-empty.
5. One new registered control (`deploy-gate-verify`) + a thin `provision-environments` skill.

## Non-goals (later)

- Credential rotation / history-scrub / incident-report tooling (Phase A runbook).
- Durable evidence / attestation generator / portfolio rollup (Increment 4). `deploy-gate-verify.json`
  seeds it, as `branch-protection-verify.json` does.
- Real deploy commands (project-specific — the skeleton is an inert placeholder teams fill in).
- Merge auto-approval or changing `/deploy`'s local docker-compose flow.

## Components

### C1. `github.environments` config

Added to `project-manifest.json#github` and `GITHUB_DEFAULTS` (empty/strong defaults):
```jsonc
"environments": [
  { "name": "production",
    "reviewers": [],                 // [{ "type":"User"|"Team", "id":<numeric> }]; empty default
    "wait_timer": 0,
    "protected_branches": true }     // deployment_branch_policy.protected_branches
]
```
- Empty/absent `environments` ⇒ no environment provisioning and no deploy-wiring requirement (not
  every project deploys via GitHub Actions). Provisioner prints "no environments configured", exit 0.
- `applyGithubDefault` deep-merges so a partial `github` block still inherits the default
  `environments`.

### C2. `provision-environments.js`

Sibling of `provision-protection.js`:
- **`plan`** (default): GET each configured environment, diff vs desired, print
  create/update/compliant; exit 0; never errors (no config / no gh). Prints the org-admin note.
- **`--apply`**: for each environment, `gh api --method PUT repos/{owner}/{repo}/environments/{name}`
  with the desired body (idempotent). Org-scope note: environments are inherently **per-repo** (no
  org-level environments API), so apply requires `--repo <owner/repo>` or `--fleet fleet.json`; with
  neither, apply prints an error (exit 2) explaining environments are repo-scoped. Emits the loud
  ACTION-REQUIRED reviewer notice when a provisioned environment has empty reviewers.
- **`--verify`**: GET environments, diff vs desired → `specs/reviews/deploy-gate-verify.json`; exit
  non-zero on drift. **Approval-gate floor**: an environment whose live `reviewers` is empty (or
  whose `protected_branches` is false) is reported non-compliant regardless of config, because a
  deploy-approval gate needs ≥1 approver and a branch restriction.
- Desired body builder is config-driven with the floor applied on the verify side. Reviewer entries
  validated: `type ∈ {User,Team}`, `id` a positive integer; malformed reviewer ⇒ error (exit 2),
  never silently dropped.
- gh via injected runner, literal argv (org/repo/name never shell-interpolated); segment validation
  reused from the Increment-2 pattern. `env-diff.js` holds the pure diff (`planDiff`, `computeDrift`,
  `compareEnvironment`).

### C3. `deploy.yml` skeleton template

`.claude/templates/github-workflows/deploy.yml`:
```yaml
name: Deploy
on:
  workflow_dispatch: {}          # manual only — never auto-deploys
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production      # ← the approval gate fires here (name from config)
    steps:
      - uses: actions/checkout@<sha>
      - name: Deploy (placeholder)
        run: |
          echo "::error::ACTION REQUIRED: replace this placeholder with the real deploy for this project."
          exit 1                 # inert until wired — no green deploy that deployed nothing
```
- Rendered by `materializeDeployWorkflow(target)` (mirrors `materializeSecurityBaseline`), the
  `environment:` value taken from the first configured environment's `name`. Written to
  `<target>/.github/workflows/deploy.yml`. No client literals; checkout pinned to a SHA.

### C4. `secure-baseline-wiring` gate extension

In `security-baseline.js#wiringViolations` (+ caller): when the target's
`project-manifest.json#github.environments` is non-empty, require `.github/workflows/deploy.yml` to
exist AND contain an `environment:` referencing one of the configured environment names. Missing file
or missing/mismatched `environment:` ⇒ wiring violation (BLOCK, strict-tier only). Conditional on
config; extends an existing control — **no new control-budget entry.**

### C5. Registration + skill

- Register `deploy-gate-verify` in `harness-manifest.json#sensors`: axis `traceability`, type
  `computational`, cadence `drift`, scope `portfolio`, status `active`, `wired_at`
  `provision-environments.js`, with `net_add_justification`. Control-budget **126 → 127**. Update
  `HARNESS.md`; re-run `validate-harness-manifest.js`.
- Thin `.claude/skills/provision-environments/SKILL.md`: plan → apply → verify, the org-admin
  requirement, that environments are per-repo (use `--repo`/`--fleet`), and that reviewer IDs must be
  configured for the gate to require approval.

## Data flow

```
project-manifest.json#github.environments ─┬─► provision-environments.js
                                           │       plan   → diff vs live env (GET)          → stdout
                                           │       apply  → PUT environments/{name} (per repo) → env protected
                                           │       verify → GET → drift[] (floor: reviewers≥1) → specs/reviews/deploy-gate-verify.json
                                           └─► materializeDeployWorkflow → .github/workflows/deploy.yml (environment: <name>)

.github/workflows/deploy.yml ◄─ secure-baseline-wiring gate (strict) asserts present + references environment when environments configured
```

## Error handling / policy

- `plan` never errors (exit 0) with no config / no gh — read-only preview.
- `apply`/`verify` exit 2 on gh absence/auth/permission, on missing `--repo`/`--fleet` (environments
  are repo-scoped), and on malformed reviewer entries; never partially-apply silently.
- Idempotent PUT: re-apply is a no-op update.
- No client literals; empty `environments` = safe no-op; empty reviewers = loud warning + verify
  non-compliant.

## Testing (TDD, `ghStub` + real-shape)

1. Desired-environment body matches the documented environments API shape (wait_timer, reviewers,
   deployment_branch_policy.protected_branches).
2. `plan`: stubbed live env ⇒ correct create/update/compliant diff; exit 0.
3. `--apply`: PUT argv + body per environment; idempotent; missing `--repo`/`--fleet` ⇒ exit 2.
4. `--verify`: empty-reviewers live env ⇒ non-compliant drift + non-zero exit; protected_branches
   false ⇒ drift; fully-configured ⇒ compliant.
5. Reviewer validation: malformed reviewer (non-numeric id / bad type) ⇒ exit 2.
6. gh absent/error ⇒ result-object reason; exit 2 in apply/verify, exit 0 in plan.
7. `deploy.yml` skeleton renders with the configured environment name; checkout SHA-pinned.
8. `secure-baseline-wiring`: environments configured + missing/unreferenced deploy.yml ⇒ violation;
   present + referencing a configured env ⇒ clean; no environments configured ⇒ no requirement.
9. Scaffold round-trip: a scaffolded target contains `.github/workflows/deploy.yml` and the
   `github.environments` manifest block.
10. `validate-harness-manifest.js` passes; control-budget 127; `npm test` green.

## Rollout / compatibility

- Existing repos unaffected until an org-admin runs `--apply` and configures reviewer IDs.
  `plan`/`verify` are safe read-only.
- The deploy-workflow wiring requirement is strict-tier-only and gated on non-empty
  `github.environments` — projects without it, or on standard tier, are unaffected.
- Control-budget +1 is a one-time expected bump, committed with the change.
- Whole-branch review on the strongest model before merge.
