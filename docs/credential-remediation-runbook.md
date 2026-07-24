# Credential-Remediation Runbook — a leaked secret was found in a repo

Audience: a repo maintainer + whoever owns the leaked credential's system (cloud account,
database, third-party service). Purpose: neutralize a secret that reached git — **rotate first**,
then scrub history, then prove it can't recur.

This is an **operations** runbook, not product code. It is generic and carries no client-specific
identifiers — replace every placeholder from your own inventory. It pairs with the harness's
already-shipped prevention layer (secret-scan pre-commit + the `gitleaks`/SAST PR gate from the
secure-repo baseline); this document covers the part prevention can't: cleaning up a leak that
already happened.

> **The one rule that matters most.** A secret that was ever pushed to a shared remote must be
> treated as **compromised the moment it left your machine** — clones, forks, CI logs, caches, and
> mirrors may already have it. **Rotation is the only action that actually makes a leaked secret
> safe.** History scrubbing reduces further exposure but never un-leaks it. Do them in that order,
> and never let a scrub give false comfort that rotation can be skipped.

---

## 0. Prerequisites

```bash
gitleaks version     # secret scanner (the harness's enhanced secrets tier)
git filter-repo --version   # history-rewrite tool (preferred; pip install git-filter-repo)
# BFG is an alternative history tool if filter-repo is unavailable.
```

Have on hand: admin access to each **system** whose credential leaked (to rotate it), and
maintainer/force-push access to each affected repo.

---

## 1. Inventory the leak (know exactly what, where, and since when)

You cannot rotate or scrub what you haven't enumerated. Scan **both** the working tree and the
**full history**.

```bash
# Working tree + staged (the harness's tier-aware scan: baseline regex + gitleaks):
node .claude/scripts/security-scan.js --secrets

# FULL HISTORY across all refs (this is what a leak audit needs — a secret can be
# gone from HEAD but alive in an old commit):
gitleaks detect --source . --log-opts="--all" --report-path leak-report.json
```

For each finding record, in a private tracking sheet (never commit it): the **secret type**
(API key / DB password / cloud access key / OAuth token / private key / webhook secret), the
**system it authenticates to**, the **first commit** that introduced it (`git log -S '<fragment>'
--all --oneline` — search a *non-secret* fragment, don't paste the secret into your shell history),
and the **exposure window** (introduced → detected). The exposure window and whether the remote is
public/shared drive the blast-radius assessment in the incident report (§5).

---

## 2. Rotate / revoke — FIRST, before any history rewrite

Rotate every enumerated secret at its **source system**. Order: issue the new credential →
deploy it to the secret manager + CI/CD secrets → cut traffic over → **revoke the old one**. Revoke
even if you also plan to scrub — the leaked value is compromised regardless of git state.

| Secret type | Rotation action |
|---|---|
| Cloud access key (AWS/GCP/Azure) | Create a new key, update the secret store, disable then delete the old key; review CloudTrail/audit logs for use during the exposure window. |
| Database credential | Create a new user/password, update the app config/secret manager, drop or disable the old credential. |
| API key / service token | Regenerate in the provider console; update consumers; delete the old key. |
| OAuth / refresh token | Revoke the token/grant; re-issue; rotate the client secret if that also leaked. |
| Private key / certificate | Generate a new keypair, re-issue/re-deploy, revoke the old key (and its cert if applicable). |
| Signing / webhook secret | Rotate at the provider; update verifiers. |

Store the new values only in the secret manager / repo-or-org **secrets** — never back in the repo.
(The secure-repo baseline's pre-commit + CI secret scan will block a re-introduction.)

**Do not proceed to §3 until every leaked secret is rotated and the old value revoked.**

---

## 3. Scrub git history

History rewriting is disruptive: it changes every commit SHA from the first affected commit forward,
breaks existing clones/forks/open PRs, and requires a coordinated force-push. Rotation (§2) has
already neutralized the secret; this step removes the value from the repository to limit further
copying and satisfy the "history scrubbed" requirement.

```bash
# Preferred: git-filter-repo. Put the exact leaked strings (one per line) in a
# local file, then replace them everywhere in history:
#   secrets.txt:  <leaked-value>==>REDACTED   (one rule per line)
git filter-repo --replace-text secrets.txt
# Or drop whole files that should never have been committed:
git filter-repo --path path/to/leaked.env --invert-paths
```

Then coordinate the rewrite:

1. Notify collaborators (the force-push will require everyone to re-clone or hard-reset).
2. `git push --force --all` and `git push --force --tags` to every remote.
3. Have collaborators **re-clone** (a `pull` after a history rewrite corrupts their local history).
4. On the platform: delete/rewrite affected **open PRs** (they can retain the old blobs), and ask
   the platform provider to **purge cached views** of the old commits — GitHub caches commit/blob
   views and may retain them until support garbage-collects. Delete stale **forks**.
5. Invalidate any CI **build logs / artifacts** that printed the secret.

> Scrubbing is best-effort against copies you don't control. That is exactly why §2 (rotation) is
> the load-bearing step and comes first.

---

## 4. Prevent recurrence (mostly already shipped)

The secure-repo baseline is the prevention layer — make sure it's actually on for this repo:

- **Secret scanning is live** — `.github/workflows/security.yml` runs `gitleaks` on every PR/push
  (full history, `fetch-depth: 0`), and the pre-commit hook + pre-write gate scan locally. See the
  operator apply-runbook §1.
- **The PR gate blocks merges** — the branch-protection ruleset marks `gitleaks` a required check
  (operator apply-runbook §2). Without the ruleset applied, the scan runs but does not *block*.
- **Tune the allowlist honestly** — put genuine false positives (test fixtures, sample values) in
  `.gitleaks.toml`; never allowlist a real secret to silence the gate.

---

## 5. Incident report (durable evidence)

Produce one report per incident, in a neutral evidence format (map the fields to your
organization's required report format in your own config — no format is hardcoded here). Suggested
fields:

| Field | Content |
|---|---|
| `secret_type` / `system` | What leaked and what it authenticates to. |
| `introduced_at` | First commit SHA + date the secret entered history. |
| `detected_at` | When/how it was found (audit, scan). |
| `exposure_window` | introduced → revoked; whether the remote was public/shared. |
| `blast_radius` | Systems reachable with the secret; audit-log review result for use during the window. |
| `rotation` | New credential issued + old revoked (timestamps). |
| `history_scrub` | Tool used, refs rewritten, force-push + cache-purge completed. |
| `prevention` | Secret-scan gate + branch-protection required-check confirmed live for the repo. |
| `residual_risk` | Copies not controllable (forks/mirrors/caches) and mitigation. |

Keep the report as durable evidence. The harness's per-commit attestation
(`generate-attestation.js`) and portfolio rollup capture the *prevention* posture (the gate is live
and un-drifted); this incident report is the *remediation* record that complements it.

---

## 6. Verification checklist

- [ ] Full-history scan (§1) enumerated every leaked secret across all refs.
- [ ] **Every** secret rotated at its source and the old value **revoked** (§2).
- [ ] Audit logs reviewed for use of the leaked secret during the exposure window.
- [ ] History rewritten, force-pushed to all remotes, collaborators re-cloned, cached
      views/forks/CI logs purged (§3).
- [ ] `gitleaks detect --log-opts=--all` now returns **no findings** on the rewritten history.
- [ ] Secret-scan PR gate + branch-protection required-check confirmed live for the repo (§4).
- [ ] Incident report written and stored (§5).

## 7. Out of scope

- Turning the gates on across the org (operator apply-runbook + `/provision` fleet mode).
- Cryptographic signing of the incident report / attestation (documented signing seam).
