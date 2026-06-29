# G12 slice 1 — oasdiff API contract-drift gate

**Date:** 2026-06-28
**Gap:** G12 (first slice). G12 is a bundle of four independent behaviour-harness extras: **oasdiff contract-drift gate** (this slice), default-on axe/WCAG, approved-fixtures, flake detection. This spec covers only the oasdiff gate; the other three are separate slices (flake detection is deferred to a P2 follow-on per `TESTING_AGENT_PROPOSAL.md`).
**Why:** `keeping-refactors-pure` already *documents* that "if an OpenAPI spec exists, `oasdiff` between the before/after specs must report zero breaking changes," but the gate was never wired. `harness-manifest.json` carries `api-contract-drift` as `planned` (gap_ref G12). This slice wires it.

## Scope (decided)

- **Git-base comparison:** the "before" spec is the OpenAPI spec as committed at the merge-base with `main` (fallback `main`, then `HEAD`); "after" is the working-tree spec. True "did THIS change break the contract" semantics; no snapshot file to maintain.
- **Wiring:** a `contract-drift-gate.js` script + `npm run contract-drift`, wired into `/gate` **boundary-gated** — runs only when the change touches the OpenAPI spec (mirrors how `security-scan` is boundary-gated in `/gate`). Not pre-commit, not an `/auto` gate.
- **Degrade loudly:** if `oasdiff` is not on PATH, or the project has no OpenAPI spec, emit a clear message and **exit 0** (non-blocking) — exactly how `security-scan` handles a missing semgrep/gitleaks.
- **Conditional by design:** the harness's `specs/design/api-contracts.schema.json` is its own JSON-Schema format, not OpenAPI; this gate only acts when a real OpenAPI 3.x spec exists.

## §1 — OpenAPI spec detection

`resolveSpecPath(root, manifest)`:
- If `project-manifest.json#api.openapi_spec` is set and the file exists → use it.
- Else the first existing of these candidates (relative to `root`): `openapi.yaml`, `openapi.yml`, `openapi.json`, `specs/design/openapi.yaml`, `specs/design/openapi.yml`, `specs/design/openapi.json`.
- None found → `null` (caller exits 0 with "no OpenAPI spec — skipping").

## §2 — `.claude/scripts/contract-drift-gate.js`

Flags: `--root <dir>` (default cwd), `--base <ref>` (default: first of `origin/main`, `main`, `HEAD` that resolves), `--spec <path>` (override detection), `--oasdiff <bin>` (default `oasdiff`; lets tests inject a fake).

