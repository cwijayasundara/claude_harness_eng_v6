# G10 — Per-topology harness templates

**Date:** 2026-06-28
**Gap:** G10. `/scaffold` detects the stack but applies the *same* default manifest regardless of what kind of app it is; there is no named, legible bundle of harness controls per topology. Article basis: Ashby's Law / variety reduction — the control system's variety should match the system's.
**Status today:** the manifest knobs (`architecture`, `observability`, `verification`, `execution.ceremony`/`model_tier`, design scoring) already exist and already gate the guides/sensors, but they are set by scattered, implicit `isLiteShaped`/`projectType` branching in `buildManifest`. G10 makes that explicit, named, and extensible.

## Scope (decided)

- **Three honest topologies** the harness actually builds + verifies today: `web-app`, `api-service`, `cli-or-library`. Drop-in extensible (adding a topology = a registry entry), mirroring how stack references are added. **No** JVM/Go/event-processor presets (the harness's codegen + HTTP/UI-centric verification can't exercise them — shipping them would be a false claim).
- **Data-driven registry** (`.claude/scripts/topologies.js`) resolved and merged inside `buildManifest`. Replaces the inline `lite`/`projectType` branching. The manifest stays per-project overridable.
- **Presets existing manifest knobs only** — `architecture.enabled`/`layers`, `observability.enabled`, `verification.mode`, `execution.ceremony` + `model_tier`, and the design-scoring posture. No new control types or thresholds (those would be their own gap).
- **Behavior-preserving** for the three shapes: the presets reproduce today's defaults. Existing `scaffold-render` / `project-manifest-contract` / `layers-config` / `scaffold-command` tests are the regression guard.

## §1 — The three topologies

Each topology is a coherent preset of existing knobs:

| Topology | Resolved from | architecture | observability | verification.mode | ceremony / model_tier |
|---|---|---|---|---|---|
| `web-app` | not lite **and** `stack.frontend` present (projectType A/B) | `{ enabled: true, layers: <default>, layer_roots: ['src'] }` | `{ enabled: true, ... }` | `docker` | `full` / `balanced` |
| `api-service` | not lite **and** no `stack.frontend` (projectType C, backend-only) | `{ enabled: true, ... }` | `{ enabled: true, ... }` | `docker` | `full` / `balanced` |
| `cli-or-library` | `isLiteShaped(profile)` true (projectType D / CLI / library / no backend framework) | `{ enabled: false }` | `{ enabled: false, ... }` | `local` (mode `B`) | `trimmed` / `cost` |

Design scoring posture is unchanged and stays driven by `projectType` (calibration-profile.json: A/B get a profile, C/D do not) — the topology does not duplicate it.

## §2 — `.claude/scripts/topologies.js` (pure, no I/O)

- `resolveTopology(profile) -> 'web-app' | 'api-service' | 'cli-or-library'`. Logic:
  - `if (isLiteShaped(profile)) return 'cli-or-library'`
  - `else if (profile.stack && profile.stack.frontend) return 'web-app'`
  - `else return 'api-service'`
  (Takes `isLiteShaped` as a passed-in function or re-imports the same logic — see §3; the resolution must match the *current* lite/projectType outcomes so behavior is preserved.)
- `TOPOLOGIES` — a map `{ id -> { architecture, observability, verification, execution } }` carrying the preset fragments above. Each fragment contains only the fields that topology sets; `buildManifest` deep-merges them over the base manifest.
- `topologyPreset(id) -> fragment` — returns the preset for an id; throws (or returns null) for an unknown id so a typo fails loudly.
- Exports: `resolveTopology`, `topologyPreset`, `TOPOLOGIES`.

## §3 — `buildManifest` integration (`scaffold-render.js`)

`buildManifest(profile)` currently computes `lite` and branches inline (lite → cost/trimmed/local + `architecture:{enabled:false}`; observability per shape; etc.). Refactor to:

