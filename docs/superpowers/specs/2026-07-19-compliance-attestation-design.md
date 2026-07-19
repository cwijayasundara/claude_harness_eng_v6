# Per-Repo Durable Compliance Attestation — Design

Date: 2026-07-19
Status: Approved for implementation (Increment 4a of the 4-increment security-compliance program)
Lane: `/change` (compliance/evidence code — whole-branch review before merge)
Predecessors: Inc 1 (secure-repo baseline, f4f81ca), Inc 2 (branch-protection + CODEOWNERS, 26e76a2),
Inc 3 (deploy-approval environments, 76563f0) — all merged to main.

## Context

The client CISO mandate (point d, Aug 30) requires full SDLC-standards compliance across the
portfolio **with attestation submitted in a specified evidence format**. The Increment-1 audit found
the harness produces per-run verdicts but they are ephemeral: `**/specs/reviews/` and all `*.jsonl`
are gitignored, the two `*-verify.json` outputs (Inc 2/3) overwrite-in-place with no commit SHA or
timestamp, and the only durable committed evidence is the hand-authored
`.claude/certification/status.json`. There is no committed, SHA-keyed, per-repo evidence record.

This increment (4a) creates that record: a per-commit, durable, tamper-evident attestation bundle.
The portfolio rollup + version-drift check (D3) is deferred to Increment 4b.

### Hard constraint

**No client-specific identifiers in code.** The default standard-clause map uses a neutral generic
taxonomy; the real "Section 9" format/standard is a drop-in override supplied by config, never
hardcoded. Repo/org identity is read from git at runtime, not embedded.

### Decisions (locked with stakeholder, 2026-07-19)

- **Split**: 4a = per-repo durable attestation (this doc); 4b = portfolio rollup + harness
  version-drift (needs a version stamp added to scaffolded repos first).
- **Store + integrity**: one immutable, commit-SHA-keyed `.claude/attestations/<sha>.json` per
  attested commit (committed; `specs/reviews/` stays ephemeral) + an append-only `index.json`, each
  carrying a `sha256` integrity hash over its canonical content. Real GPG/cosign signing is a
  documented seam, not built here.
- **Standard mapping**: a default neutral clause taxonomy, remappable to the real standard later.

### Grounding (from the Increment-4 scout)

- `harness-manifest.json` = 44 guides + 83 sensors = 127 controls; `validate-harness-manifest.js`
  enforces the honesty invariant; scopes vocabulary already includes `repo` and `portfolio`.
- Verify outputs (exact shapes): `branch-protection-verify.json` =
  `{compliant, drift[], ruleset, target}` (flat, no timestamp); `deploy-gate-verify.json` =
  `{compliant, environments:[{environment, repo, compliant, drift[]}]}` (nested, no timestamp).
- `gate-receipt.json` = `{generated_at, pass, quality_card, walkthrough}` (committable, transient,
  not SHA-keyed). `quality-card.json` has a `summary:{pass,fail,missing,skipped}`.
- Ratchet baselines under `.claude/state/`: `coverage-baseline.txt`, `cycle-baseline.txt`,
  `coupling-baseline.txt`, `duplication-baseline.txt`, `security-baseline.txt`,
  `control-budget-baseline.json` (count 127). All committed.
- `.claude/state/` is tracked (not wholesale gitignored); `.claude/attestations/` under it will be
  committed with no gitignore change. `*.jsonl` is globally ignored — the index is `index.json`
  (`.json`), so it is fine.
- Harness version = `2.5.0` in both `package.json` and `.claude/.claude-plugin/plugin.json`.
  Scaffolded repos carry NO version marker today (relevant to 4b, stamped there).
- Control-budget bump: add the manifest entry with a non-empty `net_add_justification`; baseline
  re-ratchets 127→128 on the next passing run.
- Skills/scripts ship to targets via `scaffold-copy.js` `CORE_SKILLS`/`CORE_SCRIPTS`.
- Tests: ghStub/injected-runner + scaffold round-trip; round-trip the REAL manifest, not a fixture.

## Goals

1. `generate-attestation.js` — assemble a per-commit durable attestation from the manifest control
   inventory + verify outputs + gate verdict + ratchet baselines + a standard-clause map.
2. Write an immutable `.claude/attestations/<sha>.json` + append `index.json`, with a sha256
   integrity hash and a `--verify` tamper check.