Flow:
1. Resolve spec path (§1). `null` → exit 0, `verdict: "no-spec"`.
2. Resolve the base ref. Extract the base spec: `git show <base>:<relPath>` → a temp file. If that fails (spec didn't exist at base — newly added) → exit 0, `verdict: "new-spec"` (nothing to diff).
3. Run `oasdiff breaking <baseTmp> <currentSpec> --fail-on ERR` (the `breaking` subcommand exits non-zero when breaking changes exist). Capture stdout/stderr.
   - spawn `ENOENT` (oasdiff not installed) → exit 0, `verdict: "unprovisioned"`, with a "oasdiff not on PATH — contract-drift skipped; install oasdiff to enforce" message.
4. Verdict from exit code (a **pure function** `verdictFromExit(code)` for testability): `0` → `pass`; non-zero → `breaking`.
5. Write `specs/reviews/contract-drift-verdict.json` = `{ verdict, spec, base, breaking_output }`. Print a one-line summary.
6. **Exit code:** `0` for `pass` / `no-spec` / `new-spec` / `unprovisioned`; `1` for `breaking` (BLOCK).

## §3 — `/gate` integration

In `.claude/skills/gate/SKILL.md`, add contract-drift to the deterministic checks, **boundary-gated**: run `node .claude/scripts/contract-drift-gate.js` only when the change's file set includes the resolved OpenAPI spec (the same changed-files boundary logic `/gate` already uses to decide when to run security-scan). A `breaking` verdict (exit 1) **fails the gate** as a blocking finding; `no-spec`/`new-spec`/`unprovisioned` are non-blocking notes.

## §4 — Surface

- `package.json`: `"contract-drift": "node .claude/scripts/contract-drift-gate.js"`.
- `.claude/skills/keeping-refactors-pure/SKILL.md`: update the oasdiff line from a documented expectation to the wired gate — "run `npm run contract-drift` (or it fires in `/gate` when the OpenAPI spec changes); it must report zero breaking changes."

## §5 — Registry + docs

- `harness-manifest.json`: flip `api-contract-drift` `planned → active`, `wired_at: ".claude/scripts/contract-drift-gate.js"`, and **add `scope: "runtime"`** (G11 requires a scope on active sensors; contract-drift governs the API contract — non-file-mapping). Update its description to the wired behavior. Keep `gap_ref: "G12"`.
- `validate-harness-manifest.js`: no change needed (the active+scope requirement already enforces it once flipped).
- `HARNESS.md`: Architecture *Sensors* cell `⛔ API contract-drift oasdiff gate (G12)` → `✅ **API contract-drift** (oasdiff, /gate when the OpenAPI spec changes, G12)`. Holes line: G12 *partially* done — note the oasdiff slice shipped; a11y/approved-fixtures/flake remain.
- `docs/internal/HARNESS_ENGINEERING_GAP_ANALYSIS.md`: G12 row — mark the oasdiff sub-feature ✅ DONE, the other three still open; §5 roadmap updated.

## §6 — Tests (`node:test`, hermetic — CI has no oasdiff)

- `test/contract-drift-gate.test.js`:
  - `verdictFromExit(0) === 'pass'`; `verdictFromExit(1) === 'breaking'` (pure-function unit test).
  - **No-spec skip:** run the gate in a temp dir with no OpenAPI spec → exit 0, verdict `no-spec`.
  - **Unprovisioned degrade:** run in a temp dir WITH a spec but `--oasdiff /nonexistent-bin` (or a PATH with no oasdiff) → exit 0, verdict `unprovisioned`, message mentions oasdiff.
  - **Breaking path via injected fake:** `--oasdiff <fake-script>` where the fake exits 1 → exit 1, verdict `breaking` (and a fake exiting 0 → exit 0, `pass`). The fake is a tiny shell/node stub written into the temp dir, so the real oasdiff is never required.
  - Wiring assertions: `gate/SKILL.md` documents contract-drift + boundary-gating; `keeping-refactors-pure/SKILL.md` references `npm run contract-drift`; `package.json` has the script; `harness-manifest.json` `api-contract-drift` is `active`, `scope: "runtime"`, `wired_at` resolves.
- `node .claude/scripts/validate-harness-manifest.js` passes; `npm test` green.

## Risks & mitigations

- **oasdiff output format varies by version.** Mitigation: rely only on the **exit code** of `oasdiff breaking` (0 = no breaking, non-zero = breaking), not on parsing its text; capture the text verbatim into the verdict for the human, but don't gate on parsing it.
- **`git show <base>:<path>` path must be repo-relative, forward-slashed.** Mitigation: compute the spec path relative to the git root and normalize separators before `git show`.
- **Test depending on a real oasdiff would be non-hermetic / flaky in CI.** Mitigation: the `--oasdiff` injection point lets tests supply a fake binary; the real tool is never required by the suite.
- **Detached / fresh repo with no `main`.** Mitigation: base-ref resolution falls back `origin/main → main → HEAD`; if none resolve or the spec is absent at base, the gate treats it as `new-spec` and exits 0.

## Out of scope

The other three G12 slices (default-on axe/WCAG, approved-fixtures, flake detection — each its own spec); pre-commit/`/auto` wiring (this is a `/gate` change-lane concern); parsing oasdiff's detailed diff (exit-code gating only); generating an OpenAPI spec for projects that lack one (the gate is conditional, not a spec generator).
