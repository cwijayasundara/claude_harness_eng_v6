# PE Fund Waterfall DSL — Semantic Model (Phase 1 Co-Design)

**Date:** 2026-07-16
**Goal:** Define the semantic model for the first domain DSL pack — the PE fund distribution waterfall — as the Phase 1 co-design deliverable called for by `2026-07-16-pe-dsl-pluggable-domain-packs-design.md`. This document fixes the grammar, intermediate representation, validation rules, domain error phrasings, reference-calculator scope, and vocabulary. It is a design artifact only (disposable-artifact lane); no product code is written here. The implementation plan follows via the writing-plans skill.

## Relationship to the pluggable-DSL design

This is the concrete Phase 1 output of the sequencing in `2026-07-16-pe-dsl-pluggable-domain-packs-design.md`: build the waterfall pack **concretely first**, extract the shared engine only once a second pack forces its shape. Everything here therefore describes *one pack* — `dsl-packs/private-equity/waterfall/` — implementing the `pack.js` contract (`meta`, `schema`, `validate()`, `terms()`, `examples`) plus a reference calculator. The engine, discovery, registry wiring, and the generic `dsl-conformance` sensor are **out of scope** for this pack and deferred to the extraction phase.

## Grounding: what the official financial-services materials do and do not provide

Per the user's direction to adopt Anthropic's financial-services vocabulary, the installed `claude-for-financial-services` plugins were mined (`returns-analysis`, `lbo-model`, `nav-tieout`, `unit-economics`). Honest finding, which shapes this design:

**None of these materials model an LP/GP distribution waterfall.** The word "waterfall" appears but denotes three unrelated concepts: a returns-attribution bridge (`returns-analysis`), a debt-tranche cash-sweep priority (`lbo-model`), and a P&L margin bridge (`unit-economics`). There is no tier logic, no hurdle math, no catch-up, and no clawback formula anywhere in the corpus. `preferred return`, `hurdle`, `GP catch-up`, `clawback`, `European`/`American`, and `DPI`/`TVPI`/`RVPI` are entirely absent.

Consequence — "adopt their terms" resolves to a precise split, not a mirror:

- **Adopted verbatim (in-corpus):** `carried interest` / `carry` (never "promote"), `crystallized`, `contributions` / `capital calls`, `distributions (cash + in-kind)`, `commitment %`, `unfunded`, `recallable`, `MOIC`, `IRR` / `XIRR`, `cash-on-cash`, `NAV` / `capital account`, `gross vs net of fees/carry`.
- **Standard PE terminology (absent from corpus — this pack builds the missing layer):** `return of capital`, `preferred return`, `GP catch-up`, `clawback`, `European` / `American` (whole-fund / deal-by-deal), the tier ordering itself, `soft` / `hard` hurdle, and `DPI` / `TVPI` / `RVPI`.

**Anchor to an official skill:** `nav-tieout` supplies the one piece of genuine distribution accounting — the LP capital-account identity. The reference calculator's per-LP output MUST reconcile to it, so the DSL's carry line is the same quantity as `nav-tieout`'s "− Carried interest allocation" line:

```
Beginning capital + Contributions − Distributions + Allocated net income − Carried interest allocation (if crystallized) = Ending capital
```

## Locked scope (Phase 1 co-design decisions)

| Dimension | Decision |
|---|---|
| Nature | Declarative surface is the primary artifact; compiles to a pure IR. A reference calculator ships alongside for golden numbers, not as the primary artifact. |
| Structures (surface + `validate()`) | European **and** American; partial GP catch-up; multi-tier carried interest; clawback. |
| Reference calculator | Computes **both** European (static) and American (path-dependent, per-deal, with clawback). |
| Hurdle treatment | `soft` (with catch-up) **and** `hard` (carry on excess above hurdle only, no catch-up). No no-hurdle path. |
| Model shape | Approach A — explicit typed tier list + small typed header. |
| Multi-tier carry gate | **MOIC** threshold. |
| Metrics | `IRR` (gross & net), `MOIC`, `cash-on-cash`, `carried interest $`, `NAV`/ending capital, **plus** `DPI`, `TVPI`, `RVPI`. |

## 1. Surface grammar

A typed header declares fund-wide treatment; the body is an ordered list of typed tiers.

```yaml
waterfall:
  fund: Fund IV
  mode: european            # european (whole-fund) | american (deal-by-deal)
  hurdle: soft              # soft (with catch-up) | hard (carry on excess above hurdle only)
  clawback: false           # optional; defaults true when mode = american
tiers:
  - { tier: return_of_capital, to: lp, basis: contributed_capital }
  - { tier: preferred_return,  to: lp, rate: 0.08, compounding: annual }
  - { tier: gp_catchup,        to: gp, rate: 1.00, target_carry: 0.20 }   # rate 1.0 = full; 0.5 = 50/50
  - { tier: carried_interest,  split: { gp: 0.20, lp: 0.80 } }
```

