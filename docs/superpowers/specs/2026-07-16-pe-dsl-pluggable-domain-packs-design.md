# Pluggable Domain DSL Packs — a Validated Semantic Layer for Complex Verticals

**Date:** 2026-07-16
**Goal:** Give the harness a domain-agnostic mechanism for hosting small, validated, declarative DSLs — one *pack* per bounded context — so that intricate vertical domains (private equity first, then insurance, finance, high-tech, …) can be modeled as an authoritative artifact the harness's agents generate against and self-correct on. Ship the first pack concretely (PE fund waterfall / carry); extract the shared engine only once a second pack forces its shape.

## Motivation

The harness already runs, for software delivery, exactly the discipline Fowler & Joshi describe in ["DSLs Enable Reliable Use of LLMs"](https://martinfowler.com/articles/llm-and-dsls.html): a declarative artifact (the sprint contract, the REASONS Canvas) + a deterministic validator (`validate-contract.js`, `validate-canvas.js`) + agent self-correction against domain-level errors. Their central claim — *"a DSL strips the variation away; giving the model a few examples is enough to reliably generate the correct syntax"*, backed by *"a deterministic validator: a parser, a JSON schema, a type checker, or a compiler"* — is the same mechanism, pointed at a different target.

Today that discipline is applied only to **software structure**, never to **domain semantics**. For a customer whose domain is as intricate as private equity — fund waterfalls, carried-interest tiers, catch-up mechanics, capital calls, the J-curve, sources & uses — that gap is where LLM-authored artifacts silently drift: an IC memo that computes carry one way and an LBO model that computes it another, with nothing to catch the disagreement. This repo's own ubiquitous-language work (`2026-07-05-ubiquitous-language-design.md`) named the same wound from the vocabulary angle: terms fragment across BRD/spec/design, and the traceability sensors check IDs, not domain correctness.

The user is not building one PE product — they are building products across multiple complex verticals on this one harness. So the requirement is not "a PE DSL" but **a pluggable way to add a validated semantic layer to any vertical**. The prior PE-vocabulary design (`2026-07-06-pe-ubiquitous-language-design.md`) anticipated exactly this in its own Out of Scope: *"generalizing to a plugin-agnostic mechanism is a future amendment if a second vertical customer needs it."* This document is that amendment.

Fowler's constraint is what *forces* the pluggable shape. He is emphatic that the payoff is *"concentrated in well-factored, genuinely constrained DSLs"* and that a sprawling language defeats the purpose. You therefore cannot build one grand "business DSL" spanning PE + insurance + finance. The pluggable unit cannot be *a DSL* — it must be **a DSL pack**, and the harness hosts a domain-agnostic **DSL engine** that packs plug into.

## Core decomposition — engine vs. pack

The entire design is drawing one line correctly: everything domain-*shaped* lives in a pack; everything domain-*neutral* is engine and ships once.

| Concern | Lives in | Rationale |
|---|---|---|
| Validator *runner* (dispatch, exit codes, uniform error rendering) | **Engine** | Identical per domain — the `validate-contract.js` pattern, hoisted |
| Two-layer validation *protocol* (schema gate → semantic gate) | **Engine** | Fowler's mechanism is domain-neutral |
| The generic *conformance sensor* (iterates enabled packs) | **Engine** | Registered once in `harness-manifest.json`, not once per domain |
| Pack *discovery* + activation from the vertical registry | **Engine** | Reuses the existing `verticalPacks` / `enabledPlugins` flow |
| Pack *scaffolder / template* | **Engine** | Authoring a new domain = fill a template, not start from zero |
| The *schema* (waterfall shape, policy shape, trade shape) | **Pack** | Pure domain |
| The *semantic rules* (tier ordering; actuarial floors; day-count) | **Pack** | Where the domain expert's knowledge concentrates |
| Domain *error phrasings* | **Pack** | "GP over-catches" vs. "reserve below statutory minimum" |
| Worked-example corpus (few-shot grounding) | **Pack** | Domain-specific by nature |

## The pack contract — the one interface the engine binds to

Pluggability lives or dies on a single interface. Every domain pack — PE, insurance, finance — exports the same shape; the engine knows nothing about waterfalls or policies, only this:

```js
// dsl-packs/<domain>/<name>/pack.js — the ONLY surface the engine binds to
export const meta   = { id, domain, title, boundedContext }  // registry identity
export const schema = { /* JSON Schema */ }                  // LAYER 1: structural gate
export function validate(instance) {                         // LAYER 2: semantic gate
  // arbitrary domain code → returns domain-level findings
  return [{ path, code, message, severity }]                 // "Tier 4 precedes catch-up…"
}
export function terms(instance) { return [{ term, definition }] }  // emits INTO flat CONTEXT.md
export const examples = [ /* valid instances for few-shot grounding */ ]
```

Two properties make this hold across wildly different domains:

1. **`validate()` is arbitrary code, not a rule-DSL.** We deliberately do *not* build a declarative language for expressing validation rules — that would be a DSL to validate the DSLs, unbounded yak-shaving. PE needs ordered arithmetic invariants; insurance needs reference tables (mortality, rating factors); finance needs settlement/day-count logic. A plain function with a fixed I/O contract absorbs all of them.
2. **The two layers map straight onto Fowler.** JSON Schema is the "host-language type system" catching *shape* (free, standard, reusable). `validate()` is the "progressive interface / you-cannot-declare-X-before-Y" catching *semantics*. Keeping them separate is what lets the engine stay dumb and the pack stay smart.

## The first pack — PE fund waterfall / carry (concrete)

Chosen first because it is the most math-dense PE context, which is where Fowler's *"make malformed states un-representable"* discipline pays off most, and because it already has waiting consumers (`private-equity:returns`, `private-equity:lbo`, `pe-ic-memo`'s Returns Analysis section).

