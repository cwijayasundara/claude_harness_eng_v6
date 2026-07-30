# Secure-Repo Baseline + `/auto` Security Ratchet — Design

Date: 2026-07-18
Status: Approved for implementation (Increment 1 of a 4-increment security-compliance program)
Lane: `/change` (security/gate code — whole-branch review + control-budget registration required)

## Context

A client CISO mandate requires, across a portfolio of active repositories:
(a) leaked-credential remediation, (b) gitleaks secret-scanning + SAST as **enforced PR gates**,
(c) branch protection / CODEOWNERS / deployment-approval gates, and (d) portfolio-wide SDLC
compliance with attestation evidence.

An audit of this harness (2026-07-18, three Explore agents) found its security discipline is
**in-session / local-commit only**, **not** propagated to scaffolded repos, and **not**
enforced at the GitHub-platform level:
- Real gitleaks runs only in *this* repo's CI; `scaffold-copy` ships neither `.gitleaks.toml`
  nor a gitleaks/SAST workflow, so downstream repos rely on a weak 8-pattern regex
  (`.claude/hooks/lib/secrets.js`).
- SAST (Semgrep, via `.claude/scripts/security-scan.js`) runs only in-session, only on a
  security-boundary trigger, and **fails open** (silently returns zero findings when the
  scanner binary is absent).
- No security control is wired into the `/auto` ratchet the way `cycle` / `coupling` /
  `duplication` ratchets are.

This document specifies **Increment 1**: a generic, config-driven secure-repo baseline plus a
security ratchet integrated into the pre-commit gate registry and surfaced at `/auto` Gate 7.

### Hard constraint

**No client-specific identifiers in code.** No client names, no external clause/section labels,
no organization literals in any template, script, schema, or state file. Everything ships
generic and config-driven; client-specific values live in the target repo's
`project-manifest.json` or config, never in harness code.

### Decisions (locked with stakeholder, 2026-07-18)

- SAST engine: **Semgrep now, Veracode later** via a `quality.sast_engine` seam.
- Scope: full-portfolio *design*, but Increment 1 ships the propagation template + ratchet;
  the branch-protection provisioner and fleet retrofit are Increment 2.
- Ratchet shape: **findings ratchet + presence invariant**, fail-closed in the `strict` tier.

## Goals (Increment 1)

1. Every scaffolded repo inherits real gitleaks + Semgrep as **blocking** CI jobs.
2. A `security-baseline` ratchet gate enforces that findings only go down, wired into the
   pre-commit registry and surfaced at `/auto` Gate 7.
3. A `secure-baseline-wiring` presence invariant prevents silently removing or downgrading the
   guards.
4. `security-scan.js` becomes tier-aware: fail-closed for required scanners in `strict`.
5. Both new controls are registered in `harness-manifest.json` and pass
   `validate-harness-manifest.js`.

## Non-goals (later increments)

- Branch-protection provisioner + required-status-check enforcement (Increment 2).
- Fleet-apply / retrofit of existing (non-scaffolded) repos (Increment 2/3).
- CODEOWNERS generator, GitHub Environment deploy-approval gates (Increment 3).
- Durable evidence, attestation generator, portfolio rollup, version-drift check (Increment 4).
- Credential rotation / history-scrub / incident-report tooling (Phase A runbook).

## Components

### C1. Tier-aware `security-scan.js`

`.claude/scripts/security-scan.js` + `.claude/hooks/lib/security-scan.js`.

- Add a `tier` input to the scan entry point (default resolved from
  `sensor-tier.loadSensorTier`).
- Required scanners for the enforced path: `gitleaks` (secrets), the configured
  `sast_engine` (default `semgrep`).
- **strict tier:** a required scanner missing from PATH → **blocking** error
  (non-zero, explicit "SENSOR REQUIRED but not installed" message), never a silent zero-finding
  pass.
- **minimal/standard tiers:** unchanged `noteSkip` behavior (loud warning, non-blocking) so
  repos that have not yet provisioned the scanner are not bricked.
- Finding normalization is unchanged.

### C2. `security-baseline` ratchet gate

New gate in `.claude/hooks/lib/gates-strict.js` (`checkSecurityBaseline`), registered in
`.claude/hooks/lib/gate-registry.js` `GATE_CATALOG` at **order 160**, `runsWithoutSource: true`
(secrets must be caught even on a docs/config-only commit), `minTier: 'strict'`.

Mechanics mirror `checkDuplicationRatchet`:
- Run gitleaks + the configured SAST engine over the working/staged tree via C1.
- **Secrets — absolute, never grandfathered:** any secret finding not suppressed by the
  existing `harness:secret-ok` line marker → immediate `failBlock`. No secret baseline file
  exists; a secret is never "pre-existing debt."
- **SAST high/critical — ratcheted:** compute stable finding keys, compare count against
  `.claude/state/security-baseline.txt` using the shared `cycle-gate.gateDecision(keys,
  baseline)` helper. New findings above baseline → `failBlock` (listing only the newly added
  keys); existing findings grandfathered. Rewrite the baseline on pass (best-effort, same as the
  other ratchets).
- Findings below `high` severity: recorded but not blocking (report-only), consistent with
  `security-scan.js`'s default `high` threshold.
- Tool-unavailable behavior delegates to C1 (block in strict, note-skip otherwise).

