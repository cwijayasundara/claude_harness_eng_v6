# Claude Harness Engine v5

A Claude Code plugin for building and changing software with a generator/evaluator loop, ratcheting quality gates, and explicit human review before merge.

Current version: `2.1.0`

## Start Here

### Recommended: load a packaged SKU

From a checkout of this repo (or a release artifact):

```bash
# Build local plugin trees (core = lean product, lite = artifacts only)
npm run package:skus
# → dist/skus/harness-core , dist/skus/harness-lite , dist/skus/harness-full

cd ~/my-project
claude --plugin-dir /path/to/claude_harness_eng_v5/dist/skus/harness-core
```

Then inside Claude Code:

```text
/scaffold
```

| SKU | Load | Use when |
|---|---|---|
| **harness-core** (default product) | `dist/skus/harness-core` | Building/changing software |
| **harness-full** | `dist/skus/harness-full` | Need optional skills / full surface |
| **harness-lite** | `dist/skus/harness-lite` | Mockups / ARB docs / research only |

SKU vocabulary: [docs/product-skus-and-tiers.md](docs/product-skus-and-tiers.md).  
Publish process (marketplace / tarball / interim): [docs/marketplace-publish.md](docs/marketplace-publish.md).

### Contributors: clone + monorepo plugin dir

```bash
git clone https://github.com/cwijayasundara/claude_harness_eng_v5.git ~/claude_harness_eng_v5
cd ~/my-project
claude --plugin-dir ~/claude_harness_eng_v5/.claude
```

If your Claude Code UI shows a namespaced command, use `/claude_harness_eng_v5:scaffold`.

Every project gets the lean `core` scaffold by default: `/build`, `/auto`, `/gate`, plus the minimal brownfield spine (`/feature`, `/brownfield`, `/code-map`, `/change`, `/refactor`, `/vibe`, tracker publishing). Use `/scaffold --full` only when you explicitly want the optional harness surface.

### Upgrading an already-scaffolded project

Refresh hooks/scripts/git-hooks/agents without wiping `project-manifest.json` or `.claude/state/`:

```bash
# dry-run (default)
node /path/to/claude_harness_eng_v5/.claude/scripts/scaffold-upgrade.js --target ~/my-project
# apply
node /path/to/claude_harness_eng_v5/.claude/scripts/scaffold-upgrade.js --target ~/my-project --apply
# also refresh skills (larger prompt surface change)
node …/scaffold-upgrade.js --target ~/my-project --apply --include-skills
```

## Dashboard

### 1. Pick The Scaffold

```
What are you installing into?
├── Normal product repo / app / service / CLI       → /scaffold
├── Existing repo that will keep receiving changes  → /scaffold
├── You want the old brownfield profile name        → /scaffold --brownfield
├── You want optional ops/extras copied too         → /scaffold --full
└── You want telemetry env + dashboard files        → /scaffold --telemetry
```

Default answer: use `/scaffold`. Sprint 2+ is brownfield, so the lean core already includes the existing-code route.

### 2. Pick The Work Route

```
Are you building something NEW?
├── Yes → small scope (CLI, library, ≤5 stories)?  → /build --lite
│         otherwise                                 → /build
│
└── No (existing codebase) → normal route: /feature "<request>"
          first time here? /feature refreshes the DeepWiki/code-map first, then:
          ├── tiny safe edit (≤3 files, <150 lines, no auth/API) → /vibe
          ├── changed behavior (add --issue N for a GitHub bug)  → /change
          ├── structure only, no behavior change                 → /refactor
          └── big enough to need specs                           → /build (brownfield-aware)
```

Not sure? Describe the request plainly. The harness should classify the lane before it edits.

## Command Cards

The public surface is intentionally small:

```
New product          → /build
Existing product     → /feature "<request>"
Sprint N of an existing product → /sprint <prd-file>
Verify/review        → /gate
```

The other commands below are still available, but the harness should usually route to them for you.