**Header fields**

| Field | Type | Notes |
|---|---|---|
| `fund` | string | Free label. |
| `mode` | enum `european` \| `american` | Whole-fund vs deal-by-deal carry crystallization. |
| `hurdle` | enum `soft` \| `hard` | `soft` ⇒ pref + catch-up; `hard` ⇒ carry only on profit above the pref, no catch-up. |
| `clawback` | bool | Optional. Defaults `true` when `mode: american`, `false` when `european`. |

**Tier types** (discriminated union on `tier`)

| `tier` | Fields | Meaning |
|---|---|---|
| `return_of_capital` | `to: lp`, `basis: contributed_capital \| contributed_plus_fees` | Return LP capital before any profit split. |
| `preferred_return` | `to: lp`, `rate` (fraction), `compounding: annual \| quarterly`, `basis` | LP preferred return accrued on the basis. |
| `gp_catchup` | `to: gp`, `rate` (0–1; `1.0` = full/100%, `0.5` = 50/50 partial), `target_carry` (0–1) | GP catches up toward `target_carry`. Present only under `hurdle: soft`. |
| `carried_interest` | `split: { gp, lp }`, `above` (MOIC threshold, optional) | Profit split. The **base** tier omits `above` (applies from the catch-up upward); higher tiers carry strictly ascending `above:` MOIC gates, expressing multi-tier carry (e.g. 20% up to 2.0x, then 25%). |

## 2. Intermediate representation

The compiler normalizes the surface into a **pure-data IR** — no behavior, just resolved values — that both `validate()` and the calculator consume (neither touches raw YAML):

```js
{
  mode: 'european' | 'american',
  hurdle: 'soft' | 'hard',
  clawback: boolean,
  tiers: [
    { op: 'roc',     to: 'lp', basis },
    { op: 'pref',    rate, compounding, basis },
    { op: 'catchup', gpRate, targetCarry },              // omitted under hard hurdle
    { op: 'carry',   gpSplit, lpSplit, aboveMoic }       // one per carried_interest tier
  ]
}
```

Defaults are resolved during compile (e.g. `clawback` from `mode`; `basis` defaults). This realizes the pluggable design's "thin declarative surface → pure intermediate representation."

## 3. Validation rules

Layer 1 (JSON Schema, in `schema`) gates structural shape — required fields, enums, number ranges, the tier discriminated union. Layer 2 (`validate()`, over the IR) gates domain semantics — the rules below make malformed waterfalls fail to compile, in domain terms.

| # | Rule | Severity |
|---|------|----------|
| R1 | Canonical tier order: `return_of_capital` → `preferred_return` → `gp_catchup` → `carried_interest`. Any tier out of order fails. | error |
| R2 | `gp_catchup.target_carry` equals the **base** `carried_interest` tier's `split.gp` (the first / lowest-MOIC-gate tier — the rate the GP catches up to). | error |
| R3 | Hurdle coherence: `hurdle: soft` requires **both** a `preferred_return` and a `gp_catchup` tier; `hurdle: hard` **forbids** a `gp_catchup` tier (carry applies only above the pref). | error |
| R4 | Every `carried_interest.split` sums to `1.0` (`gp + lp`). | error |
| R5 | For multiple `carried_interest` tiers, `above:` MOIC gates are strictly ascending. | error |
| R6 | Rate sanity: `preferred_return.rate` ∈ (0, 0.5); `carried_interest.split.gp` ∈ (0, 1); `gp_catchup.rate` ∈ (0, 1]. Carry gp-share > 0.30 is unusual. | error (range) / warn (>0.30) |
| R7 | `mode: american` without `clawback: true` — deal-by-deal distributions can over-pay the GP on early winners. | warn |
| R8 | A `return_of_capital` tier is present and is tier 1. | error |

## 4. Domain error phrasings

`validate()` must phrase findings at the domain level — this is the fuel for agent self-correction (raw schema errors defeat the purpose). Representative messages:

```
✗ R1: Tier 4 (carried_interest) precedes gp_catchup — carry cannot be split before the catch-up tier resolves.
✗ R2: gp_catchup.target_carry (20%) ≠ carried_interest gp split (25%) — the GP would catch up to a carry it never earns. Set them equal.
✗ R3: hurdle: hard declares a gp_catchup tier — a hard hurdle pays carry only on profit above the preferred return and admits no catch-up. Remove the catch-up tier or switch to hurdle: soft.
✗ R3: hurdle: soft is missing a gp_catchup tier — a soft hurdle requires the GP to catch up after the preferred return.
✗ R4: carried_interest split sums to 0.95, not 1.0.
✗ R5: multi-tier carry hurdles are not ascending — tier gated at 2.5x precedes tier gated at 2.0x.
⚠ R7: mode: american without a clawback provision — declare clawback: true or confirm intentional.
```

