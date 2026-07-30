# Deterministic external-boundary testing — G34 (test-double kit) + G36 (live-externals sensor) + replay-mode regression

**Date:** 2026-07-16
**Status:** Design, approved for implementation planning
**Scope:** v1 — Python/FastAPI backend, all three external boundaries (DB, HTTP, LLM)

## Problem

The harness has converted an enormous amount of domain knowledge about *structure* into enforced infrastructure — 33 closed gaps of computational sensors (coupling ratchets, cycle gates, mutation-smoke, legacy-discipline proofs, test-deletion guards). But it has **not** done this for one class of issue: isolating external systems (database, HTTP services, LLM calls) in tests. That class is still solved one-off, by hand, every time — the exact "fix it every time the agent sees it" anti-pattern Boris Cherny names, versus "encode it as a routine/sensor once, automated forever."

Two audits of the current harness (2026-07-16) established:

1. **The "integration test" layer is a named slot with no generator behind it.** `/test` generates plan/cases/fixtures → acceptance tests → Playwright E2E. It ships an `integration-traces.json` sidecar and names "unit, integration, E2E" as levels, but no step generates integration tests. The *declared* integration philosophy (`test-strategy.md:24`) is "real database in a Docker container, not SQLite substitutes" — the opposite of deterministic isolation. `respx`, `httpx_mock`, `responses`, `vcr`/`cassette`, `wiremock`, `nock`, `testcontainers` appear nowhere in `.claude/`.

2. **The "test-double adapter" is prompt guidance, not infrastructure.** `writing-acceptance-tests-first/` contains only `SKILL.md`. No adapter code ships; the AT template (`specs/test_artefacts/at-template.*`) is explicitly delegated to the human. The model hand-writes a fake per story from prose.

3. **The regression backstop runs against live externals with exact-match assertions.** G15/G16 gates re-fire prior `api_checks` as real HTTP against a live `localhost:8000` and re-run real Playwright, with no app boot, no DB seed, no stubbing. Assertions are exact deep-equality (`bodyMatches`), so any LLM string / timestamp / third-party variance false-blocks a correct app. The only flakiness defense is a name-based, append-only quarantine with no expiry — which silently masks genuine regressions and undermines the G31 test-deletion guard.

The seed of the fix already exists: the API-wrapper template has a working record+replay mechanism (`replay: bool`, `tests/fixtures/{service}/{op}.json`, `record_fixtures.py`) — but it is reference text: opt-in, HTTP-only, LLM/DB-unaware, wired into no generation step, enforced by no sensor.

## Goal

Convert the harness's live-integration test and regression story into a **deterministic** one, by shipping the external-boundary test-double layer as real, registered, enforced infrastructure — and running the regression gates against it.

## Non-goals (v1)

- TS/React doubles (MSW is already partially present) — later gap.
- Go / other backend stacks — later.
- Full auto-synthesis of the entire `tests/integration/` suite. v1 wires the doubles and generates the LLM/HTTP boundary tests; it does not try to synthesize every integration case.
- Quarantine-hygiene / expiry (the earlier-proposed G37) — separate, later.
- Field-masking assertions — determinism comes from replay, not tolerance.

## Binding mechanism (the spine)

One env flag, honored at the wrapper boundary, plus a shipped `conftest.py`.

`HARNESS_TEST_REPLAY=1`:
- every external-API wrapper's existing `replay: bool` reads it and serves fixtures instead of hitting the network;
- the shipped `conftest.py` binds the DB transactional-isolation fixture and the fake LLM client;
- the regression gate boots the app-under-test with the flag set;
- the G36 runtime jail keys on the same flag as defense-in-depth.

Rationale: reuses the `replay` flag already in the wrapper template; no DI framework introduced; the three deliverables (kit, sensor, replay-regression) share **one** mechanism instead of three. A wrapper that ignores the flag is a G36 lint finding.

## Deliverable 1 — G34: boundary test-double kit (guide `boundary-test-doubles`)

Fixtures live under `tests/fixtures/`, committed as golden data.

### HTTP double
Promote the existing `replay`/`record_fixtures.py` pattern from reference text into a shipped, reusable `ReplayTransport` + fixture loader that any wrapper delegates to at its `_call` seam (SDK-agnostic — works for the Anthropic SDK too). Record step captures real responses once → `tests/fixtures/<service>/<operation>.json`; replay serves them under the flag. `respx` stays available for wrapper-less raw-httpx cases but is secondary to the wrapper seam.

