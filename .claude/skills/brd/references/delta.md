## Delta Mode (`--delta`)

> Invoked by `/sprint` for sprint N (N >= 2). Grounds a new PRD against the
> **prior sprint's approved requirement spine**, not against nothing — this is
> what proves the new PRD's requirements are new/changed/carried, and flags
> anything it silently drops. See
> `docs/archive/superpowers/specs/2026-07-04-sprint-delta-lane-design.md`.

### Step Δ0 — Locate the prior spine and resolve N

List `specs/brd/sprint-*/` directories; let `prev` be the highest number found.
If none exist, the prior spine is the flat legacy `specs/brd/brd-requirements.json`
(sprint 1 predates sprint-numbered directories) and `N = 2`. If sprint
directories exist, `N = prev + 1`. If neither the flat file nor any sprint
directory exists, halt — `--delta` requires a prior sprint; use `--frd`/`--prd`
for the very first sprint.

### Step Δ1 — Run Steps 0.0 through 4 unchanged, writing to `specs/brd/sprint-N/`

Run the FRD-grounded flow. Default is lean adopt (`references/prd-lean.md`)
with `--out-dir specs/brd/sprint-N`. Pass `--full` only when the user did.
Adoption **does** run in delta mode — the new sprint PRD is a source document
like any other — so pass `--out-dir specs/brd/sprint-N` so the adopted files
land where Step Δ2's trace-check reads them. `--root` alone cannot express this: it
prefixes `specs/brd/` again, and without `--out-dir` adoption would overwrite
sprint 1's approved flat spine, after which Δ2 compares sprint N against itself
and passes vacuously with 0 dropped.

One change throughout: every output path becomes
`specs/brd/sprint-N/` (e.g. `specs/brd/sprint-N/brd.md`,
`specs/brd/sprint-N/brd-requirements.json`, `specs/brd/sprint-N/clarification-log.json`).
When writing `brd-requirements.json`, any requirement that carries forward a
prior-sprint requirement unchanged (or with only minor edits) must include
that prior sprint's BR id in its `traces` array alongside this sprint's own
FRD/clarification traces — this is what lets Step Δ2's classification tell
"carried forward" apart from "silently dropped."

### Step Δ2 — Requirements-delta classification [HARD BLOCK]

Step 4.4's grounding gate still runs unchanged (this sprint's BRD vs this
sprint's own FRD/PRD spine). In addition, classify this sprint's spine against
the **prior sprint's** spine — the same `trace-check.js` engine, reused with
the prior spine as `required`, this sprint's spine also as a valid trace
target (`optional`), and this sprint's spine as `downstream`:

```bash
node .claude/scripts/trace-check.js \
  --required specs/brd/sprint-{prev}/brd-requirements.json \
  --optional specs/brd/sprint-N/brd-requirements.json \
  --downstream specs/brd/sprint-N/brd-requirements.json \
  --layer requirements-delta \
  --out specs/brd/sprint-N/requirements-delta.json
```

(When `prev` refers to the flat legacy layout, use `--required specs/brd/brd-requirements.json`.)

Read the resulting `requirements-delta.json`:
- `net_new` entries are genuinely new requirements this sprint introduces — expected, not a failure.
- `dropped` entries are prior-sprint requirements this sprint's spine does not cover — **each one needs an explicit human decision**: still active (add a BR entry carrying it forward) or intentionally retired (record why in this sprint's BRD Open Questions). A `dropped` entry with no such resolution is a silent regression — halt and ask before proceeding to Step 4.5.

**Empty-spine guard:** a `required_total: 0` here means the prior sprint's
spine is empty — a pre-spine legacy project. Skip this step in that case and
note it in the BRD summary (Step 4.4's own grounding gate still runs
normally against this sprint's spine).

### Step Δ3 — Present for Human Approval (delta mode)

Same as Step 5, plus display the requirements-delta classification (new /
changed / carried / dropped, with the human's resolution for each dropped
item) before asking for approval.

**Name the sprint paths on the receipt, not the flat ones.** Step 5's artifact
list is `specs/brd/brd.md` etc., which for sprint N are sprint 1's files — they
exist, so `plan-approval` would happily digest them and the receipt would go on
matching while this sprint's BRD changed underneath it. Pass
`specs/brd/sprint-N/brd.md`, `sprint-N/brd-requirements.json` and
`sprint-N/clarification-log.json` explicitly. The digest-voids-on-change
property is the whole point of the receipt.

---

