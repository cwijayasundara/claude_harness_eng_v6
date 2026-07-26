# `tools/` — maintenance tooling for this repo as a harness project

Operator CLIs for maintaining the harness itself. **Nothing here ships, and nothing here
is a control.**

That makes `tools/` a third top-level location alongside `.claude/` and `test/`, which
needs justifying — the harness is supposed to be shrinking, not sprouting directories.
The rule is:

| Location | Holds | Ships to a scaffolded project? |
|---|---|---|
| `.claude/` | the harness — skills, agents, hooks, scripts | yes, composed by profile |
| `test/` | everything that verifies the repo | no |
| `tools/` | CLIs for maintaining the partition + control inventory | **no** |

## Why these can't live in `.claude/`

They'd be inert there, and they'd trip the harness's own rules:

- **Their inputs don't exist in a scaffolded repo.** `overlap-candidates.js` reads
  `harness-manifest.json`, which `scaffold-copy.js` never writes. There is no control
  registry in a product repo to cluster.
- **They partition *harness units*, not product code.** A scaffolded project receives one
  already-composed profile (`core`/`brownfield`/`full`). It has no kernel-vs-pack split
  of its own left to check.
- **`pack-install.js` would have to declare itself.** Its own `undeclaredUnits()` check
  walks `.claude/`'s accounted dirs and flags any file no pack declares as shipping in no
  install. Moving these in means declaring them in the very partition they verify — and
  then either shipping dead weight into every SKU, or sitting permanently in that warning
  list.

## Why they aren't in `harness-manifest.json`

Registration is a *separate* decision from location: `control-budget-gate.js` counts ids
from the manifest, and `validate-harness-manifest.js` only enforces manifest→disk, never
disk→manifest. Nothing auto-registers by existing.

These stay unregistered because they gate no product change — they are operator support
for periodic harness maintenance. You do not add a control in order to remove controls.

## The tools

| Tool | Does |
|---|---|
| `check-partition.js` | Enforces the one structural rule of the v6 reduction: a kernel unit may not hard-reference a pack. Also reports **profile-breaking** cross-pack edges — an edge whose composed install would crash on a `require` it never shipped. `--strict` exits 1 on either. |
| `partition-report.js` | The report + profile-closure analysis, split out so `check-partition` stays a pure rule engine. |
| `pack-install.js` | Materializes a lean install: kernel plus only the packs you name. `--out <dir> [--packs a,b] [--list]`. |
| `overlap-candidates.js` | Ranked pre-pass for the same-invariant de-dup audit — see `DEDUP-AUDIT.md`. Ranks, never filters; everything unclustered lands in a `residual` bucket so "not clustered" can't read as "certified overlap-free". |

## Tests

Tests for these live in `test/`, not next to the source — matching the ~300 other test
files in this repo, all of which test code that lives elsewhere. They run in `npm test`
via the ordinary `test/*.test.js` glob.

`check-partition.js --strict` is not merely runnable by hand: `test/pack-install-smoke.test.js`
asserts it exits 0 (and that it loaded a real number of units, so a checker that silently
read nothing can't pass vacuously). A regression in the partition fails the suite.