| Command | Use when | What happens |
|---|---|---|
| `/scaffold` | New target repo setup | Installs the lean core harness, settings, hooks, state seeds, manifest, and project guide |
| `/build --lite "<idea>"` | Small greenfield project | Short interview, compact plan, one group, then `/auto` |
| `/build <prd> --lite --auto` | Small PRD, hands-off | Headless lite: compressed plan (≤5 stories, one group, no interview/gate) -> PR; auto-escalates to the full `--auto` pipeline if the PRD exceeds lite scope |
| `/build <prd>` | Normal greenfield build | BRD -> stories -> design/test plan -> `/auto`, with human gates |
| `/build <prd> --auto` | PRD is ready and you want hands-off | PRD -> PR with no human approval gates; machine gates still block red builds |
| `/sprint <prd-file>` | Next PRD for an existing (harness-built or brownfield) product | Grounds the PRD against the prior sprint's requirements, amends the living design with a human-reviewed diff (never regenerates it), then `/auto` |
| `/feature` | Normal existing-code feature/change. Run as `/feature "<request>"` | Refreshes committed DeepWiki/code-map, creates or publishes story, routes to the right lane, gates, opens PR |
| `/brownfield` | Discovery-only map of an existing repo | Delegates graph/wiki generation to `/code-map`, writes short architecture/test/risk/change strategy, stops before code |
| `/code-map` | Agent needs deterministic repo map only | Produces `code-graph.json`, `symbol-map.md`, and `wiki/WIKI.md` |
| `/vibe` | Very small safe edit | Controlled fast lane for tiny changes |
| `/change` | Behavior change in existing code | Test-first change route; use `--issue N` for a GitHub bug |
| `/refactor` | No behavior change | Behavior-preserving cleanup with coverage and refactor-purity gates |
| `/gate` | Before merge or after manual edits | Evaluator + diff review, with security review only when the diff crosses a security/data/API boundary; when that trigger fires, both axes re-verify across 3 independent instances, majority-voted (fail-safe to BLOCK/FAIL if an instance errors or times out); renamed from old harness `/review` to avoid native `/review` collision |
| `/pr-respond <pr#>` | A harness PR has red CI or review comments | Polls checks + comments, classifies via the self-healing table, fixes, pushes, replies with evidence; bounded and budget-metered; never merges |
| `/status` | See progress | Reads current pipeline state; also available as `npm run status` |
| `/agent-readiness` | Is this codebase ready for heavy AI-agent use? | 8-pillar synthesis dashboard over signals the harness already collects; also available as `npm run agent-readiness` |

## Approval Modes

| Mode | Command | Human gates |
|---|---|---|
| Gated | `/build <prd>` | Approve BRD, stories, design/test plan |
| Semi-auto | `/build <prd> --autonomous` | One plan approval gate |
| Full-auto | `/build <prd> --auto` | Zero human gates |
| Sprint (gated) | `/sprint <prd-file>` | Approve requirement delta + decomposition, approve design amendment |
| Sprint (semi-auto) | `/sprint <prd-file> --autonomous` | One consolidated gate before the design amendment; the amendment approval itself is never skipped |

Machine gates always stay on: tests, lint/types, coverage, architecture, evaluator, design critic when enabled, adaptive review, and diff review. The generator does not grade itself, and the harness does not merge for you.

For long unattended PRD-to-PR runs, prefer the resilient chain launcher — see the recovery section below.

## If Your Run Dies (and What It Costs First)

`/auto` runs are resumable by design — a killed session, closed laptop, or budget stop loses nothing that was committed:

- **Just re-invoke `/auto`.** It resumes from `claude-progress.txt` (the append-only progress log every iteration writes), re-reads `features.json` and git state, and runs a startup smoke check before building on prior work. Nothing needs exporting from the dead session. (Wall-clock is metered from `.claude/state/budget-start`, which survives the dead session — a long gap counts as spend.)
- **See where it stopped** with `/status` (or `node .claude/scripts/pipeline-status.js status`), which reads the same state files.
- **Budget stops are clean stops.** Every run is metered (wall-clock, agent spawns, estimated cost via `node .claude/scripts/budget-state.js`) and stops at an iteration boundary when a cap is hit, setting `next_action: "BUDGET — …"` in `claude-progress.txt`. Raise the cap via `project-manifest.json#execution.budget` (or relaunch through `/build … --budget <spec>` / `--budget off`), then re-invoke `/auto` to resume.
- **For long unattended PRD-to-PR runs**, prefer `node .claude/scripts/build-chain.js docs/prd.md` — it starts a fresh `claude -p` process per build wave through the same progress file, so a killed process resumes at the next wave.

