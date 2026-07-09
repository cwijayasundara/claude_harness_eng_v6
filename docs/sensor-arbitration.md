# Sensor Arbitration

The harness now has many guides and sensors. This policy keeps them coherent when signals disagree, and gives agents a narrow way to record justified exceptions without hiding drift.

## Blocking Levels

Every sensor should declare one of these levels in its docs or manifest entry:

| Level | Meaning | Examples |
|---|---|---|
| `hard-block` | The change cannot proceed until fixed or explicitly waived by a human. | grounding failures, secret leaks, new API breaking changes, a cross-feature regression (`regression-suite-full`) |
| `self-correct` | The agent must try to fix it in the current loop before asking for review. | lint, type, layer, mutation survivor on touched code |
| `review-focus` | The change may proceed, but the finding must be surfaced in review. | threshold bump, modularity concern, known flake |
| `advisory` | Informational trend or slow-cadence signal. | harness coverage holes, dead-code drift, modularity-review staleness (G19) |

## Conflict Order

When signals point in different directions, resolve them in this order:

1. **Traceability and safety win first.** Grounding, secrets, authz, privacy, and contract-breaking findings override style, speed, and convenience.
2. **Behaviour preservation beats cleanup.** A refactor cannot update tests or snapshots to make the refactor pass; split behaviour work into a separate change.
3. **Architecture fitness beats local convenience.** Do not bypass layer/context/cycle rules to make a small edit easier.
4. **Test adequacy beats coverage vanity.** A 100% covered line with a mutation survivor is still under-tested.
5. **Readability beats micro-optimization unless an SLO is failing.** If latency and clarity conflict, document the trade-off and let the perf ratchet decide.
6. **Small modules beat arbitrary thresholds.** Length and complexity caps guide refactoring, but avoid splitting code into pass-through fragments or prop chains just to satisfy a number.

## Waiver Schema

Waivers live at `specs/reviews/sensor-waivers.json` and must match `.claude/templates/sensor-waivers.schema.json`. A waiver is not a suppression forever; it is a reviewed note with an expiry condition.

Required fields:

- `sensor_id` — the manifest id, for example `mutation-smoke` or `length-caps`.
- `scope` — file, glob, endpoint, or artifact covered by the waiver.
- `reason` — the trade-off, stated concretely.
- `expires` — date, release, ticket, or measurable condition that ends the waiver.
- `approved_by` — human reviewer or explicit approval marker.

## Expiry

Expired waivers should be treated as `review-focus` findings at minimum and `hard-block` when they cover safety, traceability, API compatibility, or test adequacy. A threshold bump without an expiry is invalid.

## Worked Classification: `regression-suite-full` (G15)

`regression-suite-full` (`.claude/scripts/regression-gate.js`) is `hard-block`: a previously-passing accumulated `e2e/` Playwright spec or a prior story-group's sprint-contract API check failing against the running app is exactly the "something that used to work is now broken" case this policy exists to catch — it must not be waved through by the change that broke it. It is waivable only the same way any hard-block is: a human-reviewed `sensor-waivers.json` entry with `sensor_id: "regression-suite-full"`, a `scope` naming the specific spec or contract check regressed, a concrete `reason` (e.g. an intentional breaking change to a feature being retired this sprint, with the replacement behavior already covered by a new/updated spec), and an `expires` condition tied to when the old spec/check is deleted or rewritten — never an open-ended suppression. A regression against a test already recorded in `specs/drift/flake-history.jsonl` is excluded automatically (it is a known flake, not a regression) and needs no waiver.

## Worked Classification: `impact-scoped-regression` (G16)

`impact-scoped-regression` (`.claude/scripts/local-regression-gate.js`) is `hard-block`, for the same reason `regression-suite-full` (G15) is: a regressed e2e spec or contract check is "something that used to work is now broken," whether caught by the full merge-time sweep or the fast local one. It is waivable the same way — a `sensor-waivers.json` entry with `sensor_id: "impact-scoped-regression"`, a `scope` naming the specific spec or contract check, a concrete `reason`, and an `expires` condition — never open-ended. Two differences from G15's waiver worth noting: (1) a waiver here only covers the LOCAL check — the same regression will still be caught by G15's full sweep at `/gate`/`/auto` unless separately waived there too, so a local-only waiver cannot smuggle a real regression to merge; (2) an unreadable `code-graph.json` or `verification-matrix.json` degrades the scope to "changed files only" (a loud note, not silence) rather than blocking — the absence of impact data is not itself a regression, but it does mean this check's coverage is weaker than usual for that run, which is why G15's full sweep remains mandatory at merge regardless of how clean G16 came back.

## Worked Classification: `legacy-discipline-proof` (G17)

