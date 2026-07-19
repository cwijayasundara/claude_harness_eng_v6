# Fleet-Retrofit Runner — Design

Date: 2026-07-19
Status: Approved for implementation (follow-on to the 4-increment security-compliance program)
Lane: `/change` (compliance/orchestration code — whole-branch review before merge)
Predecessors: Inc 1 (f4f81ca), Inc 2 (26e76a2, `provision-protection.js`), Inc 3 (76563f0,
`provision-environments.js`), Inc 4a/4b (0176b62, 446fb1e), operator apply-runbook (ca2285f).

## Context

The provisioners `provision-protection.js` and `provision-environments.js` each take a `--fleet`
flag, but they loop internally and **abort on the first repo that errors** (return 2), and each
covers only its own gate. There is no single driver that brings an existing fleet of repos into
compliance across *both* gates and returns one aggregate picture of which repos are gated, which
drifted, which are provisioned-but-not-gating, and which failed. The operator apply-runbook
(§7) named this as a separate deliverable. This is that driver.

### Hard constraint

**No client-specific identifiers in code.** Org/repo identity is read from `fleet.json` at
runtime; branch-protection / environment specs come from `project-manifest.json#github` (the
single operator config). Nothing is hardcoded.

### Decisions (locked with stakeholder, 2026-07-19)

- **Scope: API-gates only (MVP).** Orchestrate `provision-protection` + `provision-environments`
  across every repo in `fleet.json` via `gh api` — pure API calls, **no per-repo git checkout**.
  CODEOWNERS and attestation stay per-repo (they need a working tree) and are out of scope.
- **Failure policy: isolate + continue, report all.** Invoke each provisioner **per-repo**
  (`--repo owner/repo`) so one repo's failure cannot abort the rest; record every repo's outcome
  with a reason; exit non-zero if **any** repo is not gated. A retrofit driver's value is the
  complete fleet picture, so a mid-fleet failure must never truncate the run.

### Grounding (from the provisioner sources)

- Both provisioners export `run(argv, opts)` returning a numeric exit code (they only
  `process.exit` at module-main), read config from `opts.cwd` `project-manifest.json`, and take an
  injected `opts.runner` (the `gh` runner) — so they compose as modules with a **shared injected
  runner**, fully stubbable in tests.
- `provision-protection.run(['--verify','--repo', r], {cwd, runner})`: honors `--repo`
  (`runVerify` uses `flags.repo ? {repo} : {org}`); exit **0 compliant / 1 drift / 2 read-or-gh
  error**. `--apply --repo r`: repo-scoped upsert; exit **0 applied / 2 failed**. (NB:
  `provision-protection`'s *plan* mode is org-only and ignores `--repo`; the per-repo read-only
  path is `--verify`, which is what the runner uses for its audit sweep.)
- `provision-environments.run(['--apply','--repo', r], …)`: exit **0 applied+gating / 3 applied
  but empty reviewers (NOT gating) / 2 failed**. `--verify --repo r`: exit **0 compliant / 1
  drift / 2 error**. Environments are repo-scoped (no org form).
- Both write a single-repo verify file (`specs/reviews/branch-protection-verify.json` /
  `deploy-gate-verify.json`) that is **overwritten each iteration** — the runner's aggregate
  report is the source of truth; the per-repo file ends up holding the last repo's result (an
  accepted, documented artifact).
- `fleet.json` = `{ org, repos:[{owner, repo}] }`; owner/repo are single path segments
  `[A-Za-z0-9._-]`, no `..` (reuse the provisioner `validSegment` idiom before any `gh` path).
- `harness-manifest.json`: `branch-protection-verify` + `deploy-gate-verify` are registered
  sensors (scope `portfolio`) keyed on the provisioners' `--verify`; `portfolio-compliance-rollup`
  aggregates *attestations*. Control-budget baseline = **129**; a new control needs a non-empty
  `net_add_justification`. Ships to targets via `scaffold-copy.js` `CORE_SCRIPTS`/`CORE_SKILLS`.

## Goals

1. `fleet-retrofit.js` — one command that, across every repo in `fleet.json`, audits (read-only,
   default) or applies-then-re-audits (`--apply`) both live gates, isolating per-repo failures and
   writing one integrity-free aggregate report + a summary; exit reflects whole-fleet gated-ness.