3. A default `standard-map.json` (neutral, remappable).
4. Register one control (`compliance-attestation`) + a thin `attestation` skill, shipped to targets.

## Non-goals (→ Increment 4b / later)

- Portfolio rollup across the fleet; harness version stamping into scaffolded repos; version-drift.
- Real GPG/cosign signing (documented seam only).
- Auto-invoking the generator from the `/gate` hook (kept runnable at gate/CI; no prefix-cache churn).
- Modifying `quality-card.js` to read the verify outputs (the attestation aggregates them directly).
- Credential-remediation runbook (Phase A).

## Components

### C1. `generate-attestation.js`

CLI: `node .claude/scripts/generate-attestation.js [--force] [--verify <file>] [--json]`.

Reads (all durable/committed inputs; each optional input absent ⇒ recorded as `null`, never a crash):
- `harness-manifest.json` → `control_inventory` `{ total, guides, sensors, by_axis, by_status }` and
  a `controls[]` list `{ id, axis, cadence, status, standard_ref }` (standard_ref from C3).
- `specs/reviews/branch-protection-verify.json`, `specs/reviews/deploy-gate-verify.json` → `verify`
  `{ branch_protection, deploy_gate }` (verbatim or `null`).
- `.claude/state/gate-receipt.json` + `specs/reviews/quality-card.json` → `gate`
  `{ pass, quality_card_summary }`.
- Ratchet baselines → `ratchets` `{ coverage, cycle, coupling, duplication, security, control_budget }`
  (numeric counts / baseline values; `null` if absent).
- Identity: `git rev-parse HEAD` (commit_sha), origin slug (repo), `package.json` version
  (harness_version), injected ISO `generated_at`.

Bundle shape:
```jsonc
{
  "schema_version": 1,
  "evidence_format_version": "harness-attestation/1",   // remappable to the real Section-9 format id
  "repo": "<owner/repo>|null",
  "commit_sha": "<sha>",
  "generated_at": "<iso8601>",
  "harness_version": "2.5.0",
  "standard_ref": "<standard-map id, e.g. harness-default/1>",
  "control_inventory": { "total": 127, "guides": 44, "sensors": 83, "by_axis": {...}, "by_status": {...} },
  "controls": [ { "id": "...", "axis": "...", "cadence": "...", "status": "...", "standard_ref": "..." }, ... ],
  "verify": { "branch_protection": {...}|null, "deploy_gate": {...}|null },
  "gate": { "pass": true|false|null, "quality_card_summary": {...}|null },
  "ratchets": { "coverage": ..., "cycle": ..., "coupling": ..., "duplication": ..., "security": ..., "control_budget": 127 },
  "compliant": true|false,        // gate.pass !== false AND every present verify output compliant
  "integrity": { "algo": "sha256", "hash": "<hex>" }
}
```
- **Fail-safe tri-state (revised after whole-branch review).** Each of the three sources
  (branch_protection, deploy_gate, gate) is classified `absent` | `invalid` | `pass` | `fail`:
  `invalid` = present but unparseable or missing a boolean verdict (a corrupt file is never a silent
  pass). `status` = `non-compliant` if any *present* source is failing or invalid; `not-evaluated` if
  every source is absent; else `compliant`. Boolean `compliant = (status === "compliant")` — so an
  all-absent run is **not** a vacuous green (`compliant:false`, `status:"not-evaluated"`). `sources_evaluated`
  / `sources_total` record coverage; absent sources are still recorded `null` and invalid ones as
  `{invalid:true}` so an auditor tells "not run" from "ran but broken".
- **Integrity**: canonicalize the bundle with the `integrity` field removed via stable key sorting
  (a deterministic JSON serializer), `sha256` hex over the UTF-8 bytes, store under `integrity.hash`.
