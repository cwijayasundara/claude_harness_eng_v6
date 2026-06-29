# G12 slice 3 — approved-fixtures gate

**Date:** 2026-06-28
**Gap:** G12 (slice 3 of 4). Snapshot/golden files are *oracles*, but nothing stops an agent from silently regenerating a `.snap` to make a failing test pass — destroying the regression signal. This slice treats approved snapshots as **locked**: a baseline registry + a deterministic gate that blocks unreviewed snapshot changes/additions, with an approve CLI to bless them.
**Done before this:** slice 1 (oasdiff contract-drift), slice 2 (default-on a11y). **Remaining after:** flake detection (deferred to a P2 follow-on per `TESTING_AGENT_PROPOSAL.md`).

## Scope (decided)

- **Approval gate** (not report-only): blocks until explicit re-approval.
- **Block new AND changed** snapshots until approved (strictest oracle discipline); a removed approved snapshot is a WARN.
- **Deterministic, byte-checksum** (sha256) — no semantic/structural diffing.
- **Conditional/dormant when no snapshots exist** (the harness's own repo, and snapshot-free projects, pass trivially).
- Wiring mirrors the established gate pattern (oasdiff/security-scan): `/gate` boundary-gated + `npm run`.

## §1 — Snapshot detection + baseline registry

- **Snapshot file = path matching a default pattern set:** contains `/__snapshots__/`, or ends with `.snap` (jest/vitest), `.ambr` (syrupy), or `.approved.txt` / `.approved.json` (ApprovalTests). Overridable via `project-manifest.json#approved_fixtures.patterns` (array of suffix/substring rules). Always exclude `node_modules/` and `.git/`.
- **Baseline:** `specs/test_artefacts/approved-snapshots.json` — an array of `{ path, checksum, approved_by, date }` where `checksum` is `sha256:<hex>` of the file bytes and `path` is repo-root-relative, forward-slashed.

## §2 — `.claude/scripts/approved-fixtures-gate.js`

Flags: `--root <dir>` (default cwd), `--baseline <path>` (default `specs/test_artefacts/approved-snapshots.json`), `--out <path>` (default `specs/reviews/approved-fixtures-verdict.json`).

Flow:
1. Resolve snapshot patterns (manifest override else defaults). Glob the repo (excluding `node_modules`/`.git`) for snapshot files → `found[]` (relative, sorted).
2. Read the baseline (absent → empty array).
3. Classify, via a **pure** `classify(found, baseline, checksumOf)`:
   - file in `found` whose baseline entry exists and checksum matches → `ok`.
   - in `found` + baseline entry exists + checksum differs → `modified`.
   - in `found` + no baseline entry → `unapproved`.
   - in baseline + not in `found` → `removed`.
4. Verdict: `modified` or `unapproved` present → `verdict: "blocked"` (exit 1); else `verdict: "pass"` (exit 0). `removed`-only is a WARN inside a pass.
   - **No snapshot files found at all → `verdict: "no-snapshots"`, exit 0** (dormant).
5. Write `{ verdict, modified[], unapproved[], removed[], ok_count }` to `--out`. Print a one-line summary; on block, print the bootstrap hint: `run: npm run approve-fixtures -- --all` (and name a few offending files).
6. **Exit:** 0 = pass / no-snapshots; 1 = blocked (modified or unapproved).

## §3 — `.claude/scripts/approve-fixtures.js` (the unblock)

Flags: `--root`, `--baseline`, `--approver <actor>` (default `human`), and either `--all` or `--snapshots <file…>`.
- `--all`: glob the same snapshot set; recompute every file's checksum; rewrite the baseline to exactly that set (drops entries whose files no longer exist).
- `--snapshots a b c`: upsert just those paths' checksums into the baseline (preserving other entries).
- Each upserted/added entry gets `{ path, checksum, approved_by: <approver>, date }`. `date` defaults to the system date (`new Date().toISOString().slice(0,10)` — a normal node CLI script, so `Date` is available; the Workflow-sandbox `Date` restriction does not apply here), with `--date` as an override for deterministic tests. `date`/`approved_by` are metadata the gate ignores for its checksum decision.
- Idempotent; writes the baseline pretty-printed; exit 0.
- Exposes `checksumOf(path)` and the baseline read/write helpers, shared with the gate (one small `lib`-style module or co-located exports) to keep checksum logic DRY.

## §4 — Wiring

- `/gate` (`.claude/skills/gate/SKILL.md`): add a boundary-gated step — when the changed files include any snapshot file (the same changed-files boundary used for security-scan/contract-drift), run `node .claude/scripts/approved-fixtures-gate.js`; a `blocked` verdict (exit 1) **fails the gate** (writes the verdict json). `no-snapshots`/`pass`(removed-WARN) are non-blocking. When the diff touches no snapshot files, skip.
- `package.json`: `"approved-fixtures": "node .claude/scripts/approved-fixtures-gate.js"` and `"approve-fixtures": "node .claude/scripts/approve-fixtures.js"`.

## §5 — Registry + docs

- `harness-manifest.json`: new sensor `{ id: "approved-fixtures-gate", axis: "behaviour", type: "computational", cadence: "commit", status: "active", scope: "repo", wired_at: ".claude/scripts/approved-fixtures-gate.js", gap_ref: "G12", signal: "snapshot oracle modified/added without re-approval", description: "Approved-fixtures gate (G12): tracks a baseline of approved snapshot files (path+sha256 in specs/test_artefacts/approved-snapshots.json) and BLOCKs in /gate when an approved snapshot's checksum changed or a new unapproved snapshot appears; approve-fixtures.js re-blesses. Dormant when a project has no snapshot files. Stops agents silently regenerating oracles to pass tests." }`. (`scope: "repo"` is the validator-accepted value for a repo-wide file check; "test-artefacts" is NOT a valid scope.)
- `HARNESS.md`: Behaviour *Sensors* cell add `✅ **approved-fixtures** (snapshot-oracle lock, /gate, G12)`. Holes line: G12 partial, **3 of 4 slices done** (oasdiff + a11y + approved-fixtures); flake detection remains.
- `docs/internal/HARNESS_ENGINEERING_GAP_ANALYSIS.md`: G12 row — add ✅ approved-fixtures; §5 roadmap updated; note flake is the only remaining slice.

## §6 — Tests (`node:test`, hermetic)

- `test/approved-fixtures-gate.test.js`:
  - `classify` pure-function unit: ok / modified / unapproved / removed cases from in-memory inputs.
  - CLI in a temp dir: a `.snap` file + a baseline matching its checksum → `pass`, exit 0.
  - modify the `.snap` → `blocked`, exit 1, `modified` lists it.
  - add a second `.snap` not in baseline → `blocked`, exit 1, `unapproved` lists it.
  - delete a baselined file → `removed` WARN, exit 0.
  - **no snapshot files in the temp dir → `no-snapshots`, exit 0** (the dormant case).
  - missing baseline + a `.snap` present → `blocked` (unapproved).
- `test/approve-fixtures.test.js` (or combined): temp dir with an unapproved `.snap` → gate blocks → run `approve-fixtures --all` → baseline now lists it → gate passes (round-trip). `--snapshots <one>` upserts only that one.
- Wiring assertions: `/gate` SKILL references `approved-fixtures-gate.js`; `package.json` has both scripts; `harness-manifest.json` `approved-fixtures-gate` is `active`, `scope:"repo"`, `wired_at` resolves.
- **Harness-repo dormancy:** a test (or the implementer's verification) confirms running the gate at the harness repo root yields `no-snapshots` exit 0 — the harness must not block its own commits. (If any stray matching file exists, scope the default glob to exclude it or treat test fixtures appropriately — but the harness uses node:test assertions, not snapshot files, so the set should be empty.)
- `node .claude/scripts/validate-harness-manifest.js` passes; `npm test` green.

## Risks & mitigations

- **The gate blocking the harness's OWN commits.** Mitigation: the gate is dormant (`no-snapshots`, exit 0) when no snapshot files match; verified by a test running it at the repo root. `/gate` runs it only boundary-gated on snapshot-file changes anyway.
- **`Date`/timestamp unavailability in scripts.** Mitigation: `approve-fixtures.js` accepts `--date`; `date`/`approved_by` are metadata the gate ignores for its checksum decision, so a missing date never affects pass/fail.
- **Pattern over/under-matching.** Mitigation: conservative default patterns (the well-known snapshot conventions) + a `project-manifest.json#approved_fixtures.patterns` override; `node_modules`/`.git` always excluded.
- **First-run friction (everything unapproved).** Mitigation: the block message tells the user to run `npm run approve-fixtures -- --all` once to bless the current set; this is the intended approval bootstrap.

## Out of scope

Flake detection (the remaining G12 slice); multi-level / PR / Slack approval workflows; an auto-`--update` escape valve (would destroy the oracle); semantic/structural snapshot diffing (byte-checksum only); a new `/approve-fixtures` *skill* (the CLI is a one-shot helper for the human already in `/gate`); tying the gate to the evaluator/runtime (it is commit-cadence); deduplicating or pruning snapshots.