Default budget caps by model tier (`.claude/scripts/budget-state.js`):

| Tier | Wall-clock | Agent spawns | Est. cost |
|------|-----------|--------------|-----------|
| `cost` | 30 min | 80 | ~$8 |
| `balanced` (default) | 90 min | 200 | ~$25 |
| `max-quality` | 180 min | 400 | ~$60 |

Cost figures are surfaced estimates (Σ per-spawn receipts × tier rate), not billing data. A first `--auto` run on `balanced` that stops after ~90 minutes with `BUDGET` in `next_action` is behaving as designed — resume it or merge what's done.

## Existing-Code Flow

For sprint-by-sprint product work on an existing repo, start with `/feature "<request>"`.

`/feature` keeps the committed DeepWiki fresh, creates or publishes the story when a tracker is configured, checks the existing design before planning changes, delegates to `/vibe`, `/change`, `/refactor`, or `/build` by scope, runs tests and gates, and leaves the issue in Human Review with the PR linked.

When the next unit of work is a full PRD rather than a single request, use `/sprint <prd-file>` instead — it grounds the PRD against the prior sprint's requirements and produces a human-reviewed design amendment before any code generation, so the system evolves sprint by sprint instead of being regenerated each time.

Use `/brownfield` directly only when you want discovery without implementation. Use `/brownfield --seams "<goal>"` when you need safe cut-points before a risky change. Use `/brownfield --full` only for heavier CI/flag/perf inventory and evaluator scoring.

## Harness vs native Claude Code commands

| Need | Native Claude Code | Harness |
|---|---|---|
| Review a GitHub PR | `/review` | Use native `/review` |
| Run blocking pre-merge quality checks | - | `/gate` |
| Eyeball/run the app | `/run`, `/verify` | `/evaluate` when you need scored verification |
| Mechanical cleanup | `/simplify` | `/refactor` wraps `/simplify` with behavior-preservation gates |
| Generate only CLAUDE.md | `/init` | `/scaffold` for full harness bootstrap |

Rule: native commands own atomic actions; the harness owns orchestration, ratcheting, and writer/grader separation.

## What The Harness Protects

- TDD before production edits
- Coverage ratchet and per-diff coverage checks
- Lint/type/layer gates
- Security review before PR when the diff touches security/data/API boundaries
- Fresh-context diff review
- Brownfield discipline: architecture claims cite `code-graph.json`
- Token waste discipline: living DeepWiki/code-map navigation, compact command/search output, and advisory warnings for broad reads or noisy raw commands
- Human review before merge

### Complexity dial

Commit-time ceremony is dialed by **`project-manifest.json#quality.sensor_tier`**: `minimal` · `standard` (default) · `strict`. Install boundaries are separate products (**harness-lite / core / full**). See [docs/product-skus-and-tiers.md](docs/product-skus-and-tiers.md). This monorepo dogfoods itself (Project Zero) via the root `project-manifest.json`.

### Project Zero CI

Harness JS is linted and secrets-scanned in GitHub Actions:

```bash
npm ci
npm run lint                 # eslint on .claude hooks/scripts + tests
npm test
npm run agent-readiness      # regenerate readiness report
npm run agent-readiness:assert   # hard ratchet: min active pillars + no regression vs baseline
```

gitleaks runs as a separate CI job (`.gitleaks.toml`).

After a deliberate readiness improvement (new pillar becomes active), refresh the committed baseline:

```bash
npm run agent-readiness:baseline
# then commit .claude/state/agent-readiness-baseline.json
```

Runtime churn hygiene (local; `*.jsonl` is gitignored):

```bash
npm run retention:dry   # preview
npm run retention       # prune .claude/runs (>14d) and state/archive (>30d)
```

## Token Usage Optimizer

The lean scaffold now ships a scaffold-native token-saving layer, enabled by
default in `project-manifest.json#token_governor`:

