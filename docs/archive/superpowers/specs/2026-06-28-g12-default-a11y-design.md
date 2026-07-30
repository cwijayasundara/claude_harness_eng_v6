# G12 slice 2 — default-on axe/WCAG accessibility

**Date:** 2026-06-28
**Gap:** G12 (slice 2 of 4). The axe-core accessibility gate is fully built — the evaluator runs axe whenever the sprint contract carries an `accessibility_checks` block (Full mode FAIL on serious/critical impacts, Lean WARN; `failure_layer: "accessibility"`). But the block is never auto-added, so the sensor is `partial` (opt-in). This slice makes it **default-on for UI stories** deterministically.
**Already done:** slice 1 (oasdiff contract-drift gate). **Remaining after this:** approved-fixtures, flake detection.

## Scope (decided)

- **Deterministic contract normalizer** (`contract-accessibility-default.js`) injects a default `accessibility_checks` block into a finalized sprint contract when the contract has UI checks. Deterministic + testable — not an LLM prompt rule (the LLM forgetting is exactly why a11y coverage is unreliable today).
- **UI signal = a non-empty `playwright_checks`** in the contract (the existing UI marker). API-only contracts have none, so the normalizer never fires for them — no topology gating needed.
- **Opt-out = `project-manifest.json#accessibility.enabled: false`** (mirrors `observability.enabled`); default on, **absent = on**. A contract that already defines `accessibility_checks` is always respected (never overwritten).
- **No change to the evaluator / axe logic** — it already runs axe and gates Full-FAIL/Lean-WARN when the block is present.

## §1 — `.claude/scripts/contract-accessibility-default.js`

- Pure `normalizeContract(contract, opts)` where `opts.enabled` is the resolved manifest flag:
  - if `opts.enabled === false` → return `contract` unchanged.
  - if `contract.accessibility_checks` already exists → unchanged (respect explicit choice).
  - if `Array.isArray(contract.playwright_checks) && contract.playwright_checks.length > 0` → return a copy with `accessibility_checks: { required: true, block_impacts: ['serious', 'critical'] }` added.
  - else (no UI checks) → unchanged.
  - **Idempotent:** running twice yields the same result (the already-exists guard ensures it).
- CLI: `node .claude/scripts/contract-accessibility-default.js <contract-path> [--root DIR]`:
  - read `project-manifest.json#accessibility.enabled` from `--root` (default cwd); absent → `true`.
  - read the contract JSON, `normalizeContract`, write it back in place (pretty-printed) only if changed; print a one-line summary (`added accessibility_checks` / `unchanged (<reason>)`).
  - Exit 0 always (it's a normalizer, not a gate). A missing/invalid contract file → exit 0 with a message (don't crash the loop).
- Exports `normalizeContract` (before any `require.main` guard) for unit testing.

## §2 — Wiring into `/auto`

In `.claude/skills/auto/SKILL.md` SECTION 3 (Sprint Contract Negotiation), after the contract is finalized (generator proposes → evaluator approves → `validate-contract.js`) and before the group is evaluated, add a step:

> **Default-on accessibility (G12):** run `node .claude/scripts/contract-accessibility-default.js sprint-contracts/{group}.json`. When the contract has `playwright_checks` (a UI story) and the project hasn't set `accessibility.enabled:false`, this injects a default `accessibility_checks` block so the evaluator's axe gate runs. Deterministic — UI stories get accessibility coverage without relying on the generator to remember it.

(The evaluator then runs axe per its existing rule; no evaluator edit.)

## §3 — Opt-out config

- The normalizer reads `project-manifest.json#accessibility.enabled` (absent = `true`).
- **No `scaffold-render.js` change** — absence-defaults-on means the manifest needn't emit the block; the `playwright_checks` signal scopes it to UI work automatically.
- `.claude/commands/scaffold.md` manifest-schema section: add a one-line note — `"accessibility": { "enabled": bool }` (default on; set `false` to disable the default-on axe gate for UI stories).

## §4 — Registry + docs

- `harness-manifest.json`: flip `accessibility` `status: "partial" → "active"`; keep `scope: "runtime"`; change `wired_at` to `.claude/scripts/contract-accessibility-default.js` (the new mechanism that activates it by default; the axe gate itself lives in `evaluate`); update `description` to "axe-core gate, default-on for UI stories via contract-accessibility-default.js (opt out with project-manifest accessibility.enabled:false); Full FAIL / Lean WARN on serious/critical impacts."
- `HARNESS.md`: Behaviour *Sensors* cell `🟡 axe/WCAG *(opt-in only, G12)*` → `✅ **axe/WCAG accessibility** (default-on for UI stories, Full FAIL / Lean WARN, G12)`. Holes line stays **G12 partial** — now 2 of 4 slices done (oasdiff + a11y); approved-fixtures + flake remain.
- `docs/internal/HARNESS_ENGINEERING_GAP_ANALYSIS.md`: G12 row — add ✅ default-on a11y to the done list; §5 roadmap updated.

## §5 — Tests (`node:test`)

- `test/contract-accessibility-default.test.js`:
  - UI contract (`playwright_checks: [..1..]`), `enabled` default → `accessibility_checks` injected with `required:true`, `block_impacts:['serious','critical']`.
  - `enabled:false` → unchanged (no block added).
  - contract already has `accessibility_checks` → unchanged (explicit respected, even with a different `block_impacts`).
  - no `playwright_checks` (API-only) → unchanged.
  - idempotent: `normalizeContract(normalizeContract(c))` deep-equals one pass.
  - CLI hermetic: temp dir + `project-manifest.json` + a contract file; run the script; assert the file gained the block (and exit 0); a `accessibility.enabled:false` manifest → file unchanged.
- Wiring assertions: `/auto` SECTION 3 references `contract-accessibility-default.js`; `harness-manifest.json` `accessibility` is `active`, `scope:"runtime"`, `wired_at` resolves; `scaffold.md` documents `accessibility.enabled`.
- Existing `test/accessibility-contract.test.js` (schema) stays green; `node .claude/scripts/validate-harness-manifest.js` passes; `npm test` green.

## Risks & mitigations

- **Over-firing on non-visual Playwright checks** (a contract with `playwright_checks` that aren't really a rendered UI). Mitigation: `playwright_checks` IS the harness's UI marker (browser-level flows); a false positive only adds an axe run that defaults to WARN-or-FAIL on serious/critical — and `accessibility.enabled:false` is the explicit escape. Acceptable.
- **Mutating a finalized contract after evaluator approval.** Mitigation: the normalizer only ever *adds* a default a11y block (never removes/edits other checks) and is idempotent; it runs after `validate-contract.js`, and the added block conforms to the existing schema (covered by `accessibility-contract.test.js`).
- **Parallel mode writes per-group contracts.** Mitigation: the normalizer takes an explicit `<contract-path>`, so it operates per-group exactly where `/auto` already writes `sprint-contracts/{group}.json`.

## Out of scope

The other two G12 slices (approved-fixtures, flake detection); any change to the axe execution, `block_impacts` defaults, or Full/Lean semantics (already built); per-page URL inference (the existing `urls`-defaults-to-`ui_base_url` behavior is unchanged); topology-presetting `accessibility.enabled` (could come with a future G10 follow-on; absence-defaults-on already covers it).