2. Register one control (`fleet-gate-retrofit`) + a thin `fleet-retrofit` skill; budget 129→130.

## Non-goals (later / separate)

- Per-repo git checkout, CODEOWNERS/attestation generation, or commit/push per repo (the "full"
  option the stakeholder declined).
- Parallelism across repos (sequential is fine at fleet sizes here; keeps output and gh-rate
  behavior simple and deterministic for tests).
- Signing / cryptographic integrity of the fleet report (it's an operational action-log; the
  attestation/rollup carry the durable evidence).
- Fetching/committing attestations (that's `portfolio-rollup.js --fetch`).

## Components

### C1. `fleet-retrofit.js`

CLI: `node .claude/scripts/fleet-retrofit.js --fleet <file> [--apply] [--out <path>] [--json]`

- **Default (audit)**: read-only. Per repo, run `provision-protection --verify --repo` +
  `provision-environments --verify --repo`; classify; aggregate. Changes nothing.
- **`--apply`**: per repo, run `provision-protection --apply --repo` then
  `provision-environments --apply --repo`, then re-run both `--verify --repo` to confirm; classify
  from the apply+verify codes; aggregate.
- Reads `fleet.json`; validates each `owner`/`repo` segment before use (bad fleet / missing file
  ⇒ exit 2 with reason). Empty `repos[]` ⇒ report with `total:0`, `fleet_gated:false`, exit 1
  (an empty fleet is not a green — same fail-safe stance as the rollup).
- Invokes the provisioners **as modules** with a single injected `gh` runner (`defaultGh` in prod;
  a stub in tests). Per-repo provisioner stdout/stderr flows through as a live progress log; the
  runner prints its own summary last.

**Per-gate classification** (`classifyGate`, a pure function of the apply/verify exit codes):

| Situation | state |
|---|---|
| `--apply` and apply code = 2 (protection) / 2 (env) | `failed` |
| env `--apply` code = 3 (applied, empty reviewers) | `not-gating` |
| verify code = 2 | `error` |
| verify code = 1 | `drifted` |
| verify code = 0 | `gated` |

(apply codes only consulted in `--apply` mode; in audit mode a gate is classified from its verify
code alone.)

**Per-repo status** (`rollupRepo`, pure): `gated` iff both gates are `gated`; else the repo takes
its worst gate — `failed` (any `failed`/`error`) > `not-gating` (any `not-gating`) > `drifted`.

**Report** (written to `--out`, default `specs/reviews/fleet-retrofit.json`):

```jsonc
{ "schema_version": 1, "generated_at": "<iso>", "mode": "audit" | "apply",
  "repos": [ { "repo": "owner/name", "branch_protection": "<state>",
              "deploy_gate": "<state>", "status": "gated|drifted|not-gating|failed" } ],
  "summary": { "total": N, "gated": N, "drifted": N, "not_gating": N, "failed": N },
  "fleet_gated": <bool> }   // true iff total>0 AND every repo status === "gated"
```

**Exit codes**: `0` iff `fleet_gated` (every repo gated); `1` if any repo not gated (report still
fully written); `2` usage / unreadable fleet / gh unavailable. (Applies to both modes: an audit of
an ungated fleet exits 1 with the worklist; an apply that leaves any repo ungated exits 1.)

Pure helpers (`classifyGate`, `rollupRepo`, `summarize`, `buildReport`) live in a sibling
`fleet-retrofit-core.js` so the classification/aggregation logic is unit-testable without `gh` or
the filesystem — same split as `portfolio-rollup` / `portfolio-rollup-core`.

### C2. Registration + skill

- Register `fleet-gate-retrofit` in `harness-manifest.json#sensors`: axis `traceability`, type
  `computational`, cadence `drift`, scope `portfolio`, status `active`, `wired_at`
  `.claude/scripts/fleet-retrofit.js`, with a `net_add_justification` distinguishing it from
  `branch-protection-verify`/`deploy-gate-verify` (single-scope, single-gate) and
  `portfolio-compliance-rollup` (aggregates *attestation evidence*): this is the portfolio-scoped
  **live-platform** aggregate — "is every repo's live branch-protection AND deploy-approval gate
  actually in place" — which none of them answers, plus the one-command apply driver. Control-budget
  **129 → 130**. Update `HARNESS.md`; re-run `validate-harness-manifest.js`.
- `.claude/skills/fleet-retrofit/SKILL.md`: audit (default, read-only) vs `--apply`; that it
  isolates per-repo failures and reports all; the org-admin requirement for `--apply`; the exit-code
  contract; and that it orchestrates the Inc 2/3 provisioners (config from
  `project-manifest.json#github`, identity from `fleet.json`). Follow `docs/prompting-standards.md`.
- Add `fleet-retrofit.js` + `fleet-retrofit-core.js` to `scaffold-copy.js` `CORE_SCRIPTS` and
  `fleet-retrofit` to `CORE_SKILLS`.
- Cross-link from `docs/operator-apply-runbook.md` §7 (replace "a separate deliverable" with the
  real command) and its recommended-order section.

### C3. Reuse

- `provision-protection.run` / `provision-environments.run` as modules (shared injected `gh`
  runner) — no duplication of the `gh`/diff logic.
- `validSegment` fleet-entry validation + the `fleet.json` reader idiom.
- The `core.js` pure-helper split from `portfolio-rollup`.

## Data flow

```
fleet.json {org, repos[]} ─► fleet-retrofit.js
   per repo (isolated):
     [--apply] provision-protection --apply --repo ─┐
     [--apply] provision-environments --apply --repo┤ (codes captured, never fatal)
     provision-protection --verify --repo ──────────┤
     provision-environments --verify --repo ────────┘
   classifyGate × rollupRepo × summarize
       └─► specs/reviews/fleet-retrofit.json  +  summary line  +  exit(fleet_gated?0:1)
```

## Error handling / policy

- Per-repo isolation: a repo's apply/verify error becomes a `failed`/`error` row, never aborts the
  fleet. Exit non-zero if any repo is not gated.
- Fail-safe: empty fleet ⇒ `fleet_gated:false`, exit 1. `not-gating` (env applied with empty
  reviewers) is never counted `gated`.
- gh absent/auth: surfaces per-repo as `error` rows (the provisioners return 2); if the *fleet
  file itself* is unreadable, exit 2 before any repo.
- Audit mode never mutates; `--apply` requires org/repo-admin (documented, same as the
  provisioners).
- No client literals; identity from `fleet.json`/config at runtime; owner/repo segment-validated
  before any `gh` path.

## Testing (TDD, real-artifact)

1. `classifyGate`: every apply/verify code combination ⇒ correct state (table above), for both
   modes.
2. `rollupRepo`/`summarize`: mixed fleet ⇒ correct per-repo status + summary counts +
   `fleet_gated`.
3. Audit mode via a stubbed `gh` runner: a fleet where repo A is fully gated, repo B has a drifted
   ruleset, repo C 404s (gh error), repo D's environment has empty reviewers ⇒ one report with
   `gated`/`drifted`/`failed`/`not-gating` rows, `fleet_gated:false`, **exit 1**, and **repo C's
   error does not stop repos after it** (isolation proven by asserting D still appears).
4. `--apply` mode: apply codes 0/2/3 threaded into classification; a repo whose apply returns 2 is
   `failed` without attempting to mask it as gated; env apply 3 ⇒ `not-gating`.
5. All-gated fleet ⇒ `fleet_gated:true`, **exit 0**.
6. Unreadable/missing `--fleet` ⇒ exit 2; a traversal `owner`/`repo` in the fleet ⇒ rejected
   (exit 2) before any `gh` call.
7. Report written to the default path and to `--out`; `--json` emits the report object.
8. The stub asserts the runner passed the **real** provisioner argv (`--apply`/`--verify` +
   `--repo owner/name`) — round-trips the real `run()` entrypoints, not a hand-built double.
9. `validate-harness-manifest.js` passes; control-budget 130; `npm test` green.

## Rollout / compatibility

- Additive: new script + core + skill + one manifest entry + a runbook cross-link. No existing
  provisioner behavior changes (they're consumed, not modified).
- Control-budget +1 is a one-time expected bump, committed with the change.
- Whole-branch review on the strongest model before merge.
```
