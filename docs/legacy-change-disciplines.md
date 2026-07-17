# Legacy-change disciplines — one map

When an agent changes **existing** code (not greenfield), the harness applies a small
family of narrow disciplines so the change can't silently regress behavior the current
tests don't pin. They are deliberately separate skills — each fires in a different
situation and each is proved by its **own** mechanical gate, so a bug in one can't
disable the others (no god-gate). This page is the single place that shows the family as
a whole; the skills and gates themselves are unchanged.

> These are **internal disciplines**: the lane skills (`/change`, `/refactor`, `/vibe`,
> `/implement`) invoke them automatically mid-task. Direct invocation is a power-user
> path. You rarely call them by hand — you read this map to understand *why* an edit was
> blocked, or how the harness protects legacy code.

## The decision flow

```
About to edit an EXISTING symbol?
│
├─ checking-coverage-before-change ──► is the symbol covered by a test?
│        │
│        ├─ covered ─────────────► edit freely (the test will catch a regression)
│        │
│        ├─ uncovered, pinnable ─► pinning-down-behavior  (characterization test first)
│        │
│        └─ uncovered, unpinnable ► sprouting-instead-of-editing (add new tested unit)
│
├─ change includes structure (rename/move/extract/reorder)?
│        └─ keeping-refactors-pure  (structural commits behavior-free, and vice versa)
│
├─ change touches persisted data shape (schema/migration/serialized format)?
│        └─ checking-migration-safety  (expand-contract; prove reversibility before deploy)
│
├─ change is a dependency version bump?
│        └─ upgrading-dependencies  (classify bump, audit usage, isolate in a proven commit)
│
└─ story moving from acceptance criteria to implementation?
         └─ writing-acceptance-tests-first  (business-readable AT at a Ports/Adapters seam,
                                             red before any production code)
```

## Discipline → when it fires → the gate that proves it ran

Each discipline has an independent, mechanical pre-commit (or real-time) proof — the gate
is what makes the discipline non-skippable, and each proves a *different* thing.

| Discipline (skill) | Fires when | Proof gate (manifest id / gap) |
|---|---|---|
| `checking-coverage-before-change` | before the first edit of an existing symbol | `coverage-preflight` (real-time PreToolUse block) + `legacy-discipline-proof` (G17, commit receipt) |
| `pinning-down-behavior` | coverage reports the symbol UNCOVERED but pinnable | `legacy-discipline-proof` (G17) — the staged pin-down test is the evidence |
| `sprouting-instead-of-editing` | UNCOVERED and unpinnable (low seam score / god file) | `sprout-diff` (G30) — legacy diff must touch exactly one symbol |
| `keeping-refactors-pure` | a commit mixes structural + behavioral work | `refactor-purity` (commit) |
| `writing-acceptance-tests-first` | a story moves from AC to implementation | `at-first-gate` (G23) — AT file + red receipt required |
| `checking-migration-safety` | a change alters persisted data shape | guidance (expand-contract) — no dedicated gate; paired with the regression gates |
| `upgrading-dependencies` | a dependency version / lockfile bump | `test-deletion-guard` (G31) guards the suite from being gutted to pass |

## Why they are not merged

They look like one "sub-tower," and a tempting simplification is to collapse all seven
into a single skill with a single gate. The harness deliberately does **not**:

- Each gate proves a **distinct** invariant (coverage receipt ≠ single-symbol sprout diff
  ≠ AT red receipt ≠ refactor purity ≠ test-count preservation). One god-gate proving all
  of them would be a **single point of failure** — a bug in it silently disables every
  proof at once.
- The harness's own modularity sensors (`modularity-reviewer`, `coupling-ratchet`) would
  flag such a god-skill/god-gate as exactly the kind of high-fan-in hub they exist to
  prevent.
- Each skill's description is its **auto-invocation trigger**; a merged trigger surface
  would fire less precisely, in more situations than each narrow discipline needs.

So the disciplines stay separate by design. This map is the "one place to understand the
family" — the consolidation is in *comprehension*, not in collapsing the machinery.

See `HARNESS.md` (Behaviour + Maintainability rows) for how these gates sit in the full
control system, and `harness-manifest.json` for each gate's `wired_at` path.
