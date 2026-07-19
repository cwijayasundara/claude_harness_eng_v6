# Portfolio Compliance Rollup + Harness-Version Drift — Design

Date: 2026-07-19
Status: Approved for implementation (Increment 4b of the 4-increment security-compliance program)
Lane: `/change` (compliance/evidence code — whole-branch review before merge)
Predecessors: Inc 1 (f4f81ca), Inc 2 (26e76a2), Inc 3 (76563f0), Inc 4a (per-repo attestation, 0176b62)
— all merged to main.

## Context

The CISO mandate (point d, Aug 30) requires full SDLC-standards compliance **across the portfolio**
with attestation. Increment 4a produced the per-repo durable, sha256-integrity attestation
(`.claude/attestations/<sha>.json`). This increment aggregates those per-repo attestations into a
single portfolio compliance rollup, and adds the harness-version-drift check the mandate's
"across the portfolio" and the Increment-4 plan (D3) call for. It is the last build for point (d).

### Hard constraint

**No client-specific identifiers in code.** Org/repo/reviewer identity is read from `fleet.json` /
git at runtime; the target version is config/CLI-supplied; nothing is hardcoded.

### Decisions (locked with stakeholder, 2026-07-19)

- **Rollup input**: a local collection directory of per-repo attestations is the core (offline,
  deterministic, testable); an optional `--fetch` mode gathers them via `fleet.json` + `gh api`.
  The rollup reads each attestation's **hash-covered authoritative** `compliant`/`status`, and
  **verifies each attestation's integrity first** — a tampered/failed attestation is excluded from
  the compliant count.
- **Version stamp**: `harness_version` is written into each scaffolded repo's `project-manifest.json`
  at scaffold time; `generate-attestation.js` prefers it over `package.json`.

### Grounding (from prior scouts)

- `generate-attestation.js#readHarnessVersion` (lines 62-64) currently reads only `package.json`
  version — in a scaffolded repo that is the *project's* version, not the harness's; version-drift
  has nothing correct to read today.
- `scaffold-apply.js#writeManifest` (line 122) writes `project-manifest.json` to the target and calls
  `scaffold-security-baseline.js#applyGithubDefault` / `applySastEngineDefault` — the insertion point
  for a `harness_version` stamp.
- Harness version = `2.5.0` in `package.json` + `.claude/.claude-plugin/plugin.json`.
- `fleet.template.json` = `{ org, repos:[{owner,repo}] }`; provisioners read `repos[]` via `--fleet`,
  segment-validate owner/repo, use an injected `gh` runner (result-object, never throws).
- 4a per-repo attestation shape (hash-covered): `{ schema_version, evidence_format_version, repo,
  commit_sha, generated_at, harness_version, standard_ref, control_inventory, controls[], verify,
  gate, ratchets, status, compliant, sources_evaluated, sources_total, integrity:{algo,hash} }`.
  `.claude/attestations/index.json` = `{ entries:[{commit_sha, generated_at, compliant, status,
  sources_evaluated, path}], integrity:{algo,hash} }`.
- `canonical-json.js` exports deep-canonical serialize + `contentHash` (integrity-field-excluded) +
  sha256; `attestation-io.js` has `readJson`/index helpers.
- `validate-harness-manifest.js` scopes include `portfolio`; control-budget baseline = 128; a new
  control needs a non-empty `net_add_justification`; ships to targets via `scaffold-copy.js`
  `CORE_SCRIPTS`/`CORE_SKILLS`.
- Tests: `ghStub` arg-matching + scaffold round-trip; round-trip REAL 4a-generated attestations.

## Goals

1. Stamp `harness_version` into scaffolded repos; `generate-attestation.js` prefers it.
2. `portfolio-rollup.js` — aggregate a collection of per-repo attestations into an integrity-hashed
   portfolio report, verifying each input's integrity and computing version-drift; optional `--fetch`.
3. Register one control (`portfolio-compliance-rollup`) + a thin `portfolio-rollup` skill.

## Non-goals (later / separate)

- Real GPG/cosign signing (documented seam only).
- Scheduled/automated fetch; a CI job wiring.
- The operator apply-runbook (`--apply` sequence for org-admin) — a separate doc deliverable.
- Fleet-retrofit bulk-apply runner for existing repos.
- Phase A credential-remediation runbook.

