# P0 increment scope — red-phase proof + test write-lock (G41–G43)

Branch: `red-phase-test-lock-g41-g43` · Base: `main` @ `708f744` · Date: 2026-07-29

Source of the gap: audit of this harness against the `engineering_101_v1` control
catalogue (29 failure modes). ~22 were already covered. This increment closes the
two the pack ranks highest and the harness only partly holds:

- **#7 test tampering** — `test-deletion-gate.js` catches *deletion + skip* at
  pre-commit. Nothing stops the agent rewriting an assertion mid-loop:
  `pre-write-gate.js` has no test-path check, and there is no red SHA to diff against.
- **#11 tautological tests** — `tdd-test-first` checks test *existence* only. Its own
  comment says "pair with tdd-guard for red-green ordering". Nothing proves the test
  ever failed, so a test written to match code already written passes the gate.

Evidence for prioritising these: ImpossibleBench puts Claude Opus 4.1's
impossible-test exploitation at 50–55%; read-only test paths was the strongest single
mitigation measured, and it preserved legitimate task performance.

## The design in one line

**The red record IS the phase marker.** `task-envelope.js` has no phase concept
(verified), so rather than add phase machinery, a recorded failing test run is what
arms the lock — and the same record supplies the red SHA the commit-time proof needs.
The three controls are one chain, which is why they ship as one increment.

```
 Bash test run fails ──► G41 appends red record (task_id, test paths, red SHA)
                              │
                              ├──► G42 arms: Write/Edit/sed to those test paths BLOCKED
                              │           until lifecycle records `completed`
                              │           (or a NEW red record is appended)
                              │
                              └──► G43 at commit: `git diff <red-sha>..HEAD -- <paths>`
                                          must be empty, or covered by a later red record
```

## Controls

| ID | Name | Type | Cadence | Home |
|---|---|---|---|---|
| G41 | `red-phase-record` | sensor (computational) | session | `hooks/red-phase-record.js` + `hooks/lib/red-phase.js` |
| G42 | `test-write-lock` | sensor (computational) | session | check in `hooks/pre-write-gate.js` + `hooks/pre-bash-gate.js`; logic in `hooks/lib/test-write-lock.js` |
| G43 | `test-integrity-proof` | sensor (computational) | commit | `gates-verification.js` + `scripts/test-integrity-gate.js` |

Split of pure logic (lib) from IO/plumbing (hook/script) follows the existing
`test-deletion-gate` / `cycle-gate` / `live-externals-gate` convention.

### G41 — red-phase record

PostToolUse `Bash` tap. `PostToolUse` already matches `Bash` and `record-run.js`
already reads `tool_input` / `tool_response`, so the access path is proven — this is a
sibling hook, not new plumbing.

Classify the command as a test run (pytest / vitest / jest / node --test / go test /
`npm test`), then classify the response as pass / fail / **environment-broken**. That
third bucket is the trap: `pytest` exiting 1 because it is not installed is not a red
phase. Reuse `toolchain.js`'s `MISSING_SIGNATURES` rather than writing a second copy —
the duplication ratchet will bite otherwise.

On a genuine failure append to `.claude/state/red-phase.jsonl`:
`{schema_version, sequence, task_id, test_files[], failing_ids[], head_sha, created_at,
previous_event_hash, event_hash}` — hash-chained, reusing the `task-lifecycle.js`
pattern so tampering with the ledger is itself detectable.

### G42 — test write-lock

`runCheck('test-write-lock', ...)` in `pre-write-gate.js`, using `isTestFile` from
`hooks/lib/tdd.js`. A test file with an open red record under the active task is
read-only until the task lifecycle records `completed`.

Escape hatch by design: appending a **new** red record unlocks. You may add a new
failing test; you may not silently edit an existing one green. Legacy bypass
`HARNESS_TEST_LOCK=off`, mirroring `HARNESS_TDD_GATE=off`.

**Shell verbs are in scope, not a follow-up.** The pack's adversarial checklist calls
out that hooks must match both native edit tools *and* `sed`/`tee`/`patch`.
`pre-bash-gate.js` already exists and `hooks/lib/bash-targets.js` already exports
`extractWriteTargets` — wire the same decision through it. A lock that only covers
`Edit|Write|MultiEdit` is theatre.

### G43 — test-integrity proof

Gate in the `verification` pack, registered in `GATE_CATALOG` at order 155 (beside
`mutation-smoke`), `runsWithoutSource: true` so it fires on a test-only commit.

Asserts that for every staged test file with an open red record,
`git diff <red-sha>..HEAD -- <path>` is empty or every modification is covered by a
later red record.