- **Immutability**: if `.claude/attestations/<sha>.json` exists, exit 0 as a no-op (print "already
  attested") unless `--force`. This keeps a committed record stable across re-runs even though
  `generated_at` would otherwise differ.
- **`--verify <file>`**: read the file, recompute the hash over its canonical content-minus-integrity,
  compare to the stored `integrity.hash`; exit 0 match / non-zero mismatch (tamper detected) with a
  clear diff message. Never mutates.
- **Index**: append `{ commit_sha, generated_at, compliant, path }` to `.claude/attestations/index.json`
  (an array; create if absent; dedupe by commit_sha — re-adding an existing SHA is a no-op).

### C2. Evidence store (committed)

`.claude/attestations/` (immutable `<sha>.json` + `index.json`) is created under the tracked
`.claude/` tree; no `.gitignore` change is required. `specs/reviews/` remains ephemeral. Document in
the skill that these files are the durable evidence and must be committed.

### C3. `standard-map.json` (default, remappable)

`.claude/templates/standard-map.json` (also read from repo root / `.claude/` if a project overrides
it): maps each control **axis** (and optionally specific ids) to a neutral clause id, e.g.
`{ "id": "harness-default/1", "by_axis": { "behaviour": "SDL-secure-development",
"traceability": "AUD-audit-traceability", "architecture": "ARC-architecture-integrity",
"maintainability": "MNT-maintainability" }, "by_id": {} }`. The generator resolves each control's
`standard_ref` via `by_id` (specific) then `by_axis` (fallback). Documented as replaceable with the
client's real standard map; `standard_ref` in the bundle records which map id was used. No client
literals.

### C4. Registration + skill

- Register `compliance-attestation` in `harness-manifest.json#sensors`: axis `traceability`, type
  `computational`, cadence `integration`, scope `repo`, status `active`, `wired_at`
  `generate-attestation.js`, with `net_add_justification`. Control-budget **127 → 128**. Update
  `HARNESS.md`; re-run `validate-harness-manifest.js`.
- `.claude/skills/attestation/SKILL.md`: how to `generate` (at gate/CI, then commit the record),
  `--verify` an existing attestation's integrity, where records live, and that the format is
  remappable to the client's Section-9 evidence format via `standard-map.json`. Follow
  `docs/prompting-standards.md`.
- Add `generate-attestation.js` to `scaffold-copy.js` `CORE_SCRIPTS` and `attestation` to
  `CORE_SKILLS`; ship `standard-map.json` to targets.

## Data flow

```
harness-manifest.json ─┐
verify/*-verify.json  ─┤
gate-receipt + quality-card ─┼─► generate-attestation.js ─► .claude/attestations/<sha>.json (immutable, sha256)
.claude/state/*-baseline ────┤                             └► .claude/attestations/index.json (append, dedupe)
standard-map.json (clause)  ─┘
git HEAD + origin + version ─┘   --verify <file> ─► recompute sha256 → match / TAMPER
```

## Error handling / policy

- Every optional input absent ⇒ `null` in the bundle (explicit "not evaluated"), never a crash and
  never a silent vacuous pass — `compliant` is only true when the evaluated inputs are non-failing.
- Immutable per SHA: re-run is a no-op unless `--force`; `--verify` never mutates.
- `--verify` mismatch exits non-zero (tamper) with a field-level diff.
- No client literals; repo/version read at runtime; standard map is data, overridable.

## Testing (TDD, real-artifact)

1. Bundle assembled from the REAL `harness-manifest.json` has correct `control_inventory` totals
   (127 = 44+83) and per-axis/status counts; `controls[]` carry resolved `standard_ref`.
2. Integrity: hash is stable across re-serialization; **tamper detection** — mutating any field then
   `--verify` exits non-zero; an untampered file `--verify` exits 0.
3. Verify shapes: both `branch-protection-verify.json` (flat) and `deploy-gate-verify.json` (nested)
   are ingested; absent ⇒ `null`; a failing verify ⇒ `compliant:false`.
4. `compliant` logic: gate fail ⇒ false; verify fail ⇒ false; all present+passing ⇒ true; all absent
   ⇒ true but every source recorded `null` (auditable, not vacuous).
5. Immutability: second run on the same SHA is a no-op; `--force` overwrites; `index.json` dedupes by
   commit_sha.
6. Ratchets read from real baseline files; missing baseline ⇒ `null`.
7. Standard-map resolution: `by_id` overrides `by_axis`; unknown axis ⇒ a recorded `unmapped` ref.
8. Scaffold round-trip: a scaffolded target contains `generate-attestation.js`, the `attestation`
   skill, and `standard-map.json`.
9. `validate-harness-manifest.js` passes with the new sensor; control-budget 128; `npm test` green.

## Rollout / compatibility

- Purely additive: a new script + skill + template + one manifest entry. No existing gate behavior
  changes; `quality-card.js`/`gate-receipt` untouched.
- Control-budget +1 is a one-time expected bump, committed with the change.
- `.claude/attestations/` starts empty; records accrue as `generate-attestation.js` runs per commit.
- Whole-branch review on the strongest model before merge.
