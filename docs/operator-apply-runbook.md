# Operator Apply Runbook — turning the security-compliance gates ON

Audience: a GitHub **org-admin** (or repo-admin) with `gh` installed and authenticated.
Purpose: take the compliance machinery the harness builds — secret-scan + SAST PR gates,
branch-protection rulesets, CODEOWNERS, deployment-approval environments, and portfolio
attestation — from *planned* to *live* on real repositories.

This is an **operations** document, not product code. The harness ships the tested
plan/verify/apply scripts and the CI templates; **applying** them changes live GitHub
settings and therefore requires a human with admin rights. Nothing here contains
client-specific identifiers — every value below is a placeholder you replace from your own
`project-manifest.json` / `fleet.json`.

> **Why an operator has to run this at all.** `plan` and `verify` are read-only and safe to
> run anywhere (CI included). `--apply` mutates org/repo settings (rulesets, environments) and
> needs admin scope on a `gh` token the harness never holds. The scripts are idempotent and
> plan-first by design so you always preview before you change anything.

---

## 0. Prerequisites (once)

```bash
gh --version            # gh present
gh auth status          # authenticated; the account must have admin on the target org/repos
gh auth token | head -c 4; echo ' …'   # a token is available to gh
```

The apply commands fail loud with exit `2` and a one-line reason if `gh` is missing,
unauthenticated, too old, or lacks admin rights — they never partially-apply silently.

### Config surfaces the scripts read

All identity comes from **`project-manifest.json#github`** in the repo you run from (no
literals in code). The relevant fields, with the security floor the scripts enforce
regardless of what you put here:

```jsonc
{
  "quality": { "sast_engine": "semgrep" },   // or "veracode" (see §1)
  "github": {
    "org": "your-org",                        // org-scope ruleset target
    "ruleset_name": "secure-baseline",        // the ruleset the provisioner manages by name
    "ruleset_scope": "org",                    // "org" (default) or "repo"
    "target_repos": "~ALL",                    // org-scope only: which repos the ruleset covers
    "required_approvals": 1,                    // floored to >= 1
    "require_code_owner_review": true,
    "required_checks": ["gitleaks", "sast"],  // gitleaks+sast ALWAYS unioned in, even if omitted
    "default_owners": ["@your-org/platform-team"],   // CODEOWNERS `*` catch-all
    "path_owners": {                            // optional per-path CODEOWNERS lines
      "/infra/": ["@your-org/sre"]
    },
    "environments": [
      { "name": "production", "wait_timer": 0,
        "reviewers": [ { "type": "Team", "id": 1234567 } ],   // see §3 for finding ids
        "protected_branches": true }
    ]
  }
}
```

For a **fleet** (many repos at once), a `fleet.json` alongside it:

```jsonc
{ "org": "your-org",
  "repos": [ { "owner": "your-org", "repo": "service-a" },
             { "owner": "your-org", "repo": "service-b" } ] }
```

The security floor is **absolute and additive-only**: `gitleaks` + `sast` are always required
checks and approvals are always ≥ 1 — config can *add* checks, never *subtract* the floor.

---

## 1. Point (b) — secret-scan + SAST PR gates

Two halves: the **CI workflow** that produces the `gitleaks` and `sast` check runs, and the
**ruleset** (in §2) that marks those checks *required to merge*.

1. **Ship the workflow.** `/scaffold` (or `scaffold-upgrade`) already writes
   `.github/workflows/security.yml` into the target repo, with the SAST job selected from
   `quality.sast_engine`:
   - `semgrep` — runs immediately, no secrets needed (recommended to start).
   - `veracode` — requires repo/org secrets `VERACODE_API_ID` + `VERACODE_API_KEY`; without
     them the `sast` check **fails loud** (never a silent green).
   Confirm the two jobs exist and are named so their check contexts are exactly `gitleaks`
   and `sast` (these are the contexts §2 requires):
   ```bash
   grep -E '^\s{2}(gitleaks|sast):' .github/workflows/security.yml
   ```
2. **Push once** so GitHub registers the check contexts (a ruleset can only require a context
   GitHub has seen at least once). Open a throwaway PR or push to a branch and let the
   Security workflow run.
3. The **PR gate** itself is the ruleset in §2 — apply that next.

---

## 2. Point (c.1) — branch-protection ruleset + CODEOWNERS

### 2a. CODEOWNERS (do this before the ruleset)

`require_code_owner_review` is inert without a CODEOWNERS file. Generate it from config:

```bash
node .claude/scripts/generate-codeowners.js
# -> writes .github/CODEOWNERS, or says default_owners is empty (then it writes nothing —
#    an owner-less CODEOWNERS is worse than none). Commit the file.
```

Owners must be `@user`, `@org/team`, or an email; the generator rejects anything with
whitespace/newlines. Commit `.github/CODEOWNERS` so the ruleset's code-owner rule can resolve
owners.

### 2b. Provision the ruleset

Always `plan` first (read-only), then `--apply`, then `--verify`.

```bash
# PLAN — GET the live ruleset, diff vs desired, print create/update/compliant. Exit 0.
node .claude/scripts/provision-protection.js

# APPLY — idempotent create-or-update. Org scope = one call; needs org-admin.
node .claude/scripts/provision-protection.js --apply

# VERIFY — GET live, report drift, write specs/reviews/branch-protection-verify.json.
#          Exit 0 compliant / 1 drift / 2 read error.
node .claude/scripts/provision-protection.js --verify
```

**Fleet / single-repo variants** (repo-scoped rulesets omit the org `repository_name` target
automatically):