`legacy-discipline-proof` (`.claude/scripts/legacy-discipline-gate.js`) is `hard-block`, for the same category of reason `regression-suite-full` (G15) and `impact-scoped-regression` (G16) are: "checking-coverage-before-change never ran before this legacy edit" and "this UNCOVERED edit has no pin-down/sprout evidence" are exactly the silent-regression-invitation cases this policy exists to stop before they reach review. It is waivable only the same way any hard-block is: a human-reviewed `sensor-waivers.json` entry with `sensor_id: "legacy-discipline-proof"`, a `scope` naming the specific file (and, where relevant, symbol) the waiver covers, a concrete `reason` (e.g. a vendored file with no realistic local test harness, or a one-line typo fix where writing a pin-down is genuinely disproportionate to the risk), and an `expires` condition tied to when real coverage lands for that file — never an open-ended suppression. `HARNESS_LEGACY_DISCIPLINE_GATE=off` is a local, unreviewed escape hatch (the same shape as `HARNESS_OWNERSHIP_GATE=off`): it acknowledges a skip for one machine's commit, it does not substitute for a waiver, and a maintainer reviewing history should treat a commit that used it the same as an unreviewed exception. Two things distinguish this sensor from G15/G16's runtime regressions: (1) it never touches a running app — its evidence is entirely a receipts ledger (`specs/reviews/coverage-verdicts.jsonl`, itself gitignored local-session state, same as `ownership-check.json`) plus `git diff --cached`, so its cadence and scope are `commit`/`artifacts`, not `integration`/`runtime`; (2) it composes with, rather than duplicates, `mutation-smoke` (G7) — this gate proves *evidence of process* (a verdict was recorded; a test was staged alongside an UNCOVERED edit), while `mutation-smoke` independently proves that test *actually bites*. Neither one substitutes for the other.

## Worked Classification: `coupling-ratchet` (G18)

`coupling-ratchet` (`.claude/scripts/coupling-gate.js`) is `hard-block`, the same level and the same rationale conflict-order item 3 already states for its sibling ratchet, `cycle-detection` (G8): "architecture fitness beats local convenience — do not bypass layer/context/cycle rules to make a small edit easier." A monotonic ratchet exists precisely so a change cannot make architecture fitness worse to get itself over the line, and an unstable hub (fan_in >= 5, instability >= 0.8) is architecture fitness decaying in exactly the same sense a new import cycle is — coupling concentrating on a file that everything depends on and that itself depends on little, making that file expensive to change safely. It is waivable only the same way any hard-block is: a human-reviewed `sensor-waivers.json` entry with `sensor_id: "coupling-ratchet"`, a `scope` naming the specific hub file, a concrete `reason` (e.g. a deliberate, reviewed facade/aggregator whose high fan-in is the intended design, not accidental coupling), and an `expires` condition tied to when the hub is split or the design is revisited — never an open-ended suppression. Two things distinguish this sensor from `cycle-detection`'s waiver: (1) the baseline it ratchets against stores the actual unstable-hub id set, not just a count, so a BLOCK can always name the specific new hub(s) rather than restating the whole current set; (2) it is deliberately count-based like `cycle-detection`, not a full set-diff gate — a run where one hub is fixed and a different hub newly crosses the threshold in the same commit can net to an unchanged or lower count and pass without blocking, the identical known limitation `cycle-detection`'s ratchet already accepts for cycles. A reviewer relying on this gate alone should still treat `coupling-report.md`'s full hub table as the periodic drift-cadence backstop for that edge case, the same way `regression-suite-full` (G15) backstops `impact-scoped-regression` (G16).

## Worked Classification: `at-first-proof` (G23)

`at-first-proof` (`.claude/scripts/at-first-gate.js`) is `hard-block`, for the same category of reason `legacy-discipline-proof` (G17) is: "writing-acceptance-tests-first's AT was never confirmed red before this story's new production code was committed" is the same silent-regression-invitation case this policy exists to stop before it reaches review — a story could otherwise skip straight from acceptance criteria to implementation with nothing verifying the requirement was understood. It is waivable only the same way any hard-block is: a human-reviewed `sensor-waivers.json` entry with `sensor_id: "at-first-proof"`, a `scope` naming the specific story (and its `atPath`), a concrete `reason` (e.g. a trivial one-line story where writing a Ports-and-Adapters AT is genuinely disproportionate to the risk, or a story whose "production" file is itself pure scaffolding/config with no business logic to assert against), and an `expires` condition tied to when the AT lands — never an open-ended suppression. `HARNESS_AT_FIRST_GATE=off` is a local, unreviewed escape hatch (the same shape as `HARNESS_LEGACY_DISCIPLINE_GATE=off`): it acknowledges a skip for one machine's commit, it does not substitute for a waiver, and a maintainer reviewing history should treat a commit that used it the same as an unreviewed exception. One thing distinguishes this sensor's evidence from a strict reading of the Iron Law it backs: a `record-at-red.js` receipt's timestamp mechanically proves the AT was confirmed red BY THE TIME OF THIS COMMIT — it does not, and cannot without fragile git-history archaeology, prove the red run strictly preceded every line of the specific implementation commit that follows. This is the same class of disclosed-not-hidden limitation `legacy-discipline-proof` (G17) states for its own file-level (not symbol-level) receipt matching: the mechanical value is real ("the AT existed and was proven red before this commit landed"), but it is narrower than the skill's own wording ("no implementation until an acceptance test exists, fails for the right reason... only NOW proceed") — a reviewer relying on this gate alone should still spot-check genuinely suspicious timing (e.g. a receipt and its story's first production file staged in the same commit) the way any hard-block gate's evidence should be sanity-checked, not treated as unconditionally conclusive.

## Adding Sensors

When adding a guide or sensor:

1. Register it in `harness-manifest.json`.
2. Document its blocking level.
3. State whether it is waivable.
4. If waivable, name the evidence needed in `sensor-waivers.json`.
