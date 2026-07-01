# Sensor Arbitration

The harness now has many guides and sensors. This policy keeps them coherent when signals disagree, and gives agents a narrow way to record justified exceptions without hiding drift.

## Blocking Levels

Every sensor should declare one of these levels in its docs or manifest entry:

| Level | Meaning | Examples |
|---|---|---|
| `hard-block` | The change cannot proceed until fixed or explicitly waived by a human. | grounding failures, secret leaks, new API breaking changes |
| `self-correct` | The agent must try to fix it in the current loop before asking for review. | lint, type, layer, mutation survivor on touched code |
| `review-focus` | The change may proceed, but the finding must be surfaced in review. | threshold bump, modularity concern, known flake |
| `advisory` | Informational trend or slow-cadence signal. | harness coverage holes, dead-code drift |

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

## Adding Sensors

When adding a guide or sensor:

1. Register it in `harness-manifest.json`.
2. Document its blocking level.
3. State whether it is waivable.
4. If waivable, name the evidence needed in `sensor-waivers.json`.
