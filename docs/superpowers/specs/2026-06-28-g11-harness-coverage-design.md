# G11 — Harness-coverage metric

**Date:** 2026-06-28
**Gap:** G11. The articles' open question — *"how do we know our sensors are adequate?"* The harness has the G1 registry (HARNESS.md + harness-manifest.json) but no report of **which code is / isn't under which sensor**. G11 makes the registry *measurable*.

## Scope (decided)

- **Per-file, per-axis coverage report**, **report-only** (no gate). A deterministic `harness-coverage.js` maps each source file against the manifest's active sensors by axis and reports per-axis coverage % + an *ungoverned* holes list. Mirrors `coupling-report` / `drift-report` (`.md` + `.json`). Runnable via `npm run harness-coverage` and `/schedule`.
- **Registry footprint = a validated `scope` field** added to every active/partial sensor. This is what makes coverage computable and keeps the registry self-honest (a new sensor without a scope fails validation). No fake guide/sensor entry for the report itself — a coverage report *measures* governance, it does not govern code.
- **Per-file granularity** (not per-symbol); reuse existing readers (manifest loader, `coverage-diff` coverage reader, `code-graph.json`).
- Runs against a **product project** (which has a `code-graph.json`); the harness's own repo has none, so the report degrades gracefully there.

## §1 — `scope` field + controlled vocabulary (the registry change)

Add `scope` to each active/partial sensor in `harness-manifest.json`. Controlled set (validated):

| scope | meaning | example sensors |
|---|---|---|
| `universal` | every source file (always, or whenever changed) | eslint-ruff, type-check, length-caps, secret-scan, sast, clean-code-review, diff-review, security-review |
| `test-covered` | files exercised by tests | coverage-ratchet, coverage-diff, mutation-smoke, unit-tests |
| `layer-roots` | files under `architecture.layer_roots` | layer-imports |
| `contexts` | files under `architecture.contexts` | bounded-context-rules |
| `runtime` | the running app / endpoints (not static files) | eval-api, eval-playwright, eval-design-critic, perf-ratchet, runtime-slo, api-schema-validation, accessibility |
| `dependencies` | dependency manifests | dep-audit, drift-deps |
| `artifacts` | planning documents, not source | grounding-check, trace-check, constraints-extract, plan-confidence, seam-confidence, canvas-structure |
| `repo` | whole-graph / repo-wide, not a per-file set | cycle-detection, coupling-report, modularity-pack, modularity-review, drift-architecture, drift-design-code |

- `validate-harness-manifest.js`: add `SCOPES` to the controlled vocabularies and require `scope ∈ SCOPES` on every **active/partial sensor** (planned sensors and all guides are exempt — guides are feedforward and universal by nature).
- The per-sensor assignment is finalized against the live manifest during implementation; the table above is the classification rule. Judgment calls (e.g. `unit-tests` → `test-covered`, inferential diff reviews → `universal`) are documented inline in each entry's existing `description` if non-obvious.

## §2 — `harness-coverage.js` (the reader)

**Inputs:**
- `harness-manifest.json` — loaded via `validate-harness-manifest.js`'s exported loader; iterate active sensors + their `scope`/`axis`.
- `code-graph.json` (default `specs/brownfield/code-graph.json`, overridable `--graph`) — the source-file inventory (`nodes[].path` where `kind === 'file'`).
- coverage data — reuse `coverage-diff.js`'s normalized reader (`{ file: {covered,total} }`) to resolve `test-covered`.
- `project-manifest.json#architecture` — `layer_roots` and `contexts.roots` to resolve `layer-roots` / `contexts` file sets.

**Computation:**
- **File-mapping scopes** = `universal`, `test-covered`, `layer-roots`, `contexts`. For each source file, for each axis, collect the active sensors whose file-mapping scope includes it.
- **Per-axis coverage %** = (source files with ≥1 file-mapping sensor on that axis) / (total source files).
- **Holes** = per axis, the list of source files with no file-mapping sensor on that axis (capped/sorted for readability; the count is always reported even if the list is truncated — no silent truncation).
- **Non-file-mapping scopes** (`runtime`, `dependencies`, `artifacts`, `repo`) are reported as separate summary lines ("app-level / dependency-level / planning-level / repo-wide governance"), NOT folded into the per-file %, because they don't map to a static file set.