```bash
node .claude/scripts/provision-protection.js --apply --repo your-org/service-a
node .claude/scripts/provision-protection.js --apply --fleet fleet.json
```

After apply you'll see `created`/`updated … Merge-blocking is now live.` A non-compliant PR is
now blocked: `gitleaks` + `sast` must pass, ≥ 1 code-owner approval, no force-push, no branch
deletion.

---

## 3. Point (c.2) — deployment-approval environments

GitHub Environments are **per-repo** (no org-level API), so apply **requires** `--repo` or
`--fleet` — there is no org-wide form.

### 3a. Find reviewer ids (the one genuinely manual bit)

Reviewers are client-specific numeric ids; the harness can't guess them. Resolve them once:

```bash
gh api users/USERNAME --jq .id                       # a User reviewer id
gh api orgs/your-org/teams/TEAM-SLUG --jq .id        # a Team reviewer id
```

Put them into `project-manifest.json#github.environments[].reviewers` as
`{ "type": "User"|"Team", "id": <number> }`.

### 3b. Provision

```bash
node .claude/scripts/provision-environments.js --repo your-org/service-a            # plan
node .claude/scripts/provision-environments.js --apply --repo your-org/service-a    # apply
node .claude/scripts/provision-environments.js --verify --repo your-org/service-a   # verify
# or fleet-wide:
node .claude/scripts/provision-environments.js --apply --fleet fleet.json
```

> **Exit `3` = provisioned but NOT gating.** If you apply with an empty `reviewers` array, the
> environment is created but **does not require approval** — the script exits `3` (distinct from
> `0`) with an `ACTION REQUIRED` notice so automation can't mistake it for a live gate. Set
> reviewer ids (§3a) and re-apply until you get exit `0`.

The deploy workflow template (`deploy.yml`) references the environment via `environment:`; the
approval gate blocks that job until a required reviewer approves.

---

## 4. Point (d) — attestation + portfolio rollup

Once §1–§3 are live, each repo's attestation reflects real compliance.

```bash
# Per-repo: assemble a sha256-checksummed evidence bundle at the current commit.
node .claude/scripts/generate-attestation.js
# -> .claude/attestations/<sha>.json (+ index.json). Commit it as durable evidence.
# Verify integrity later:
node .claude/scripts/generate-attestation.js --verify .claude/attestations/<sha>.json

# Portfolio: aggregate all repos' latest attestations into one rollup.
#   Offline (attestations already collected into a dir):
node .claude/scripts/portfolio-rollup.js ./collected-attestations
#   Fetch mode (gather via fleet.json + gh api, then roll up):
node .claude/scripts/portfolio-rollup.js ./collected-attestations --fetch --fleet fleet.json
```

The rollup is fail-safe: a repo with **no** attestation is a recorded `not-attested` gap, a
tampered attestation is `integrity_failed` and never counted compliant, and an empty portfolio
is **never** a green. `portfolio_compliant` is `true` only when every repo is attested,
integrity-valid, and compliant.

> **Integrity ≠ authenticity.** The embedded sha256 is a *corruption-detecting checksum* — it
> proves the file wasn't accidentally mangled, not that it's authentic. Anyone with write
> access can rewrite content and hash together. Non-repudiation needs GPG/cosign/Sigstore
> signing — a documented seam, not yet built.

---

## 5. Recommended order & idempotency

```
(1) security.yml shipped + pushed once   → gitleaks/sast contexts exist
(2) generate-codeowners.js + commit      → code-owner rule can resolve
(3) provision-protection.js --apply      → PR merge-blocking live      [point b + c.1]
(4) provision-environments.js --apply    → deploy approval live        [point c.2]
(5) generate-attestation.js (per repo)   → per-repo evidence           [point d]
(6) portfolio-rollup.js                  → portfolio evidence          [point d]
```

Every `--apply` is **idempotent** — re-running matches the live state to desired (create if
absent, update if drifted, no-op if compliant). Re-run `--verify` any time (or in CI) to prove
the gates are still in place; verify exits non-zero on drift so a job can gate on it.

## 6. Exit-code reference

| Script | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| `provision-protection.js` | plan ok / apply ok / verify compliant | verify drift | usage / gh / config / no-admin | — |
| `provision-environments.js` | plan ok / apply ok / verify compliant | verify drift | usage / gh / config / no-admin | applied but empty reviewers (not gating) |
| `generate-attestation.js` | attested / already / verify match | verify tamper | usage / bad sha | — |
| `portfolio-rollup.js` | rollup written / verify match | verify mismatch | usage / fetch error | — |

## 7. What this runbook does NOT cover

- **Credential remediation** (mandate point a — rotate leaked creds, scrub git history,
  incident reports): a separate ops runbook, mostly `git-filter-repo`/BFG + your secret
  manager.
- **Bulk fleet retrofit.** To apply §2b + §3 across an entire fleet in one command and get a
  single per-repo compliance report, use the fleet-retrofit runner instead of looping by hand:
  ```bash
  node .claude/scripts/fleet-retrofit.js --fleet fleet.json            # audit (read-only)
  node .claude/scripts/fleet-retrofit.js --fleet fleet.json --apply    # apply both gates + re-verify
  ```
  It invokes the §2/§3 provisioners per repo, isolates per-repo failures (one repo's error never
  aborts the rest), and writes `specs/reviews/fleet-retrofit.json` (each repo gated / drifted /
  not-gating / failed). Exit 0 iff every repo is gated. See the `fleet-retrofit` skill. (CODEOWNERS
  §2a and attestation §4 still run per repo — the runner is API-gates-only, no checkout.)
- **Signing** the attestation for non-repudiation (the documented seam in §4).