## Components

### C1. Harness-version stamping

- `scaffold-security-baseline.js`: new `applyHarnessVersion(manifest, harnessVersion)` writing
  `manifest.harness_version = harnessVersion` unless already present (operator value preserved).
  `scaffold-apply.js#writeManifest` reads the harness's `package.json` version (from `pluginSource`'s
  repo root) and passes it in. `scaffold-upgrade.js` updates `harness_version` to the current version
  on upgrade.
- `generate-attestation.js#readHarnessVersion(root)`: prefer `project-manifest.json#harness_version`
  if a non-empty string, else the existing `package.json` version fallback, else `null`. So a
  scaffolded repo's attestation reports the harness version it was built/upgraded with.

### C2. `portfolio-rollup.js`

CLI: `node .claude/scripts/portfolio-rollup.js <collection-dir> [--target-version X] [--fetch]
[--fleet <file>] [--out <path>] [--json]`.

**Core (collection-dir mode):**
- Enumerate per-repo attestation files in `<collection-dir>` (one latest attestation per repo; a repo
  subdir or a flat set of `<repo>.json` — accept both; a sibling directory layout is documented).
- For each: `readJson`; **verify integrity** via `contentHash` (recompute over canonical
  content-minus-integrity, compare to stored `integrity.hash`, assert `integrity.algo === 'sha256'`).
  `integrity_ok=false` on mismatch/absent/wrong-algo.
- Per-repo row: `{ repo, commit_sha, status, compliant, harness_version, integrity_ok, version_drift }`.
  - `compliant` counts toward portfolio compliance **only if `integrity_ok` and `status==='compliant'`**
    — a tampered/failed-integrity attestation is `integrity_failed`, never counted compliant.
  - `version_drift` = semver-compare `harness_version` vs target (`--target-version`, else the running
    harness `package.json` version): `current | behind | ahead | unknown`; missing/unparseable version
    ⇒ `unknown` (never silently `current`).
- A fleet repo (from `--fleet`, when provided) with **no attestation file** ⇒ a row
  `{ repo, status:'not-attested', compliant:false, integrity_ok:false, version_drift:'unknown' }` —
  a recorded compliance gap, never silently omitted (no vacuous portfolio green).
- Report (written to `--out`, default `.claude/attestations/portfolio-rollup.json`), itself
  integrity-hashed via `canonical-json`:
  ```jsonc
  { "schema_version":1, "generated_at":"<iso>", "target_harness_version":"<x>",
    "repos":[ ...rows ],
    "summary":{ "total":N, "compliant":N, "non_compliant":N, "not_evaluated":N,
                "not_attested":N, "integrity_failed":N, "version_current":N, "version_behind":N },
    "version_drift":[ { "repo","harness_version","target" } ],
    "portfolio_compliant": <bool>,       // true iff total>0 AND every repo compliant+integrity_ok+attested
    "integrity":{ "algo":"sha256", "hash":"<hex>" } }
  ```
  `portfolio_compliant` is fail-safe: `false` if any repo is non-compliant, not-evaluated, not-attested,
  or integrity_failed, and `false` when `total===0` (empty portfolio is not a green).
- `--verify <file>`: recompute the rollup's own integrity, exit 0 match / non-zero mismatch.

**`--fetch [--fleet fleet.json]`:** for each `repos[]` entry, `gh api
repos/{owner}/{repo}/contents/.claude/attestations/index.json` → pick the latest entry → `gh api
repos/{owner}/{repo}/contents/<path>` → base64-decode → write into `<collection-dir>/<owner>__<repo>.json`.
Injected `gh` runner (result-object, never throws); owner/repo segment-validated (reuse the provisioner
validator; reject `..`/`/`); a repo whose file is absent (`gh` 404) ⇒ skipped and later surfaces as
`not-attested`; gh absent/auth ⇒ exit 2 with a clear reason. `--fetch` then runs the core over the
populated dir.

### C3. Registration + skill