## §3 — Outputs

- `specs/harness-coverage/harness-coverage.md` — header stats (files, per-axis %), a per-axis table (axis · coverage % · sensors · holes count), the ungoverned holes lists, and the non-file-mapping governance summary.
- `specs/harness-coverage/harness-coverage.json` — the structured payload (per-axis %, per-file sensor map, holes, non-file-mapping sensors).
- **Graceful degradation:** if `code-graph.json` is absent, exit 0 with a clear message ("no code-graph.json — run /code-map first"); do not error. (The harness's own repo has no graph.)
- **Exit code:** 0 always (report-only). A `--check` flag MAY exit non-zero if any axis is 0%-covered, for optional CI use — but default is report-only.

## §4 — Surface / cadence

- `package.json` script: `"harness-coverage": "node .claude/scripts/harness-coverage.js"`.
- Report-only; runnable on a cadence via `/schedule` / `/loop` alongside `npm run drift`.
- Documented in HARNESS.md as the G11 meta-control that answers "is anything ungoverned?".

## §5 — Registry + docs

- `harness-manifest.json`: the `scope` annotations on every active/partial sensor (§1) are G11's registry change. No new guide/sensor entry for the report.
- `validate-harness-manifest.js`: enforce `scope` (§1).
- `HARNESS.md`: add a short "Harness coverage (G11)" subsection pointing at `harness-coverage.js` + `npm run harness-coverage`; holes line → G11 done, leaving G12.
- `docs/internal/HARNESS_ENGINEERING_GAP_ANALYSIS.md`: G11 row → ✅ DONE; roadmap §5 updated.

## §6 — Tests (`node:test`)

- `test/harness-manifest.test.js` (extend) + `validate-harness-manifest.js`: every active/partial sensor in the real manifest has a valid `scope`; an active sensor missing `scope` fails validation; an invalid scope value fails.
- `test/harness-coverage.test.js`: feed a fixture manifest (a couple of sensors with `universal` / `test-covered` / `layer-roots` scopes) + a fixture `code-graph.json` (a few files) + fixture coverage → assert per-axis coverage %, the holes list (a file with no test coverage shows as a behaviour hole), and that `runtime`/`artifacts` sensors are reported separately (not in the per-file %). Assert graceful no-graph handling (exit 0 + message). Hermetic: feed fixtures via `--graph`/`--root`, no network.
- `package.json` has the `harness-coverage` script; `HARNESS.md`/gap-doc updated.
- `node .claude/scripts/validate-harness-manifest.js` passes on the updated manifest; `npm test` green.

## Risks & mitigations

- **Adding `scope` to ~38 sensors is broad mechanical churn.** Mitigation: it's additive (one field per entry); the validator change + the manifest update land in the same task so the suite never sees an inconsistent state; existing entries otherwise unchanged.
- **Scope classification is partly judgment** (e.g. `unit-tests` test-covered vs universal). Mitigation: the §1 table is the rule; borderline calls get a one-line note in the entry `description`; the report's value (per-axis holes) is robust to a couple of debatable classifications.
- **`code-graph.json` shape variance** (AST vs regex producer). Mitigation: read only `nodes[]` with `kind:'file'` + `path` (present in both producers per code-map SKILL); ignore symbol detail.
- **Silent truncation of holes lists.** Mitigation: always print the total hole count even when the printed list is capped (the harness's no-silent-caps rule).

## Out of scope

Per-symbol coverage; making it a blocking gate (default report-only; `--check` is opt-in); a `scope` field on guides (feedforward is universal by nature); changing any sensor's actual behavior; coverage of the harness's own repo (no code-graph — it's the control system, not the subject).