## 5. Reference calculator

`compute(ir, cashflows) → metrics`. Cash flows are a **runtime input, not part of `waterfall.pe.yaml`** — the structure is authored once; cash flows vary per scenario. Examples bundle a cash-flow fixture alongside the structure to produce golden numbers.

**Inputs**

- **European:** fund-level aggregate — total contributed capital and a dated distribution/proceeds series (dated for IRR).
- **American:** per-deal — for each holding, its dated contributions and realizations, so carry can crystallize per deal.
- **Both:** management fee / fund expenses (to compute net), LP commitment % (for per-LP capital accounts).

**Algorithm**

- **European (static fold):** allocate total proceeds through the tier sequence — return of capital, then accrued preferred return, then (soft only) GP catch-up to `target_carry`, then the carry split; multi-tier carry applies each `above:` MOIC gate.
- **American (path-dependent, per-deal loop):** process realizations in time order, crystallizing carry as each deal exits, maintaining a running **clawback reserve**; at fund end, if aggregate LP has not received return of capital + preferred return, claw back excess GP carry. **This is the highest-risk component of the pack and receives the heaviest golden-scenario test coverage.**

**Reconciliation:** per-LP output reconciles to the `nav-tieout` capital-account identity (above).

**Outputs:** `IRR` (gross & net), `MOIC`, `cash-on-cash`, `DPI`, `TVPI`, `RVPI`, `carried interest $` (per crystallized tier), `NAV` / LP ending capital.

## 6. `terms()` emission

`terms()` emits the canonical vocabulary into the flat `CONTEXT.md` `## Terms` section as individual `### <Term>` entries (never `###`-grouped headings — `vocabulary-check.js` treats every `###` as a term), one-line definition each:

- **Adopted verbatim:** carried interest, crystallized, contributions / capital calls, distributions (cash + in-kind), commitment %, unfunded, recallable, MOIC, IRR / XIRR, cash-on-cash, NAV / capital account, gross vs net of fees/carry.
- **Built layer:** return of capital, preferred return, GP catch-up, clawback, European (whole-fund), American (deal-by-deal), soft hurdle, hard hurdle, DPI, TVPI, RVPI.

Per the pluggable-DSL design, this **emits into** the flat glossary; it does not replace `vocabulary-check.js` or become the source it reads.

## 7. Consumers and example corpus

- **Consumers:** `private-equity:returns`, `private-equity:lbo`, and `pe-ic-memo` read `waterfall.pe.yaml` if present and treat it as authoritative for carry mechanics — one validated structure the LBO model and the IC memo cannot disagree on.
- **Example corpus** (`examples/`), ≥1 per structural axis, each bundling a cash-flow fixture and golden output numbers **round-tripped through the real calculator** (never hand-built fixtures — CLAUDE.md principle #5):
  - European, soft hurdle, full catch-up, single-rate carry
  - European, hard hurdle, no catch-up
  - American, soft hurdle, with clawback
  - Multi-tier carried interest (MOIC-gated)
  - Partial GP catch-up

## Tests

- **Round-trip the real validator and calculator:** feed real `waterfall.pe.yaml` instances through the real `validate()` and `compute()`; assert each documented domain error (R1–R8) fires on a correspondingly malformed instance, and each example's computed metrics match its golden numbers.
- **American/clawback golden scenarios:** a dedicated set of hand-checked deal-by-deal cash-flow scenarios (early-winner clawback, staged realizations, full loss) with expected LP/GP splits.
- **`nav-tieout` reconciliation:** assert per-LP output satisfies the capital-account identity.
- **`terms()` emission:** assert emitted terms pass `vocabulary-check.js` unchanged.

## Out of scope (this pack / Phase 1)

- The shared DSL engine, discovery, `scaffold-packs.json#dsls` wiring, and the generic `dsl-conformance` sensor — deferred to the extraction phase per the pluggable-DSL design (rule of three).
- `hurdle: none` (no-preferred, carry-from-dollar-one) — explicitly dropped; not in the deal book.
- IRR-gated multi-tier carry — gates are MOIC only in v1.
- Management-fee / fee-offset *modeling* beyond the net-of-fees input the calculator consumes.
- Any change to `vocabulary-check.js`'s flat-`CONTEXT.md`, exact-match matcher.