`/auto` Gate 7 already runs the gate registry / `security-scan`; it surfaces the
`security-baseline` outcome through the existing gate-outcome path — no separate `/auto` wiring
beyond registry membership.

### C3. `secure-baseline-wiring` presence invariant

New gate `checkSecureBaselineWiring` (in `gates-strict.js`), `GATE_CATALOG` order 165,
`runsWithoutSource: true`, `minTier: 'strict'`. Blocks when a guard is removed or downgraded:
- `.github/workflows/security.yml` (or the repo's configured workflow path) is absent.
- The gitleaks job or the SAST job in that workflow is missing or not blocking (e.g. has
  `continue-on-error: true`, or is not a required part of the run).
- `.gitleaks.toml` is absent.
- `project-manifest.json#quality.sast_engine` is unset.

Parsing is intentionally shallow (YAML job presence + `continue-on-error` check). It does **not**
verify GitHub branch-protection required-checks — that is server-side and belongs to Increment 2.

### C4. Generic propagation templates

- `.claude/templates/github-workflows/security.yml` — a config-driven workflow with two blocking
  jobs: `gitleaks` (`gitleaks/gitleaks-action@v2`, `fetch-depth: 0`) and `sast`, where the SAST
  step is selected from `quality.sast_engine`:
  - `semgrep` → `semgrep ci` (blocking, `--error`).
  - `veracode` → a placeholder job block wired to the same required-status contract, guarded so
    it is inert until credentials/config are supplied (documented, no client literals).
  - Org/repo/branch values come from workflow context or config — **no hardcoded literals.**
- `.claude/templates/gitleaks.toml` — `useDefault = true`, allowlists the standard test/template
  fixture paths and `.env*`.
- `scaffold-copy.js` (`copyScaffoldTree`) copies both into every profile's target `.claude/` and
  materializes `security.yml` into the target's `.github/workflows/` (matching how existing
  workflow templates are placed).
- `project-manifest.json` schema gains `quality.sast_engine` (enum `semgrep|veracode`, default
  `semgrep`); the scaffold writes the default.

### C5. Manifest registration

Add two entries to `harness-manifest.json#sensors`:
- `security-baseline` — axis `behaviour`, type `computational`, cadence `commit`, status
  `active`, `wired_at` → `gates-strict.js`.
- `secure-baseline-wiring` — axis `behaviour`, type `computational`, cadence `commit`, status
  `active`, `wired_at` → `gates-strict.js`.

Re-run `validate-harness-manifest.js`; the control-budget baseline
(`.claude/state/control-budget-baseline.json`) increments by 2 — expected, committed with the
change. Update `HARNESS.md` counts to match (regenerated from the manifest if a generator
exists; otherwise the sensor tables are edited to stay honest).

## Data flow

```
commit / /auto Gate 7
   └─ gate-registry.runPreCommit (tier)
        ├─ secret-scan (existing regex, order 10)          ← unchanged
        ├─ security-baseline (order 160, strict)
        │     ├─ security-scan.js (tier-aware, C1)
        │     │     ├─ gitleaks  → secret findings  → any new ⇒ BLOCK (absolute)
        │     │     └─ <sast_engine> → high/critical → ratchet vs state/security-baseline.txt
        │     └─ rewrite baseline on pass
        └─ secure-baseline-wiring (order 165, strict)
              └─ assert security.yml + .gitleaks.toml + sast_engine present & blocking
```

## Error handling / fail-open policy

- `strict` tier: required scanner missing ⇒ **block** (fail-closed). This is the enforced path
  used by `/auto` and CI-parity runs.
- `minimal`/`standard`: scanner missing ⇒ loud `noteSkip`, non-blocking (avoids bricking
  unprovisioned repos during rollout).
- A crash in the gate is caught by the existing pre-commit dispatcher, which logs to
  `hook-errors.log` and warns "NOT gated" — unchanged; a crashed gate is loud, never silent.
- `harness:secret-ok` marker semantics unchanged (per-line suppression, reviewer-visible).

## Testing (TDD, real-artifact)

Unit tests (added to the hook/gate test suite):
1. Findings ratchet: a new secret finding blocks even when SAST count is unchanged.
2. SAST grandfathering: a pre-existing high finding in the baseline does not block; a *new* one
   above baseline does; baseline is rewritten on pass.
3. Tier policy: missing scanner ⇒ block in `strict`, `noteSkip` in `standard`.
4. `harness:secret-ok` suppression still works through the new gate.
5. Presence invariant: deleted `security.yml`, a `continue-on-error: true` job, a missing
   `.gitleaks.toml`, and an unset `sast_engine` each block.

Round-trip / integration:
6. Render the **real** `security.yml` template (both `sast_engine` values) and assert both jobs
   are present and blocking — no hand-built fixture (per the repo's real-artifact rule).
7. `scaffold-copy` round-trip: a scaffolded target contains `security.yml`, `.gitleaks.toml`, and
   `quality.sast_engine` in its manifest.
8. `validate-harness-manifest.js` passes with the two new entries; `npm test` green.

## Rollout / compatibility

- Existing repos at `standard` tier see only warnings until they opt into `strict` or provision
  scanners — no hard break on upgrade.
- The control-budget +2 is a one-time expected bump, committed with the change.
- Whole-branch review on the strongest model before merge (security/gate code).