### LLM double
A `FakeAnthropicClient` (drop-in for the wrapper's SDK client) returning **golden structured responses** keyed by operation + a stable hash of the request. Because code-gen already mandates `tool_use`/JSON-schema output, the golden is a validated JSON object (not free text), so it round-trips through the app's real response model. Fixtures in `tests/fixtures/llm/`. Record mode calls the real model once and captures; replay serves the golden. This is what makes an LLM-flow regression test deterministic.

### DB double
Not a fake engine — a **transactional-isolation fixture**: each test runs in a transaction rolled back at teardown, against a deterministic seed. Keeps a real engine (honors the `test-strategy.md` doctrine) but is fast and deterministic. In-memory SQLite remains an explicitly-approved fast path, not the default. Reconciles the `test-strategy.md` ("real DB") vs `tests-python.md` ("in-memory SQLite") contradiction.

### AT template
Ship `specs/test_artefacts/at-template.py`: a concrete Ports-and-Adapters example whose fake adapter *is* one of these doubles, so `writing-acceptance-tests-first` stops delegating the first AT to the human from scratch.

### Generation wiring
`/test` gains a real integration-generation step that binds the doubles and generates LLM/HTTP boundary tests into `tests/integration/`, filling `integration-traces.json` for real.

## Deliverable 2 — G36: live-externals sensor (hybrid, hard-block)

### Commit / lint half — `live-externals-gate.js`
Scans `tests/integration/` + `e2e/` for:
- non-localhost `http(s)://` literals;
- real DB DSNs (`postgres://`, `mysql://`, …) not pointing at the fixture;
- direct `anthropic` / `openai` client construction with no fake;
- a wrapper that ignores `HARNESS_TEST_REPLAY`.

BLOCK with an LLM-legible fix line naming the kit double to use. Wired into `gate-registry.js` + pre-commit; `sensor_tier` standard+; waivable via `sensor-waivers.json`.

### Merge / runtime half
The regression gate runs the suite with `HARNESS_TEST_REPLAY=1` **and** outbound network blocked / DB pointed at the double. Any real reach → hard FAIL. Deterministic by construction.

## Deliverable 3 — replay-mode regression (G15/G16)

`regression-gate.js` + `local-regression-gate.js` gain a replay mode: the app-under-test is booted with the flag, so its DB/HTTP/LLM are doubles. The gate still does real localhost HTTP to the app (deterministic once downstreams are doubled); the recorded goldens make the existing exact-match `bodyMatches` assertions valid again instead of flaky. No field-masking.

## Registration (harness conventions)

- `harness-manifest.json`: new guide `boundary-test-doubles` (gap_ref G34) + sensor `live-externals` (gap_ref G36); update `regression-suite-full` / `impact-scoped-regression` descriptions for replay mode.
- `HARNESS.md`: add the guide + sensor to the Behaviour matrix; add a G34/G36 gap entry.
- `scaffold-copy.js`: add new scripts / skill / templates to `CORE_SCRIPTS` / `CORE_SKILLS` (the G22 completeness test enforces this).
- `docs/sensor-arbitration.md`: declare blocking levels (lint = hard-block standard+; runtime = hard-block at merge; both waivable).

## File inventory (approximate)

New:
- `.claude/skills/boundary-test-doubles/SKILL.md` (+ `references/`)
- `.claude/templates/` — `conftest.py` fragment, `ReplayTransport`, `FakeAnthropicClient`, DB transactional fixture, `at-template.py`
- `.claude/scripts/live-externals-gate.js` + `.claude/hooks/lib/` counterpart
- `test/live-externals-gate.test.js`, `test/boundary-doubles-roundtrip.test.js` (real record→replay round-trip)

Edited:
- `.claude/scripts/regression-gate.js`, `.claude/scripts/local-regression-gate.js` (replay mode)
- `.claude/skills/test/SKILL.md` (integration-generation step)
- `.claude/hooks/lib/gate-registry.js`, `.claude/git-hooks/pre-commit` (wire the lint gate)
- `.claude/skills/code-gen/references/api-integration-patterns.md`, `test-strategy.md`, `tests-python.md` (point at the shipped kit; resolve the SQLite contradiction)
- `.claude/skills/writing-acceptance-tests-first/SKILL.md` (reference the shipped AT template)
- `harness-manifest.json`, `HARNESS.md`, `scaffold-copy.js`, `docs/sensor-arbitration.md`

## Test plan

- `live-externals-gate.js`: unit tests for each detection class (non-localhost HTTP, real DSN, un-faked SDK client, flag-ignoring wrapper) + clean-pass + waiver path.
- Boundary doubles: a real record→replay round-trip proving a recorded golden replays deterministically for HTTP and LLM; DB transactional fixture proving rollback isolation between tests.
- Regression replay mode: prove a regression run with the flag set produces stable results across two runs where the app's LLM/HTTP would otherwise vary.
- `npm test` (harness self-suite) green, including the G22 scaffold-copy-completeness test for the new scripts/skill.

## Risks / open points

- **Golden staleness/drift:** a recorded fixture can diverge from the real external's current schema. v1 relies on the record step being re-run deliberately; a fixture-vs-live drift sensor is a candidate fast-follow (not v1).
- **Runtime jail portability:** blocking outbound network at the process level is stack/OS-specific. v1 targets the Python test-runner path on the harness's supported dev/CI environment; document the mechanism and degrade loudly where unavailable rather than silently passing.
- **Wrapper-less code paths:** code that hits an external without going through a wrapper is caught by the G36 lint (un-faked SDK client), but the replay flag can't help it until it's refactored behind a wrapper. The lint's fix line points at that refactor.

## Increment ordering (for the implementation plan)

1. G34 kit templates (HTTP `ReplayTransport`, `FakeAnthropicClient` + golden format, DB transactional fixture, `conftest.py`, `at-template.py`) + record/replay round-trip tests.
2. G36 lint gate (`live-externals-gate.js`) + wiring + tests.
3. Replay-mode wiring into `regression-gate.js` / `local-regression-gate.js` + the runtime jail.
4. `/test` integration-generation step.
5. Registration: `harness-manifest.json`, `HARNESS.md`, `scaffold-copy.js`, `sensor-arbitration.md`, reference-doc edits.
