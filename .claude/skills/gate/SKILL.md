---
name: gate
description: Run the adaptive pre-merge quality gate: deterministic checks, evaluator, diff review, and security review only when the diff crosses a security/data/API boundary. (Renamed from /review to avoid colliding with Claude Code's native /review PR-review command.)
argument-hint: "[story-id]"
context: fork
---

# Gate Skill

On-demand, pre-merge entry point to the harness's **one** quality gate. It keeps deterministic verification mandatory, then runs the smallest model-review set that protects the change: evaluator + fresh diff review by default, with security review added only when the touched files cross a security, data, network, auth, payment, upload, or public API boundary. This skill owns only the on-demand orchestration; the gate's verification definitions live in `/evaluate`.

> **Ultracode tip:** Multi-dimension review with adversarial verification is a natural fan-out, so `/effort ultracode` pays off on this plain skill form.

## Usage

```
/gate            # reviews the current group in context
/gate E3-S1      # reviews a specific story and its group
```

> **Not** Claude Code's native `/review` (which reviews a GitHub PR). This is the harness's
> local pre-merge quality gate. See the command-boundary notes in `README.md`.

## Execution

### Step 1 — Build the Review Context Pack

Before spawning agents, write or refresh `specs/reviews/review-context-pack.md` with:

- request / story / issue ID
- acceptance criteria
- final diff or commit range
- changed files
- relevant DeepWiki/code-map links
- deterministic test/lint/typecheck output
- risk triggers that decide whether security review is required

Every reviewer reads this pack plus the diff and directly touched files. Do not pass the full build transcript, raw test logs, or unrelated repo files into reviewer prompts.

### Step 2 — Spawn the Minimal Review Set Concurrently

Use the Agent tool to spawn the selected agents **in a single call**:

- **evaluator** — always. Runs sprint contract checks (API, Playwright, architecture); writes `specs/reviews/evaluator-report.md` and updates `features.json`.
- **code-reviewer** — always for `/gate`. Fresh-context review of the diff for both structure and correctness; writes `specs/reviews/code-review-verdict.json`.
- **security-reviewer** — only when the changed files touch auth/authz, secrets, user input handling, uploads/downloads, network fetch/redirect/proxy code, payments/billing, persistence/schema/migrations, API routes/controllers/middleware, or configured security patterns. Writes `specs/reviews/security-review.md` and `specs/reviews/security-verdict.json`.

- **Bounded re-verification when the security trigger fires (Devin-parity hardening, 2026-07-09).** When the security trigger above fires, spawn **2 additional independent instances** each of `evaluator` and `security-reviewer` (3 total per axis, including the always-on evaluator spawn and the triggered security-reviewer spawn above) — fresh context per instance via the `Agent` tool, no shared conversation between instances. Each instance runs its full existing process unmodified. Resolve each axis independently by majority vote (2-of-3): security PASS/BLOCK and functional PASS/FAIL can legitimately disagree. If an instance errors or times out instead of returning a verdict, fail safe to the stricter outcome (BLOCK/FAIL) for that axis. The existing `specs/reviews/security-verdict.json` and the evaluator's own verdict output are written exactly as before, sourced from the first-spawned instance of each — every existing consumer is unaffected. Additionally write `specs/reviews/reverify-votes.json`:
  ```json
  {
    "gate": "gate-reverify",
    "trigger": "security-boundary",
    "security": { "votes": ["pass", "pass", "fail"], "majority": "pass", "fail_safe_triggered": false },
    "functional": { "votes": ["pass", "pass", "pass"], "majority": "pass", "fail_safe_triggered": false },
    "timestamp": "<ISO 8601>"
  }
  ```
  This file is an audit trail only — no existing gate logic reads it. Scoped to `/gate` only; `/auto`'s per-group Gate 7 keeps its existing single-pass security review unchanged.

- **Approved-fixtures (G12):** when the changed files include any snapshot file (path contains `__snapshots__/` or ends with `.snap`/`.ambr`/`.approved.*`), run `node .claude/scripts/approved-fixtures-gate.js`. It checksums every snapshot against the approved baseline (`specs/test_artefacts/approved-snapshots.json`); a `blocked` verdict (a modified approved snapshot or a new unapproved one, exit 1) is a **BLOCK** (writes `specs/reviews/approved-fixtures-verdict.json`). After reviewing the change, re-bless with `npm run approve-fixtures -- --all` (or `-- --snapshots <files>`). `no-snapshots` / `pass` (removed-only WARN) are non-blocking. When the diff touches no snapshot files, skip.

- **Contract-drift (G12):** when the changed files include the project's OpenAPI spec (the same changed-files boundary used for security-scan), run `node .claude/scripts/contract-drift-gate.js`. It runs `oasdiff breaking` between the spec at the git base and the working tree; a `breaking` verdict (exit 1) is a **BLOCK** (writes `specs/reviews/contract-drift-verdict.json`). `no-spec` / `new-spec` / `unprovisioned` (oasdiff not installed) are non-blocking notes. When the diff does not touch an OpenAPI spec, skip it.

- **Architecture ratchets (G8, G18):** always, when a code-graph exists (`specs/brownfield/code-graph.json`, kept fresh by `/code-map` or the graph-refresh hook). Run `node .claude/scripts/cycle-gate.js` and `node .claude/scripts/coupling-gate.js`. Both compare the current code-graph to a monotonic baseline under `.claude/state/` — a new import cycle or a new unstable hub (fan_in >= 5, instability >= 0.8) is a **BLOCK**; the coupling gate additionally names the specific new hub(s) with fan-in/instability numbers and remediation (extract a narrower interface or split responsibilities). Removing a cycle or an unstable hub ratchets its baseline down. No code-graph → both skip loudly (exit 0), never silently. `cycle-gate.js` (G8) was previously wired only into `/auto` Gate 4, not `/gate` — its presence here is an intentional G8 coverage expansion bundled with G18 (the two ratchets share one invocation site and code-graph read; splitting them would mean reading the graph twice for no benefit), not an accidental scope creep. It is low-risk: the gate degrades loudly to a no-op on any project without a code-graph yet.

- **Canvas sync:** when changed source files exist and `specs/design/reasons-canvas.md` exists, run `npm run canvas-sync`. A non-zero result means changed files are missing from the REASONS Canvas `Governs` or `Operations` sections; that is a **BLOCK** unless a valid `specs/reviews/sensor-waivers.json` explicitly covers the mismatch. Fix by updating the Canvas first, then rerun.

- **Ownership:** when changed source files exist and `specs/design/component-map.md` exists, run `node .claude/scripts/ownership-check.js --files <changed files>` (or `--staged` pre-commit-side). It writes `specs/reviews/ownership-check.json`; a non-zero exit means changed source files are owned by no story in the component map (or the map parsed to zero entries — `empty_map`); that is a **BLOCK** unless a valid `specs/reviews/sensor-waivers.json` entry (`sensor_id: "ownership-check"`) explicitly covers the file. Fix by assigning the file to its owning story in component-map.md first, then rerun.

- **Regression-suite-full (G15):** always, when the project has an `e2e/` directory or a `sprint-contracts/` directory. Run `node .claude/scripts/regression-gate.js --exclude-group <current group, if any>`. It re-runs every accumulated Playwright spec under `e2e/` (not just the current story's spec) and re-executes every prior story-group's sprint-contract `api_checks` as live HTTP requests against the running app, first re-validating each contract against `contract-schema.json` via the same machinery `validate-contract.js` uses. It writes `specs/reviews/regression-gate-verdict.json`; a `blocked` verdict (a previously-passing e2e spec or prior contract API check now fails, exit 1) is a **BLOCK** with file:line detail per finding. Tests already quarantined in `specs/drift/flake-history.jsonl` are excluded so a known flake cannot false-block. `no-baseline` (neither `e2e/` nor `sprint-contracts/` exists yet — nothing to regress against) is a loud, non-blocking note, never a silent skip.

- **Deep mutation (optional):** for release gates or critical modules configured in `project-manifest.json#quality.mutation.critical_globs`, run `npm run deep-mutation -- --critical-only`. This invokes Stryker or mutmut only when already provisioned; `unprovisioned` is a non-blocking note, while an explicitly requested failing deep mutation run is a **BLOCK**.

If any finding is being suppressed or threshold-bumped via `specs/reviews/sensor-waivers.json`, first run `npm run sensor-waivers`. It validates required waiver fields and expiry rules against `.claude/templates/sensor-waivers.schema.json`; an `invalid` verdict is a **BLOCK** until the waiver is fixed or removed. Missing waiver file is `no-waivers` and passes.

When a security trigger fires, also run the **computational security scan** (gap G3) as the deterministic complement to the inferential `security-reviewer` — the two are partners, not substitutes: `node .claude/scripts/security-scan.js --all --staged --boundary-only`. It runs gitleaks (secrets), semgrep (SAST), and `npm audit`/`pip-audit` (dependency CVEs) where those tools are provisioned, skipping each one loudly otherwise (never silently). It writes `specs/reviews/security-scan.json`; a non-zero exit (findings at or above the `--threshold`, default `high`) is a **BLOCK** under the same semantics as the reviewers. Always-available baseline secrets are already enforced at commit by the pre-commit hook; this step adds the external-tool tiers.

If no security trigger fired, run neither `security-reviewer` nor the computational scan; record `security_review: skipped_no_boundary` in the context pack instead.

### Step 3 — Apply the Canonical Gate Semantics

Severity levels (BLOCK/WARN/INFO), the BLOCK self-healing loop (generator fix → full re-run, max 3 cycles, then escalate), and the security verdict format are defined once in `/evaluate` (`.claude/skills/evaluate/SKILL.md`) — follow them exactly from there. Do not merge or mark a group complete while any BLOCK finding remains open, and always re-run the full review after fixes.

## Output Files

- `specs/reviews/evaluator-report.md` — PASS/FAIL with per-check detail
- `specs/reviews/code-review.md` and `specs/reviews/code-review-verdict.json` — fresh-context structure + correctness review
- `specs/reviews/security-review.md` and `specs/reviews/security-verdict.json` — only when a security trigger fired
- `specs/reviews/security-scan.json` — computational security scan (secrets/SAST/deps) result; only when a security trigger fired
- `specs/reviews/reverify-votes.json` — 3-instance majority-vote audit trail; only when a security trigger fired
- `specs/reviews/canvas-sync-check.md` — living-design sync result when a REASONS Canvas exists
- `specs/reviews/ownership-check.json` — file-ownership sensor result when a component-map.md exists
- `specs/reviews/regression-gate-verdict.json` — accumulated e2e + prior sprint-contract regression result when `e2e/` or `sprint-contracts/` exists
- `specs/reviews/sensor-waivers-verdict.json` — waiver validation result when waivers are present or checked
- `specs/reviews/review-context-pack.md` — compact shared review input

Every selected output must exist before the review is complete; a missing selected output is itself a BLOCK finding.

## Canonical ownership (vs `/evaluate`)

There are two entry points to the same gate, not two gates:

- **`/evaluate` Layer 4 / `/auto` Gate 7** — the authoritative in-pipeline owner.
- **`/gate`** — the on-demand pre-merge entry point (this skill).

In `/auto`, Gate 7 already covers it — a separate `/gate` is only needed for manual gating before a merge.
