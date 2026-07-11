# Product SKUs and sensor tiers

Normative design for packaging and operability. **Phase 0–1 freezes the vocabulary**; marketplace packaging and the pre-commit registry land in later PRs.

This doc is the single place that names:

1. What we ship as products (SKUs)
2. How commit/session complexity is dialed (`sensor_tier`)
3. How those two axes compose with scaffold profiles

## SKUs (what you install)

| SKU | Audience | Contents (intent) |
|---|---|---|
| **harness-lite** | Disposable artifacts only (mockups, ARB docs, research) | Artifact lanes; no SDLC, no GAN, no quality hooks |
| **harness-core** | Default product teams | Build / feature / gate spine + brownfield discipline; lean plugin allowlist |
| **harness-full** | Teams that want the full optional surface | Core + optional skills (framework packs, verticals), full plugin set, telemetry templates |
| **symphony** *(future product boundary)* | Headless tracker → PR factory | Orchestrator outside Claude Code; not part of core install |

The monorepo is the source of truth. **Packaging emit is live** (`npm run package:skus` → `dist/skus/<sku>`). Load a built tree with `claude --plugin-dir dist/skus/harness-core`. Marketplace/registry publish remains a follow-on; the vocabulary above is stable.

**Symphony** (`symphony_clone/`) is a separate product boundary (tracker orchestrator). It is not part of harness-core / lite / full SKUs — see [`docs/symphony-product.md`](symphony-product.md).

### Scaffold profiles vs SKUs

| Scaffold flag | Maps toward SKU | Notes |
|---|---|---|
| `/scaffold` (default `core`) | harness-core | Lean copy set |
| `/scaffold --brownfield` | harness-core | Alias of the same lean product spine |
| `/scaffold --full` | harness-full | Optional surface |
| `harness-lite/` plugin dir | harness-lite | Separate loadout; do not co-load with full |

SKUs are **install boundaries**. Sensor tiers are **runtime dials** inside a product install.

### Token Saver posture (cost control)

Product scaffolds (`web-app` / `api-service` / `cli-or-library`) default to
`execution.model_tier: "cost"` (Sonnet generation, Haiku exploration, Opus judgment).
Optional org policy: `token_governor.mode: "enforced"`. Measure with:

```bash
node .claude/scripts/cost-report.js
node .claude/scripts/pipeline-status.js   # Cost: line when metering
```

Full operator guide: [token-cost-playbook.md](token-cost-playbook.md). This monorepo
may keep `balanced` for dogfood; product installs should prefer `cost`.

## Sensor tiers (complexity dial)

Configured at `project-manifest.json#quality.sensor_tier`:

| Value | Intent |
|---|---|
| `minimal` | Secrets + structural basics when configured; low-ceremony CLI/library work |
| `standard` | **Default.** Product-team posture — matches today's pre-commit set (once the registry lands) |
| `strict` | Standard plus extra architecture ratchets at commit (cycle / coupling) |

### Defaults

- Scaffold default for product apps (`web-app` / `api-service`): **`standard`**
- Topology `cli-or-library` / project type D: scaffold writes **`minimal`** (`scaffold-render.js`)
- Explicit override: profile field `sensorTier` or `quality.sensor_tier` on the scaffold profile
- This monorepo (Project Zero): **`standard`**

### Escape hatches (not the primary control plane)

Per-gate env vars (`HARNESS_*_GATE=off`) remain **local, unreviewed** skips. Prefer:

1. Fix the finding, or
2. A reviewed `specs/reviews/sensor-waivers.json` entry, or
3. Lowering `quality.sensor_tier` only when the project shape genuinely does not need product ceremony

Env overrides for the dial itself (when wired): `HARNESS_SENSOR_TIER=minimal|standard|strict` wins over the manifest for one machine/session.

### Commit-time membership (normative for Phase 1)

`standard` **must** preserve today's pre-commit behavior (including sprout-diff). `minimal` drops legacy / AT-first / coverage / mutation ceremony. `strict` adds cycle + coupling at commit when a code-graph exists.

| Gate id | minimal | standard | strict |
|---|---|---|---|
| `secret-scan` | ✓ | ✓ | ✓ |
| `amendment-provenance` | ✓ | ✓ | ✓ |
| `test-deletion-guard` | | ✓ | ✓ |
| `refactor-purity` | ✓ | ✓ | ✓ |
| `layer-imports` | ✓* | ✓ | ✓ |
| `bounded-context-rules` | ✓* | ✓ | ✓ |
| `ownership-check` | ✓* | ✓ | ✓ |
| `legacy-discipline-proof` | | ✓ | ✓ |
| `sprout-diff` | | ✓ | ✓ |
| `at-first-gate` | | ✓ | ✓ |
| `sprint-contract` (+ security + verification-matrix) | ✓ | ✓ | ✓ |
| `type-check` (tsc at pre-commit) | ✓ | ✓ | ✓ |
| `coverage-ratchet` | | ✓ | ✓ |
| `mutation-smoke` | | ✓ | ✓ |
| `cycle-detection` | | | ✓ |
| `coupling-ratchet` | | | ✓ |

\* When architecture/contexts/component-map are configured; otherwise the gate no-ops or skips loudly as today.

Enforcement of this table is **live** (PR3): `.claude/hooks/lib/sensor-tier.js` + `.claude/hooks/lib/gate-registry.js` filter the pre-commit dispatcher (`.claude/git-hooks/pre-commit`). Default `standard` preserves the historical pre-commit set.

## Project Zero (this repository)

The harness monorepo dogfoods itself via root `project-manifest.json`:

- `topology`: `cli-or-library`
- `architecture.enabled`: `false` (plugin control plane is not a layered product app)
- `quality.sensor_tier`: `standard`
- `quality.agent_readiness.mode`: **`ratchet`** with `min_active_pillars: 5` and `forbid_regression: true`

Readiness baseline (committed): `.claude/state/agent-readiness-baseline.json`

```bash
npm run agent-readiness          # write specs/reviews/agent-readiness.json (gitignored)
npm run agent-readiness:assert   # hard-fail if below min or below baseline
npm run agent-readiness:baseline # raise (or --force rewrite) the committed baseline after a real improvement
npm run retention:dry            # preview prune of .claude/runs + state/archive
npm run retention                # prune runs >14d, archive >30d
```

CI runs generate + assert on every PR/main push. Scaffolded product apps still default to `agent_readiness.mode: "report"` — only this monorepo is ratcheted.

## Progressive skill loading

Large orchestrator skills keep a short **entry** `SKILL.md` and move procedure into `references/`. Agents load only the section/mode they are executing.

| Skill | Entry budget | Procedure |
|---|---|---|
| `/auto` | ≤80 lines | `skills/auto/references/section-*.md` |
| `/design` | ≤80 lines | `skills/design/references/mode-*.md` (+ templates) |
| `/build` | ≤80 lines | `skills/build/references/section-*.md` (+ lite/autonomous lanes) |

Wiring-contract tests read the full **corpus** (`SKILL.md` + `references/*.md`) via `test/helpers/skill-corpus.js`.

## Marketplace publish

Emit is live; **publish steps** (marketplace, tarball, interim clone) live in
[`docs/marketplace-publish.md`](marketplace-publish.md).

## Out of scope here

- Symphony ops / tracker env (separate product)
