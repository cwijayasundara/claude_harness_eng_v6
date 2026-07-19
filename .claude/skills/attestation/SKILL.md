---
name: attestation
description: Generate a per-commit, durable compliance attestation (with a sha256 corruption-detecting integrity checksum) from the harness control inventory, the branch-protection/deploy-gate verify outputs, the gate verdict, and the ratchet baselines — then commit the record. Use at /gate or in CI to produce committed evidence for a commit, or to --verify a stored attestation's integrity checksum. Remappable to the client's evidence format via standard-map.json.
argument-hint: "[--force] [--verify <file>] [--json]"
---

# Compliance Attestation

Produces the harness's durable compliance evidence: a per-commit, SHA-keyed,
sha256-integrity-hashed attestation bundle committed under `.claude/attestations/`.
The per-run verdicts the harness already produces (`gate-receipt.json`, `quality-card.json`,
the Increment 2/3 `*-verify.json` outputs) are ephemeral — `specs/reviews/` and all `*.jsonl`
are gitignored, and the verify outputs overwrite in place with no commit SHA or timestamp. This
skill aggregates them into one committed record per commit that an auditor can read and re-check.

## When to use

- At `/gate` or in CI, after the verify/gate outputs for a commit exist, to write the committed
  evidence record — then commit `.claude/attestations/<sha>.json` and `index.json`.
- To re-check a stored attestation's integrity with `--verify <file>` (tamper detection).
- When a project must map the neutral clause taxonomy onto a real external standard.

## Do not use

- To provision branch protection or deploy environments — that is `/provision-protection`
  (Increment 2) and `/provision-environments` (Increment 3). This skill only *reads* their outputs.
- To change gate behavior. It is purely additive read-and-record; it never mutates `gate-receipt`,
  `quality-card`, or the verify outputs.

## How it works

```
node .claude/scripts/generate-attestation.js            # write .claude/attestations/<sha>.json (+ index.json)
node .claude/scripts/generate-attestation.js --force    # overwrite an existing record for this SHA
node .claude/scripts/generate-attestation.js --verify .claude/attestations/<sha>.json
node .claude/scripts/generate-attestation.js --json     # print the bundle instead of a summary line
```

- **Inputs** — three sources (branch-protection verify, deploy-gate verify, gate receipt), each classified
  fail-safe: `absent` (file missing ⇒ recorded `null`), `invalid` (present but unparseable or missing a
  boolean verdict ⇒ recorded `{invalid:true}` — never a silent pass), or `pass`/`fail`. Plus the control
  inventory + per-control clause from `harness-manifest.json`, the `.claude/state/*-baseline.*` ratchets,
  repo/commit from `git`, and the harness version from `package.json`. No client-specific identifiers are embedded.
- **`status` / `compliant`** — `status` is `compliant` | `non-compliant` | `not-evaluated`. Any present source
  that is failing OR invalid ⇒ `non-compliant`. All sources absent ⇒ `not-evaluated`. Only when at least one
  source was evaluated and none is bad ⇒ `compliant`. `compliant` (boolean) is strictly `status === "compliant"`,
  so an all-absent run is **not** a green — `sources_evaluated`/`sources_total` record the coverage an auditor reads.
- **Integrity checksum**: the bundle is canonicalized (deep, stable key sorting) with its `integrity` field
  removed and hashed with sha256; `--verify` recomputes and compares, exiting non-zero on mismatch. This is a
  **corruption-detecting checksum, not authenticity** — anyone with write access can rewrite the content and
  its hash, so a `--verify` PASS means "not accidentally corrupted", not "genuine". Cryptographic authenticity /
  non-repudiation requires signing (GPG/cosign/Sigstore) — a documented seam, not built here.
- **Immutability**: a record for a SHA is written once; a re-run is a no-op unless `--force`. `index.json` is
  `{ entries, integrity }` — deduped by `commit_sha` and itself integrity-checksummed; a corrupt/tampered index
  fails loudly rather than silently discarding prior entries.

## Where the records live

`.claude/attestations/<sha>.json` (immutable, one per attested commit) and `.claude/attestations/index.json`
(`{ entries, integrity }`, deduped + integrity-checksummed) are committed under the tracked `.claude/` tree —
they are the durable evidence, so **commit them**. `specs/reviews/` stays ephemeral and is not the evidence store.

## Remapping to a real standard

Each control resolves a `standard_ref` from `.claude/templates/standard-map.json` — a neutral clause
taxonomy (`by_id` overrides `by_axis`; an uncovered axis is recorded `unmapped`). To emit the client's
real evidence format (e.g. a "Section 9" clause map), drop a project-level `standard-map.json` at the repo
root or `.claude/`; it overrides the template default and its `id` is stamped into the bundle's
`standard_ref` so the record says which map produced it. The map is data — no client literals live in code.

When authoring or editing this skill, follow `docs/prompting-standards.md`.