1. `const topology = resolveTopology(profile)` (reuse the existing `isLiteShaped`).
2. Build the base manifest as today (name/description/stack/lsp/evaluation).
3. Apply `topologyPreset(topology)` — merge `architecture`, `observability`, `verification`, and the `execution.ceremony`/`model_tier` fields from the preset.
4. Record `manifest.topology = topology` (a label for legibility + downstream use — not a new knob).
5. Keep every value **identical** to today's output for each of the three shapes (the existing tests pin this). The `observabilityBlock`/`verificationBlock` helpers can be reused by the presets to avoid duplicating their shapes.

`isLiteShaped` stays the single source of the lite decision; `resolveTopology` is layered on top of it, so the lite path and the `cli-or-library` topology are guaranteed consistent.

## §4 — Scaffold surfacing (`scaffold.md`)

In the scaffold output/summary step, print the detected topology and the bundle it applied, e.g.:

> Detected topology: **web-app** → layered architecture on · observability on · docker verification · full ceremony · balanced model tier.

So the operator sees which variety-reduction preset was chosen and can override any field in `project-manifest.json`.

## §5 — Registry + docs

- `harness-manifest.json`: new guide `{ id: "topology-templates", axis: "architecture", kind: "feedforward", wired_at: ".claude/scripts/topologies.js", status: "active", gap_ref: "G10", description: "Per-topology harness templates (gap G10): /scaffold resolves a detected topology (web-app / api-service / cli-or-library) and presets a coherent bundle of existing manifest knobs (architecture, observability, verification, ceremony, model_tier) instead of a uniform default. Ashby's-Law variety reduction; drop-in extensible via the TOPOLOGIES registry; manifest stays per-project overridable." }`.
- `HARNESS.md`: Architecture *Guides* cell gains `topology-templates` ✅; holes line: G10 done, leaving G11–G12.
- `docs/internal/HARNESS_ENGINEERING_GAP_ANALYSIS.md`: G10 row → ✅ DONE; roadmap §5 updated.

## §6 — Tests (`node:test`)

- `test/topologies.test.js`: `resolveTopology` returns `cli-or-library` for a lite/projectType-D profile, `web-app` for a profile with `stack.frontend`, `api-service` for backend-only/projectType-C; `topologyPreset('web-app').architecture.enabled === true` and `topologyPreset('cli-or-library').architecture.enabled === false`; `topologyPreset('bogus')` throws/returns null (loud failure).
- `test/topologies.test.js` (buildManifest regression): for a web-app profile `manifest.topology === 'web-app'`, `architecture.enabled === true`, `observability.enabled === true`, `verification.mode === 'docker'`; for a lite profile `manifest.topology === 'cli-or-library'`, `architecture.enabled === false`, `observability.enabled === false`; for a projectType-C backend-only profile `manifest.topology === 'api-service'`, `stack.frontend` null, `observability.enabled === true`.
- The pre-existing scaffold/manifest tests must stay green unchanged (behavior preservation).
- `harness-manifest.json` `topology-templates` guide is `active` and `wired_at` resolves; `node .claude/scripts/validate-harness-manifest.js` passes; `npm test` green.

## Risks & mitigations

- **Behavior drift from the refactor.** Mitigation: the presets must reproduce today's exact per-shape output; the existing scaffold-render/manifest/layers-config tests are the pin. Run them as the regression guard in the final task.
- **New `manifest.topology` field breaking a contract test.** Mitigation: check `project-manifest-contract.test.js`; if it asserts an exact key set, update it to allow/expect the new optional field (a deliberate, reviewed change, not a silent break).
- **resolveTopology disagreeing with isLiteShaped.** Mitigation: `resolveTopology` is built *on* `isLiteShaped` (calls it), so the lite path can't diverge from the `cli-or-library` topology.

## Out of scope

JVM/Go/event-processor topologies (codegen+verify not supported); new per-topology sensor thresholds (latency/coverage knobs); changing calibration-profile (stays projectType-driven); any change to how guides/sensors are gated (they remain gated by the same manifest knobs the topology presets).
