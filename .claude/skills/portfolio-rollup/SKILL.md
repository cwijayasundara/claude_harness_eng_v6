---
name: portfolio-rollup
description: Aggregate per-repo compliance attestations into one integrity-hashed portfolio rollup — verifying each attestation's sha256 integrity, recording an unattested repo as a compliance gap, and computing harness-version drift across the fleet. Use over a local collection directory of attestations, or with --fetch to gather them via fleet.json + gh api. --verify re-checks a stored rollup's own integrity.
argument-hint: "<collection-dir> [--target-version X] [--fetch] [--fleet <file>] [--out <path>] [--verify <file>] [--json]"
---

# Portfolio Compliance Rollup

Aggregates a collection of per-repo Increment-4a attestations (`.claude/attestations/<sha>.json`)
into a single, integrity-hashed portfolio compliance report (Increment 4b). It answers the
CISO-mandate question the per-repo attestation cannot: *is the whole portfolio compliant, on-version,
and uncorrupted?* Each input attestation's sha256 integrity is verified before it is counted, a repo
with no attestation is recorded as a gap, and per-repo harness-version drift is computed.

## When to use

- To roll up a directory of collected per-repo attestations into one portfolio verdict.
- With `--fetch` to gather the latest attestation from each fleet repo via `gh api` first, then roll up.
- To `--verify <file>` a stored rollup's own integrity checksum (corruption detection — the
  checksum is stored inside the file it covers, so it is not proof of authenticity; that needs signing).

## Do not use

- To generate a single repo's attestation — that is `/attestation` (`generate-attestation.js`). This
  skill only reads and aggregates 4a attestations; it never mutates them.
- To provision branch protection or deploy environments (`/provision`, its `protection`/`environments` modes).

## How it works

```
node .claude/scripts/portfolio-rollup.js <collection-dir>                      # roll up a local collection
node .claude/scripts/portfolio-rollup.js <collection-dir> --target-version 2.5.0
node .claude/scripts/portfolio-rollup.js <collection-dir> --fetch --fleet fleet.json
node .claude/scripts/portfolio-rollup.js --verify .claude/attestations/portfolio-rollup.json
```

- **Collection dir vs `--fetch`** — the collection directory is the core, offline, deterministic mode:
  it enumerates per-repo attestation files (a flat `<owner>__<repo>.json` set OR a per-repo subdir).
  `--fetch [--fleet fleet.json]` first gathers each fleet repo's latest attestation via
  `gh api repos/{owner}/{repo}/contents/...` (base64-decoded into the collection dir), then rolls up.
  `--fetch` needs `gh` installed, authenticated, with **org read** access; owner/repo are segment-validated
  before any gh path; a repo whose attestation is missing (404) is skipped and surfaces as `not-attested`;
  gh absent/auth/permission exits 2 with a reason.
- **Integrity is verified, not trusted** — each input attestation is re-hashed (canonical
  content-minus-integrity, sha256) and compared to its stored `integrity.hash`. A tampered / failed /
  wrong-algo attestation is `integrity_ok:false`, counted `integrity_failed`, and **never** counted
  compliant. A missing attestation for a `--fleet` repo is a recorded `not-attested` compliance gap —
  never silently omitted (no vacuous portfolio green).
- **Version drift** — each repo's `harness_version` is compared (pure numeric `major.minor.patch`
  semver) against `--target-version`, else the running harness version: `current` | `behind` | `ahead` |
  `unknown` (a missing or non-semver version is `unknown`, never a silent `current`).
- **`portfolio_compliant`** is fail-safe: `true` only when the portfolio is non-empty AND every repo is
  compliant + `integrity_ok` + attested. Any non-compliant / not-evaluated / not-attested /
  integrity_failed repo, or an empty portfolio, makes it `false`.
- **The rollup is itself checksummed** — the report carries its own `integrity:{algo:'sha256',hash}` over
  its canonical content-minus-integrity; `--verify <file>` recomputes and compares, exiting non-zero on
  mismatch and never mutating the file.

## Where the report lives

The rollup is written to `--out` (default `.claude/attestations/portfolio-rollup.json`). Like the 4a
attestation, this is a **corruption-detecting checksummed artifact, not authenticity** — anyone with
write access can rewrite the content and its hash, so a `--verify` PASS means "not accidentally
corrupted", not "genuine". Cryptographic authenticity / non-repudiation requires signing
(GPG/cosign/Sigstore) — the same documented seam as Increment 4a, not built here.

When authoring or editing this skill, follow `docs/prompting-standards.md`.
