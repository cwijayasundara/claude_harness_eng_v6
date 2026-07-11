# Z/L Continuum — Team Routing Rubric

**One page. Use before every agent-assisted PR.**

You are not Team Z or Team L. **Each task** sits somewhere on the continuum.  
Placing the task correctly is the skill. Mis-placement is the failure mode.

| Pole | Meaning | Failure mode |
|------|---------|--------------|
| **L (Lopopolo)** | Code is cheap; agents generate; verification is the product | Agent psychosis — ship unread diffs, illegible repo, “Christmas tree” uptime |
| **Z (Zechner)** | Read every line on critical paths; slow down | Artisanal drag — humans type/re-read work that tests + harness already prove |

Source framing: [Volkov Z/L talk](https://www.youtube.com/watch?v=ZpK5PWX2YRM) · [essay](https://thursdai.news/zl) · Meijer: *place per task, not per identity*.

---

## 1. Place the task (60 seconds)

Score each axis **0 (L-friendly) → 2 (Z-required)**. Sum = placement.

| Axis | 0 — lean L | 1 — mixed | 2 — hard Z |
|------|------------|-----------|------------|
| **Blast radius** | Leaf / internal / reversible | Cross-module, rollback easy | Auth, money, PII, migrations, public API, irreversible data |
| **Observability of “done”** | Automated tests/evals catch failure | Partial tests; manual smoke | Hard to verify; silent wrongness possible |
| **Longevity** | Spike, throwaway, single-owner toy | Product code, multi-sprint | Multi-year shared core; others depend on shape |
| **Coverage of touched symbols** | COVERED / new fully-tested unit | Mixed / pinnable | UNCOVERED god-file, no clean seam |
| **Team / ownership** | Solo + you own the pager | Pair or clear owner | Multi-team shared surface |

| Sum | Band | Human line-reading | Default harness lane |
|-----|------|--------------------|----------------------|
| **0–2** | **L** | Optional skim of walkthrough only | `/vibe` (if ≤3 files, &lt;150 LOC, no risk axes at 2) or disposable artifact lane |
| **3–5** | **M (middle)** | Read public contracts + high-churn hunks; trust green gate for the rest | `/change` or `/refactor`; `/feature` routes here |
| **6–10** | **Z** | Read every production line that can fail closed wrong; independent whole-branch review | `/change` / `/spec`→`/design`→`/auto` + full `/gate`; security path when boundary fires |

**Hard overrides (any one → at least M; listed ones → Z):**

- Auth, secrets, payments, uploads, SSRF/proxy, schema/migrations → **Z** + security trigger  
- New public API or OpenAPI breaking surface → **Z**  
- UNCOVERED production symbol you must edit → **not L**; pin or sprout before edit (`checking-coverage-before-change`)  
- Ambiguous requirements after ≤3 clarifications → escalate lane, do not vibe  
- Disposable mockup / ARB doc / research only → **outside Z/L shipping** (harness-lite / `frontend-design` / `/design --doc-only`)

---

## 2. Match verification to the band

| Band | Agent may | Human must | Harness minimum |
|------|-----------|------------|-----------------|
| **L** | Generate + merge-candidate with micro-contract | Confirm scope + verification output; no rubber-stamp on red | Micro-contract · targeted test · `local-regression-gate` · hooks |
| **M** | Implement against story/contract | Own acceptance criteria; read walkthrough + quality card; sample critical hunks | Story · tests first · evaluator · code-reviewer · `/gate` |
| **Z** | Draft only until contracts green | Line-read production risk surface; challenge architecture; refuse “LGTM from CI alone” | Full gate · security when triggered · regression-suite-full · walkthrough · quality card · whole-branch review before merge |

**Never:** “models got better so we skip `/gate`.” Ceremony can trim (`execution.ceremony`); **evaluator + deterministic gates never trim.**

---

## 3. Map to this repo’s lanes

```
Place task (Z/L score) ──► pick lane ──► prove ──► human trust surfaces ──► merge
```

| Placement | Command | Stop / escalate if |
|-----------|---------|-------------------|
| L, tiny safe | `/vibe` | &gt;3 files, auth/API/migration, UNCOVERED edit, unverifiable |
| M, single behavior | `/change` (+ `--issue N`) | Becomes multi-story epic |
| M/Z, structure only | `/refactor` | Behavior creeps into the same commit |
| M/Z, existing product request | `/feature "<…>"` | Needs full greenfield PRD |
| Z or multi-story | `/spec` → `/design` → `/auto` or `/build` | — |
| Pre-merge always | `/gate` | Any BLOCK remains |

Brownfield first when the map is stale: `/brownfield` (optional `--seams`). Context-first: `nav-query` / `/context` before reading whole god files.

---

## 4. PR checklist (paste into description)

```markdown
### Z/L placement
- Score: __ / 10  → band: L / M / Z
- Axes at 2: (list or "none")
- Lane: /vibe | /change | /refactor | /feature | /auto | other
- Verification: (commands + pass/fail)
- Human read plan: walkthrough only | contracts+hunks | every risk line
- Mis-place backpaddle: what would make us re-band mid-work?
```

Gate receipts humans actually use:

- `specs/reviews/walkthrough.md` — 5-minute review script  
- `specs/reviews/quality-card.md` — pass/fail aggregation  
- `docs/CODEBASE.md` — human homepage (regenerate via `npm run human-codebase`)

---

## 5. Team anti-patterns (name them in review)

| Smell | What’s wrong | Fix |
|-------|--------------|-----|
| **Identity L** | “We’re a vibe team” for every PR | Re-score this task |
| **Identity Z** | Senior re-types agent output for leaf copy | Drop to L; keep attention for Z work |
| **Rubber stamp** | Approve 2k-line agent PR on green CI only | Require walkthrough + band-appropriate read |
| **Invisible debt** | Agent adds silent fallbacks / unused compat | Treat as Z-class smell; reject |
| **No backpaddle** | Mid-PR discover auth touch, keep vibe process | Stop; re-band; escalate lane |
| **FOMAT** | Ship unreviewed because “Lopopolo did 1M LOC” | Their harness ≠ yours; match *your* verification |

---

## 6. Backpaddle rule

Placing too far **Z** wastes time (boring, recoverable).  
Placing too far **L** wrecks the codebase (slippery).

As soon as evidence appears (security path, missing tests, god-file edit, prod incident class):

1. Freeze merges on the branch.  
2. Re-score.  
3. Escalate lane and verification.  
4. Do not “finish the vibe” to avoid embarrassment.

---

## 7. What this harness optimizes for

Not “stop reading code” or “always read code” — **route attention**:

- Agents generate under contracts and ratchets.  
- Machines verify what is cheap to verify.  
- Humans spend scarce review budget where wrongness is expensive.  
- Independent whole-branch review remains load-bearing for non-trivial work (CLAUDE.md §5).

If the team only remembers one line:

> **Place the task. Match the loop. Read what the loop cannot prove.**