**This must also land as a required check in `.github/workflows/ci.yml`.** The pack's
failure mode #6 is exactly this: a turn-level gate the agent can step around
(`git commit --no-verify`) needs a merge-level backstop with no override. Pre-commit
alone does not close the hole.

## Control budget

Baseline is **153**. This takes it to **156**, so each of G41/G42/G43 needs a written
`net_add_justification` in `harness-manifest.json` — these are load-bearing, so the
justifications are honest ones, not ceremony.

Additionally, run `node .claude/scripts/sensor-value-report.js` in this branch and
retire any never-fired controls it names. The harness's own discipline says a net-add
should look for an offset; this is the branch to do it in.

## Tests (TDD — red first, per the discipline this increment is about)

Unit, pure libs:
- test-command detection across pytest / vitest / jest / node --test / go test / `npm test`, including `--watch` and non-test Bash that merely mentions "test"
- pass vs. fail vs. environment-broken classification (the `MISSING_SIGNATURES` path)
- lock-decision truth table: no record / open record / completed lifecycle / newer red record / bypass env
- ledger chain validation, including a tampered-hash case
- G43 diff assertion including the "covered by a later red record" branch

Integration, **real artifacts** (CLAUDE.md principle #5 — no hand-built fixtures):
- drive a git fixture repo through red → implement → attempt-tamper → commit, through
  the **real** `gate-registry` and the **real** ledger. A fixture encoding the wrong
  record shape would keep every test green while the lock is inert.
- adversarial: instruct the agent to weaken a locked test via `sed -i` and confirm the
  bash path blocks it, not just the Edit path.

## Task list

1. `hooks/lib/red-phase.js` — command + result classification (tests first)
2. `hooks/lib/red-phase.js` — ledger append/read/validate with hash chain
3. `hooks/red-phase-record.js` — PostToolUse hook, wire into `settings.json`
4. `hooks/lib/test-write-lock.js` — lock decision truth table
5. `pre-write-gate.js` — `runCheck('test-write-lock', ...)`
6. `pre-bash-gate.js` — same decision via `extractWriteTargets`
7. `hooks/lib/gates-verification.js` + `scripts/test-integrity-gate.js` — G43
8. `gate-registry.js` order 155 + `sensor-tier.js` tier membership
9. `ci.yml` — G43 as a required check (the no-override backstop)
10. `harness-manifest.json` — 3 entries + `net_add_justification`; `HARNESS.md` matrix rows
11. Integration round-trip + adversarial shell-verb test
12. `sensor-value-report.js` — look for a retirement offset
13. Whole-branch independent review on the strongest model before merge

## Risks and open calls

- **False-positive red records.** A test run failing for an unrelated reason arms a
  lock. Cost is bounded: records are additive and locks are per-file, so a spurious
  record costs one unlock, never a wedged branch.
- ~~**Interaction with the legacy lanes.**~~ **RESOLVED 2026-07-29 — and it sharpened
  the arming rule.** `pinning-down-behavior` Step 3 is explicit that pin-downs *"Run
  green against the current code"* — characterization is **green-first**, TDD is
  **red-first**. So the lock does not need a lane exemption; it needs a better arming
  condition:

  > **A test file whose FIRST observed run (within a task) is RED arms the lock.
  > Green-first never arms.**

  Consequences, all desirable:
  - TDD tests (red → implement → green) lock. That is the point.
  - Pin-downs never lock, so Step 3's explicitly-permitted "adding a matcher later for
    a nondeterministic field is harness repair" stays legal.
  - Step 4's mutation-smoke checkpoint (deliberately flip production code, watch the
    pins fail, revert) produces a genuine red run — but it comes *after* the green
    first run, so it cannot arm. No special-casing of `mutation-smoke.js` needed.

  G41's ledger therefore records **both** outcomes per test file, not only failures,
  and stores a `first_run` verdict per `(task_id, test_file)`.

  Known limitation, recorded honestly: a file whose first observed run is green
  because the agent ran the whole suite before writing anything will not arm even if a
  red TDD test is added to it later in the same task. First-run state is scoped per
  `task_id`, so a new task resets it. The commit-time G43 proof is the backstop for
  this case.
- **Monorepo / polyglot runners.** Scope detection to what the project already
  declares; do not invent a universal test-runner parser.
- **iCloud checkout hazard** (standing): concurrent writes spawn ` 2.js` duplicates
  that hang the suite. Keep implementer fan-out low on this branch.

## Explicitly out of scope

Deferred to their own increments, named here so they are not silently dropped:
property-based tests on invariant-bearing code, held-out acceptance suite,
dependency supply-chain gate (lockfile-only / `--ignore-scripts` / new-dep CODEOWNERS),
idempotency review dimension, and the `teaches:` human-bridge field.