- Register `portfolio-compliance-rollup` in `harness-manifest.json#sensors`: axis `traceability`, type
  `computational`, cadence `drift`, scope `portfolio`, status `active`, `wired_at`
  `.claude/scripts/portfolio-rollup.js`, with `net_add_justification`. Control-budget **128 → 129**.
  Update `HARNESS.md`; re-run `validate-harness-manifest.js`.
- `.claude/skills/portfolio-rollup/SKILL.md`: collection-dir vs `--fetch`, that it verifies each
  attestation's integrity and treats a missing attestation as a gap, the org-read requirement for
  `--fetch`, and that the rollup report is itself a corruption-detecting-checksummed artifact
  (authenticity via signing = the same documented seam as 4a). Follow `docs/prompting-standards.md`.
- Add `portfolio-rollup.js` to `scaffold-copy.js` `CORE_SCRIPTS` and `portfolio-rollup` to
  `CORE_SKILLS`.

### C4. Reuse

- `canonical-json.js` for integrity (both verifying inputs and hashing the rollup output).
- `attestation-io.js#readJson`; the `fleet.json` reader + `validSegment` + injected-`gh` idiom from
  `provision-protection.js`/`provision-environments.js`.
- A small pure `semverCompare(a, b)` helper (numeric major.minor.patch; non-semver ⇒ `unknown`) — no
  external dependency.

## Data flow

```
scaffold-apply → project-manifest.json#harness_version ─► generate-attestation (prefers it)
                                                              │
per-repo .claude/attestations/<sha>.json (4a, hash-covered) ─┤
                                                              ▼
   --fetch (fleet.json + gh api, base64) ─► collection-dir ─► portfolio-rollup.js
        verify each integrity → aggregate → semver-drift → .claude/attestations/portfolio-rollup.json (hash-covered)
```

## Error handling / policy

- Fail-safe aggregation: not-attested / integrity_failed / not-evaluated / non-compliant all keep
  `portfolio_compliant=false`; empty portfolio ⇒ false. A tampered attestation is never counted green.
- `--fetch`: gh absent/auth/permission ⇒ exit 2 with reason; a repo's missing attestation ⇒ recorded
  gap, not a crash; owner/repo segment-validated before any `gh api` path.
- Core (no `--fetch`) never needs network; `--verify` never mutates.
- No client literals; version target is CLI/config; identity from fleet/git at runtime.

## Testing (TDD, real-artifact)

1. Aggregate a collection of REAL 4a-generated attestations (generate via `generate-attestation.js`
   into a tmp collection) → correct `summary` counts and `portfolio_compliant`.
2. **Integrity gate**: a tampered attestation in the collection ⇒ `integrity_ok:false`,
   `integrity_failed` counted, excluded from `compliant`, `portfolio_compliant:false`.
3. Missing attestation for a `--fleet` repo ⇒ `not-attested` row + gap; not silently dropped.
4. Version-drift: `behind`/`current`/`ahead` via `semverCompare`; missing/garbage version ⇒ `unknown`.
5. `portfolio_compliant` fail-safe: any bad repo ⇒ false; empty portfolio ⇒ false; all-good ⇒ true.
6. Rollup output is integrity-hashed; `--verify` catches a mutation.
7. `--fetch` via `ghStub`: fleet.json → `contents` index → base64 attestation → collection dir; a 404
   repo ⇒ later `not-attested`; gh absent ⇒ exit 2; a traversal owner/repo ⇒ rejected.
8. `applyHarnessVersion`: scaffold round-trip stamps `harness_version`; existing value preserved.
9. `generate-attestation` prefers `project-manifest.json#harness_version` over `package.json`.
10. `validate-harness-manifest.js` passes; control-budget 129; `npm test` green.

## Rollout / compatibility

- Additive: new script + skill + one manifest entry + a scaffold stamp + a `readHarnessVersion`
  preference. No existing gate behavior changes.
- Existing scaffolded repos without a stamp ⇒ attestation `harness_version` falls back to
  `package.json` (unchanged behavior) until re-scaffolded/upgraded; version-drift reports `unknown`
  for them (honest, not a false `current`).
- Control-budget +1 is a one-time expected bump, committed with the change.
- Whole-branch review on the strongest model before merge.