Declarative surface (`waterfall.pe.yaml`):

```yaml
waterfall:
  fund: Fund IV
  mode: european          # whole-fund vs. american (deal-by-deal)
tiers:
  - { name: return_of_capital, to: lp, until: contributed_capital }
  - { name: preferred_return,  to: lp, rate: 0.08, compounding: annual }
  - { name: gp_catchup,        to: gp, target_carry: 0.20, basis: full }
  - { name: carried_interest,  split: { gp: 0.20, lp: 0.80 } }
```

`validate()` rejects waterfalls that don't compute, phrased in LP/GP terms:

```
✗ Tier 4 (carried_interest) precedes gp_catchup — carry cannot be split before the catch-up tier resolves.
✗ Catch-up target_carry (20%) ≠ carry split gp share (25%) — the GP would catch up to a carry it never earns.
✗ No `mode` declared (european | american) — DPI and carry timing are undefined.
✗ Tier splits sum to 0.95, not 1.0.
```

This is the direct analog of Tickloom's *"you cannot select an action before choosing a client,"* in PE. The high-value consequence: every consumer skill reads the **same** validated `waterfall.pe.yaml`, so the LBO model and the IC memo can no longer disagree about carry mechanics — a single source of truth that prose vocabulary seeding cannot provide.

## Physical layout & discovery — in-harness `dsl-packs/`