- Living navigation from `/scaffold`: placeholder or fresh `code-graph.json`,
  `symbol-map.md`, and deterministic DeepWiki, kept current as code changes.
- `/context "<question>"`: returns bounded file/line citations before broad
  source reads.
- Compress-Cache-Retrieve (CCR): raw command/search output is stored locally by
  hash under `.claude/state/context-cache/`, while the agent receives compact
  failure/search evidence first.
- `run-compact.js`: runs noisy commands and preserves raw output plus compact
  failure evidence.
- `search-compact.js`: returns grouped search hits while preserving the full raw
  search output.
- `token-advisor.js`: non-blocking `Read|Bash` hook that warns on avoidable
  broad source reads and likely verbose commands.
- `/status`: reports navigation freshness, context-cache savings, and token
  advisor warning counts.

Useful commands:

```bash
node .claude/scripts/context-pack.js "where is session validation handled?"
node .claude/scripts/run-compact.js --kind test -- npm test
node .claude/scripts/search-compact.js --pattern "validateSession" --glob "src/*.ts"
node .claude/scripts/context-retrieve.js <hash> --query "auth token"
node .claude/scripts/pipeline-status.js status
```

The optimizer is advisory by default. It suggests cheaper paths and records
warnings, but it does not block work unless a future project explicitly enables
enforced mode. See [docs/token-governor.md](docs/token-governor.md) and
[docs/token-usage-optimizer-design.md](docs/token-usage-optimizer-design.md).

## Optional Power-Ups

| Power-up | How to enable | Details |
|---|---|---|
| Telemetry dashboards | `/scaffold --telemetry` | [docs/telemetry.md](docs/telemetry.md) |
| Token Usage Optimizer / living DeepWiki / CCR | On by default | [docs/token-governor.md](docs/token-governor.md) |
| Framework skill packs | Select during scaffold, then install manually | [docs/extras.md](docs/extras.md) |
| Tracker orchestration | Configure Linear/Jira/Azure DevOps | [docs/extras.md](docs/extras.md) |
| Drift cadence workflow | Copy `.claude/templates/github-workflows/harness-drift.yml` to `.github/workflows/` | Runs drift, harness coverage, flakes, fixtures, contract drift, and optional SLO checks |
| PR-time E2E re-runs | Copied automatically by /test as .github/workflows/e2e.yml | Re-runs the generated Playwright suite on every PR |
| Unattended backlog-to-merge | Run `symphony_clone/` separately | `symphony_clone/README.md` |
| Artifact-only docs/mockups/research | Use `harness-lite` (not the same as `/build --lite` — see CLAUDE.md's Disposable Artifacts table for which one applies) | `harness-lite/README.md` |

## Testing This Harness

```bash
npm test                 # fast unit/contract suite, no live Claude
node --test test/token-compression-e2e.test.js  # local token optimizer e2e, no live Claude
npm run test:e2e:fast    # e2e contracts + safe helper tests
npm run test:routes      # scaffold + lite-auto + full-auto + gated + feature routes (live Claude)
npm run test:e2e:live    # all live route/smoke checks (live Claude, costs tokens)
npm run test:e2e:cert    # certification stack
npm run test:e2e:all     # fast -> live -> cert
```

E2E logs land in `test/e2e/results/logs/`; summary JSON lands at `test/e2e/results/e2e-pack-summary.json`. Details: [docs/testing.md](docs/testing.md).

## Deep Links

| Topic | Where |
|---|---|
| PRD format | [docs/prd-format.md](docs/prd-format.md) |
| Model/cost posture | [docs/model-allocation.md](docs/model-allocation.md) |
| Behavior preservation | [docs/behavior-preservation.md](docs/behavior-preservation.md) |
| Sensor arbitration | [docs/sensor-arbitration.md](docs/sensor-arbitration.md) |
| Native command boundaries | [docs/native-command-integration.md](docs/native-command-integration.md) |
| Prompt standards | [docs/prompting-standards.md](docs/prompting-standards.md) |
| Harness architecture | [design.md](design.md) |
| Full skill instructions | `.claude/skills/<name>/SKILL.md` |