Decision (owner's call, on distribution model): packs live **inside the harness**, keyed by vertical.

```
dsl-packs/
  private-equity/
    waterfall/
      pack.js
      examples/*.yaml
    deal/              # later
  insurance/
    policy/pack.js     # later domain, same contract
  finance/
    trade/pack.js
```

- **Discovery is deterministic** — the engine globs `dsl-packs/*/*/pack.js` and activates only the domains present in `project-manifest.json#domain_vertical_packs`. A scaffolded PE project loads `private-equity/*` and ignores the rest. No `os.homedir()` plugin-dir lookup (unlike `vertical-glossary-pack.js`), so packs are fully testable in-repo.
- **The registry declares, the directory carries.** `.claude/config/scaffold-packs.json#verticalPacks` gains a `dsls: [...]` array per vertical entry (registry identity); the files sit under `dsl-packs/<same-vertical-id>/`. One registry, 1:1 map — no parallel mechanism. The waterfall pack registers under the existing PE **"Investment Decision & Returns"** bounded context.
- **`scaffold-copy.js` gates by enabled vertical** — copies `dsl-packs/private-equity/` into a PE target project the same way it gates `pe-ic-memo` to the `full` profile today.

## The isolation firewall — the guardrail that keeps the decision reversible

The in-harness choice accepts domain knowledge in harness core. That coupling stays reversible only if one rule is enforced mechanically: **engine code must never `import` from `dsl-packs/`.** The engine only *discovers* packs and calls them through the `pack.js` contract — the contract is the seam. Enforce it as a lint/sensor rule: nothing under `.claude/scripts/dsl-engine*` may reference `dsl-packs/` by path. Add a `CODEOWNERS` entry per `dsl-packs/<domain>/` so a domain team can own its packs without touching core.

With the firewall in place, the day a domain grows big enough to hand to a separate team, `dsl-packs/insurance/` lifts out into its own marketplace plugin with zero engine changes — only the discovery glob swaps for the plugin-dir lookup this repo already has precedent for.

## Sequencing discipline — concrete first, extract on the second

Do **not** design the engine in the abstract now. This repo's `CLAUDE.md` principle #2 names the trap precisely: *"a module should hide useful behavior behind a small interface, not just forward calls."* An engine designed before it has two real tenants will encode PE's assumptions (ordered arithmetic tiers) and fight insurance's (table-driven regulatory floors) on day one.

- **Phase 1 — build the PE waterfall pack concretely.** Hardcoded runner, one validator, no plugin interface. Prove the loop end-to-end: a real `waterfall.pe.yaml` → schema gate → `validate()` → domain-level errors → agent self-repair → consumers read it.
- **Phase 2 — add the second pack** (a second PE DSL, e.g. deal/sources-&-uses, or the first insurance pack). Writing the runner/sensor/discovery wiring a second time reveals what is actually shared.
- **Phase 3 — extract the engine and the pack template** from the two real cases. The interface writes itself once two domains have voted on it (rule of three).

## Two-phase authoring per pack (Fowler)

Each new domain pack is onboarded the way Fowler describes building a DSL:

1. **Co-design the grammar (human in the driver's seat).** The semantic model and its validation rules are a design artifact, authored via the disposable-artifact lane (`superpowers:brainstorming` → `/design --doc-only`), **not** the GAN/ratchet pipeline. The domain expert owns the modeling decisions; the LLM sketches and critiques. This is the scarce input.
2. **The pack becomes a natural-language interface.** Once schema + `validate()` + examples exist, the harness's normal machinery generates instances from a prompt/CIM, validates, and self-repairs. *That* code is product code and goes through TDD + review.

Onboarding a new vertical is therefore: one co-design session per DSL + fill the pack template — the payoff that makes "use this harness for finance, insurance, high-tech" tractable.

## Control-plane registration

One **generic** `dsl-conformance` sensor is registered in `HARNESS.md` + `harness-manifest.json` (traceability/behaviour axis), kept honest by `validate-harness-manifest.js`. It iterates every enabled pack and fails when any DSL instance in the project does not pass its pack's two-layer validation. There is **no** per-domain sensor (`pe-waterfall-conformance`, `insurance-policy-conformance`, …) — that would orphan controls, which this repo's memory has repeatedly been burned by.

## Relationship to the flat `CONTEXT.md` glossary — sibling, not replacement

Important boundary: the harness deliberately keeps `CONTEXT.md` a **flat, exact-match, no-new-file-format** glossary; both ubiquitous-language design specs list structured/machine-readable term files and fuzzy matching as explicit non-goals. A DSL pack must therefore be positioned as **a new validated artifact type — a sibling of the sprint contract and the REASONS Canvas** — with its own schema, validator, and sensor. Its `terms()` function *emits* its enum vocabulary (`preferred_return`, `catch-up`, `carried_interest`, …) **into** the flat `CONTEXT.md` at seed time, staying inside the existing model. It must **not** become the source `vocabulary-check.js` reads, and it must **not** replace the vocabulary mechanism.

## Consumer skills stay per-domain

The DSL *engine* is pluggable; the *consumers* are not, and should not be force-generalized — an LBO skill is PE by nature, a reserving skill is insurance by nature. Consumer skills (`returns`, `lbo`, `pe-ic-memo`, and their future insurance/finance analogs) simply gain an instruction to read the relevant validated DSL instance if present and treat it as authoritative. This is the right boundary: generalize the hosting mechanism, keep the domain consumers domain-specific.

## Tests (per pack, and for the engine once extracted)

- **Round-trip the real validator** (CLAUDE.md principle #5): the waterfall pack's tests feed *real* `waterfall.pe.yaml` instances through the *real* `pack.js` `validate()` — never hand-built fixtures. A fixture with the wrong shape keeps the suite green while the DSL is inert.
- Assert each documented domain error actually fires on a correspondingly malformed instance (ordering violation, catch-up/carry mismatch, missing `mode`, non-unit split).
- Assert `terms()` emits the expected vocabulary and that the emitted terms pass `vocabulary-check.js` unchanged.
- Once the engine is extracted (Phase 3): assert discovery activates only packs whose vertical is in `domain_vertical_packs`, and add the firewall lint test (no `dsl-engine*` → `dsl-packs/` import).

## Risks

- **Premature generalization.** The single biggest risk is building the engine before the second pack exists. Mitigated by the explicit Phase 1→3 sequencing and the rule-of-three extraction trigger.
- **Domain coupling in core** (accepted with the in-harness decision). Mitigated by the isolation firewall + `CODEOWNERS`, which keep externalization a mechanical, engine-untouched move later.
- **DSL scope creep** (Fowler's chief warning). Mitigated by the "one bounded context per pack, must fit in a few in-context examples" rule; the moment a pack needs a paragraph of prose to explain, it is too big.
- **Generic-error regression.** If a pack falls back to raw schema errors ("expected number at `$.tiers[3].split.gp`"), the self-correction loop that is the entire point degrades. Tests assert domain-phrased errors specifically.

## Out of Scope

- Building the engine now — deferred to Phase 3 by design.
- A declarative rule-language for `validate()` — packs use arbitrary host code; a meta-DSL for validation is an explicit non-goal.
- Per-bounded-context glossary files or any change to `vocabulary-check.js`'s flat-`CONTEXT.md`, exact-match matcher — unchanged from the 2026-07-05 / 2026-07-06 designs.
- Externalizing `dsl-packs/<domain>/` into standalone marketplace plugins — enabled by the firewall but not done here; a future amendment when a domain warrants separate ownership.
- Generalizing consumer skills across domains — consumers stay domain-specific by design.
