# Proposal: Bun-inspired adversarial review and mechanical loops

**Date:** 2026-07-12  
**Status:** Design proposal — **Phase A** `2.2.0` · **Phase B** `2.3.0` · **Phase C** `2.4.0` implemented (product line remains `claude_harness_eng_v5`; not a v6 reboot). Fuzz→PR and cgroup isolation remain out of core ([bun-phase-c-out-of-core.md](./bun-phase-c-out-of-core.md)). Disposable analysis artifact (not run through the SDLC / GAN pipeline).  
**Versioning decision:** Ship as **minors** (`2.2.0`–`2.4.0`). Defaults stay backward-compatible. Bump to **3.0.0** only if defaults flip to always-adversarial or public verdict contracts break. Rename product to **v6** only for a deliberate SKU/plugin-namespace reboot — not for these controls.  
**Trigger:** [Rewriting Bun in Rust](https://bun.com/blog/bun-in-rust) (Jarred Sumner, 2026-07-08) — a large LLM-assisted mechanical port that used prep artifacts, canaries, multi-agent adversarial review, tool-error work queues, and process edits when agents misbehaved.  
**Related (already shipped from the same case study):**  
- **G31** — zero tests skipped/deleted (`test-deletion-gate.js`)  
- **G32** — canary-first mechanical rollout on `/refactor` and `upgrading-dependencies`  
**Related (control-system baseline):** `HARNESS.md`, `docs/internal/HARNESS_ENGINEERING_GAP_ANALYSIS.md`, Devin-parity dual/majority re-verify on `/gate` security boundary (2026-07-09).

---

## 0. TL;DR

Bun’s rewrite did not succeed by “prompting Claude harder.” It succeeded by treating large agent work as **loops**:

```text
prep map → canary → implement → ≥2 adversarial reviewers (fresh context) → fixer
         → tool diagnostics as a work queue → when agents fail, edit the process
```

This harness already has the control-system skeleton (generator ≠ evaluator, fresh-context `code-reviewer`, sprint contracts, learned rules, G31/G32). What is **not** yet first-class:

1. **Default large-diff path is one reviewer**, not Bun’s 1 implementer · 2 adversarial · 1 fixer.
2. **No mechanical mapping artifact** (`PORTING.md` / `LIFETIMES.tsv` shape) for bulk transforms.
3. **No diagnostics-as-work-queue** loop (tsc/ruff/mypy errors sharded and fixed in parallel).
4. **Process-fix** is weaker than code-fix (we learn code rules; we rarely ban a workflow anti-pattern).
5. **Multi-agent git hygiene** is soft guidance, not a hard deny list.

**Proposed fix in three phases:**

| Phase | Name | Ships |
|-------|------|--------|
| **A** | Inner-loop hardening | Dual adversarial review (tiered), anti-stub Iron Law, git deny list, process-rules path |
| **B** | Mechanical mass work | Error-queue fixer, canary generalization, optional migrate/mapping prep |
| **C** | Optional / demand-driven | Semantic-divergence checklist, workflow exemplars, fuzz→PR (not core) |

**Do not** copy Bun’s scale (64 Claudes × 11 days) or empty dynamic workflows that re-wrap existing skills. **Do** copy the *control ideas* and wire them into `/implement`, `/auto`, `/change`, `/gate`, and (later) a migrate prep lane.

**Success metric (Phase A):** on a large-diff fixture that “compiles clean” but is wrong, dual independent `code-reviewer` instances (or an equivalent adversarial pair) surface at least one BLOCK that a single pass historically missed; stub-to-green and destructive git patterns are hard-blocked or reviewer-BLOCK with tests.

---

## 1. Source practices (Bun) → harness vocabulary

| # | Bun practice | Harness translation |
|---|--------------|---------------------|
| B1 | Prep before bulk codegen (`PORTING.md`, `LIFETIMES.tsv`) | Feedforward **mapping guide** under `specs/migrate/` (Phase B) |
| B2 | Trial 3 files before all N | Already **G32**; generalize canary triggers (Phase B) |
| B3 | 1 implementer · ≥2 adversarial reviewers · 1 fixer | Tiered dual `code-reviewer` + existing generator fixer (Phase A) |
| B4 | Fix the *process*, not only the code | Typed **process rules** + deny hooks (Phase A) |
| B5 | Compiler errors as work queue | Diagnostics → `errors.jsonl` → shard → fix loops (Phase B) |
| B6 | Parallel isolation (worktrees, no destructive git) | Pre-bash deny + teammate prompt rules (Phase A); worktree already optional |
| B7 | Anti-stub / “paragraph comment ⇒ wrong code” | `code-reviewer` Iron Law + optional stub-smell gate (Phase A) |
| B8 | Language-independent test oracle | Already strong (AT-first, sprint contracts, regression gates) — protect |
| B9 | Smoke ladder (compile → CLI → suite → CI) | Resume-smoke (G14) + evaluator; error-queue ends in same ladder |
| B10 | Human monitors loops; merge only when oracles green | Keep human merge ownership; improve process-rules for self-correction |
| B11 | Post-merge fuzz → PR | Out of core scope (Phase C optional vertical) |

### Already shipped (do not re-open)

| Gap | What it encodes from Bun |
|-----|--------------------------|
| **G31** | “0 tests skipped or deleted” through a mass mechanical change |
| **G32** | Canary 3-file trial before full mechanical fan-out on refactor/deps |

---

## 2. Current state (grounded)

| Piece | Path | Today | Bun gap? |
|-------|------|--------|----------|
| Fresh-context review | `.claude/agents/code-reviewer.md` | Diff + touched files; no builder conversation; structure + correctness lenses | **One** instance by default |
| Security adversarial | `.claude/agents/security-reviewer.md` | Find-then-refute before BLOCK | Self-refute, not second agent |
| Majority re-verify | `/gate` security-boundary | 3× evaluator + 3× security-reviewer, majority vote | Only when security trigger fires |
| Implement review | `.claude/skills/implement/SKILL.md` Step 7 | Spawn **one** `code-reviewer`; max 3 fix cycles | Missing second independent reviewer |
| Auto Gate 8 | `auto/references/section-5-5-…` | Single fresh-context code-reviewer | Same |
| Generator / teams | `generator.md`, `/auto` SECTION 4 | Parallel teammates by story ownership | No hard git deny list |
| Learned rules | `.claude/state/learned-rules.md` | Monotonic **code** rules from repeated failures | Weak **process** learning |
| Canary | `/refactor`, `upgrading-dependencies` | G32 prompt-only, >~10 files | Not on implement/feature/migrate |
| Test deletion | `test-deletion-gate.js` | G31 commit gate | Done |
| Dynamic workflows | `.claude/workflows/` | Empty slot by design (skill clones removed) | Right place for error-queue *if* not a skill duplicate |
| Worktrees | `/auto --worktree` | Optional isolation | Good substrate for Phase B shards |
| Contracts / AT / regression | evaluator, G15/G16, G20/G23 | Behaviour oracle independent of impl language | Strength — keep as merge bar |

---

## 3. Goals and non-goals

### Goals

1. Make **adversarial multi-review** a first-class, **cost-tiered** control for large/high-risk diffs.
2. Make **stub-to-green** and **justification-comment workarounds** explicit BLOCKs.
3. Make **destructive multi-agent git** a hard deny during implement/auto fan-out.
4. Give repeated *workflow* failures a durable **process-rules** path (edit the harness, not only the tree).
5. (Phase B) Support **mass mechanical** work with prep maps, error queues, and generalized canaries — without inventing a second SDLC.

### Non-goals

- Rewriting the product surface (`/build`, `/feature`, `/gate` stay primary).
- Always-on dual review for every `/vibe` or one-line fix (cost explosion).
- Shipping Bun-scale concurrency (dozens of agents for days) as default product behaviour.
- Re-adding weak `/harness-*` workflows that duplicate `/evaluate` / `/gate` / `/implement`.
- Core-scaffold continuous fuzzing / cgroup isolation (Bun-specific ops).
- Replacing G31/G32 or weakening the behaviour oracle to “looks green in the implementer context.”

### Design principles

1. **Prefer sensors + skill wiring** over new user-facing commands.
2. **Cost-gate** expensive patterns (`quality.sensor_tier`, file/line thresholds, security boundary).
3. **Reuse agents** — second `code-reviewer` instance, not a fourth judge role.
4. **Process edits must be testable** (wiring tests in the style of `test/canary-rollout-wiring.test.js`, `test/gate-reverify-wiring.test.js`).
5. **Register** new guides/sensors in `HARNESS.md` + `harness-manifest.json` so they join the control system, not rot.

---

## 4. Target control loops

### 4.1 Tiered adversarial review (Phase A core)

```text
                    implementer finishes story/group diff
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │  Review tier resolution       │
                    │  standard → 1 code-reviewer   │
                    │  adversarial → 2 instances    │
                    └───────────────┬───────────────┘
                                    │
              ┌─────────────────────┴─────────────────────┐
              ▼                                           ▼
     code-reviewer A                               code-reviewer B
     (fresh context)                               (fresh context)
     inputs: diff + AC + review-context pack only
              │                                           │
              └─────────────────────┬─────────────────────┘
                                    ▼
                    ┌───────────────────────────────┐
                    │  Merge policy (see §5.2)      │
                    │  BLOCKs → fixer (generator /  │
                    │  responsible teammate)        │
                    │  max 3 cycles (unchanged)     │
                    └───────────────────────────────┘
```

**Invariant (Bun):** implementer does not review; reviewer does not implement.  
**Invariant (ours):** reviewer spawn prompts still **must not** include builder reasoning, progress logs, or “why we think this is fine.”

Security path unchanged: when the security boundary fires, keep **3-instance majority** on security (+ evaluator) at `/gate`. Dual `code-reviewer` is orthogonal (correctness/structure), not a substitute.

### 4.2 Process-rules path (Phase A)

```text
same workflow failure class ≥ 2 times
        │
        ▼
extract process rule (not only code rule)
        │
        ▼
.claude/state/process-rules.md   (or typed section of learned-rules)
        │
        ▼
inject into orchestrator + implement/teammate templates
        + optional pre-bash / pre-write enforcement when rule is mechanical
```

Examples of process rules (from Bun false starts):

| Failure | Process rule |
|---------|----------------|
| Agents `git stash` / `reset --hard` during parallel work | Forbidden; pre-bash deny |
| Agents stub functions to clear compile errors | Stub markers → BLOCK |
| Agents add long comments justifying workarounds | Reviewer Iron Law |
| Agents run full-suite mid-shard during error-queue | Scope commands to owned files until shard green |

### 4.3 Diagnostics work queue (Phase B)

```text
tool_check (tsc | ruff | mypy | eslint | …)
        │
        ▼
.claude/state/diagnostics/errors.jsonl   # file, line, code, message, package
        │
        ▼
group by package/module → shards
        │
        ▼
per shard (optionally per worktree):
  1 fixer  +  2 reviewers (adversarial tier)
  no full-suite until shard complete
        │
        ▼
smoke ladder (project init / health) → impact-scoped or full suite
```

### 4.4 Mechanical migrate prep (Phase B, optional lane)

```text
human intent (port / framework swap / monorepo split)
        │
        ▼
specs/migrate/MAPPING.md     # pattern → pattern (adversarially reviewed)
specs/migrate/CONSTRAINTS.tsv  # optional structured constraints
        │
        ▼
canary: 3 files (G32 generalized)
        │
        ▼
fan-out under ownership map + dual review + behaviour oracle
```

This is a **feedforward guide** for bulk mechanical work, not a second BRD→spec pipeline. Disposable until the migrate is committed as the plan of record.

---

## 5. Detailed design — Phase A

### 5.1 When dual adversarial review fires

Resolve **review mode** at the start of the review step (`/implement` Step 7, `/auto` Gate 8, and optionally `/change` Step review):

| Condition (any) | Mode |
|-----------------|------|
| `project-manifest.json#quality.sensor_tier` is `strict` | `adversarial` |
| `project-manifest.json#review.adversarial` is `always` | `adversarial` |
| Changed production files ≥ `review.adversarial_min_files` (default **8**) | `adversarial` |
| Changed lines ≥ `review.adversarial_min_lines` (default **200**) | `adversarial` |
| Security-boundary trigger would fire (auth, secrets, persistence, API surface, …) | `adversarial` for code-reviewer *and* existing security path |
| `/vibe` micro-contract path | always `standard` (single reviewer) unless `review.adversarial: always` |
| Otherwise | `standard` (today’s single `code-reviewer`) |

**Manifest knobs (additive):**

```jsonc
// project-manifest.json (proposed)
{
  "quality": {
    "sensor_tier": "standard"   // minimal | standard | strict (existing)
  },
  "review": {
    "adversarial": "auto",              // auto | always | never
    "adversarial_min_files": 8,
    "adversarial_min_lines": 200,
    "block_merge_policy": "union"       // union | majority  — see §5.2
  }
}
```

Defaults: `adversarial: auto`, `block_merge_policy: union` (stricter; prefers catching silent bugs over minimizing fix cycles).

### 5.2 Merge policy for two reviewers

| Policy | Rule | Trade-off |
|--------|------|-----------|
| **`union` (recommended default)** | Any instance’s **BLOCK** is a gate BLOCK | More false positives, fewer silent bugs |
| **`majority`** | BLOCK only if **both** instances BLOCK the same issue class/file:line (or both set `pass: false`) | Fewer fix cycles; can miss single-instance catches |

**Implementation sketch:**

1. Spawn two `code-reviewer` agents with **identical inputs**, distinct output paths:
   - `specs/reviews/code-review-a.md` + `code-review-verdict-a.json`
   - `specs/reviews/code-review-b.md` + `code-review-verdict-b.json`
2. Run `node .claude/scripts/merge-review-verdicts.js` (new) →  
   `specs/reviews/code-review-verdict.json` + `code-review.md` (synthesized)  
   + `specs/reviews/adversarial-review-audit.json` (audit trail: both raw verdicts, policy, merged findings).
3. Existing consumers keep reading `code-review-verdict.json` only — **no API break**.

If one instance errors/times out: **fail safe to stricter** (treat as BLOCK / do not drop the surviving instance’s BLOCKs). Same spirit as `/gate` reverify fail-safe.

### 5.3 Spawn contract (Iron Law)

Every adversarial reviewer spawn prompt **MUST** include only:

- Diff range or changed file list  
- Acceptance criteria / sprint contract ids (if any)  
- `specs/reviews/review-context-pack.md` when present  
- Instruction to load `code-gen` + `learned-rules` + process-rules from disk  

**MUST NOT** include:

- Builder chain-of-thought or “we already verified X”  
- Full `claude-progress.txt` transcript  
- Teammate chat dumps  

Enforce with a wiring test that `/implement` and Gate 8 templates contain the forbid language (pattern already used for Gate 8).

### 5.4 Anti-stub and anti-workaround Iron Laws

#### Guide (feedforward)

Add to `.claude/skills/code-gen/SKILL.md` and `code-reviewer.md` **correctness** lens:

1. **No stub-to-green.** Production paths must not ship `todo!()`, `unimplemented!()`, `NotImplementedError` without handler, empty `pass`/`...` bodies, or “return null and hope” solely to clear compile/lint — unless the story *explicitly* defers with a tracked stub and tests document the deferral.
2. **Paragraph rule (Bun).** If a comment longer than ~3 lines (or a block comment paragraph) is required to justify a workaround, the code is wrong: **BLOCK**; fix the code, delete the apology comment.
3. **Phase placeholders.** Comments like “until Phase B wires the real value” with a magic constant that changes behaviour vs upstream → **BLOCK** on mechanical ports/refactors.

#### Sensor (optional computational, same phase if cheap)

`stub-smell-gate.js` (proposed): scan **staged production** files (not tests) for high-signal markers; **BLOCK** at commit during `/auto` and `/gate` when `sensor_tier` is `standard`+ and markers appear without an adjacent allow annotation (e.g. `// harness:stub-ok story=E1-S2`).

Degrade loudly if heuristics are language-incomplete; do not silently pass.

### 5.5 Multi-agent git safety

#### Prompt rules

Inject into generator + `/auto` SECTION 4 teammate templates:

```text
During parallel implement / error-queue shards you MUST NOT run:
  git stash, git stash pop, git reset --hard, git clean -fd, git push --force
You MAY: git add <paths you own>, git commit (message rules unchanged).
```

#### Pre-bash gate (computational)

Extend pre-bash-gate (or a dedicated `lib/git-safety.js`) to **deny** matching command lines when:

- `.claude/state/parallel-implement.lock` exists, **or**
- env `HARNESS_PARALLEL_AGENTS=1` set by orchestrator at team spawn, **or**
- always during `/auto` (stricter; preferred if false-positive rate is low)

Escape for humans: `HARNESS_GIT_SAFETY=off` (local only; document as waiver-class).

Wire tests: command fixtures assert deny/allow.

### 5.6 Process rules artifact

**Option A (minimal):** add a second top-level section to `learned-rules.md`:

```markdown
## Code rules
...

## Process rules
- Never run `git stash` during parallel implement (added 2026-… after …)
```

**Option B (cleaner separation):** `.claude/state/process-rules.md` monotonic file, injected only into orchestrator + implement paths (not every reviewer, unless the rule is review-facing).

**Recommendation:** **Option B** — keeps code-style rules and workflow rules from being conflated; mirrors “fix the process that generates the code.”

**When to write a process rule:**

- Same self-heal *category* fails 2+ times for reasons that are **agent behaviour**, not product logic (destructive git, stubbing, skipping canary, full-suite thrash).  
- Human or `review-on-stop` suggests a workflow constraint.  
- Orchestrator false-start during a migrate/error-queue run.

**Injection:** `/implement` Step 4, `/auto` teammate prompts, `/change` / `/vibe` if process rule scope is global.

---

## 6. Detailed design — Phase B

### 6.1 `fix-from-diagnostics` skill (or workflow)

**Name:** internal skill `fix-from-diagnostics` (preferred first). Promote to `.claude/workflows/fix-diagnostics.js` only if fan-out orchestration exceeds what a skill can express cleanly — avoid a weaker clone of `/implement`.

**Inputs:**

- Diagnostic command from `project-manifest.json#verification` (or toolchain detection)  
- Optional package root filter  

**Outputs:**

- `.claude/state/diagnostics/errors.jsonl`  
- `.claude/state/diagnostics/shards.json`  
- Per-shard fix commits  
- Final smoke + suite evidence  

**Algorithm:**

1. Run type/lint check once; parse to stable JSONL schema.  
2. Group by top-level package/module (configurable `diagnostics.group_by`).  
3. Cap concurrent shards (reuse pod concurrency knobs).  
4. Each shard: ownership-scoped edits only; adversarial review if shard diff crosses Phase A thresholds.  
5. Forbid full monorepo suite until all shards report clean diagnostics (Bun: no cargo mid-loop).  
6. Then resume-smoke + impact-scoped or full regression.

**Adapters (v1):** TypeScript `tsc --noEmit`, ESLint stylish/json, Ruff, Mypy.  
**Adapters (later):** rustc/cargo, golangci-lint — only when stack present.

### 6.2 Canary generalization (extends G32)

| Lane | Trigger | Canary |
|------|---------|--------|
| `/refactor`, deps | already G32 | 3 files when >~10 affected |
| `/implement` | plan is mechanical transform **or** group owns ≥10 files with repeated edit pattern | implement 1 story or 3 files first; green → rest |
| `/feature` epic | multi-story group | first ready story as canary story |
| migrate prep | always | 3-file canary after mapping approved |

Prompt + wiring tests; still no commit-time canary sensor (same judgment limit as G32).

### 6.3 Migrate mapping artifacts

**Paths:**

```text
specs/migrate/
  MAPPING.md          # human-readable pattern map
  CONSTRAINTS.tsv     # optional: symbol/field → lifetime/ownership/notes
  CANARY.md           # which files, outcomes
  README.md           # how agents must use the map
```

**Process:**

1. Draft mapping with planner/generator (doc-only discipline until canary).  
2. Dual adversarial review of **mapping only** (does it conflict? underspecified?).  
3. Human ack for high-risk ports (align with existing clarify/confidence gates).  
4. Canary → fan-out.  

**Not** a replacement for `/build` or `/sprint`. Use when the work is “faithful mechanical transform + oracle,” not greenfield product design.

---

## 7. Detailed design — Phase C (optional)

| Item | Notes |
|------|--------|
| Semantic-divergence checklist | Language-port hazards (assert macros with side effects, bounds in release, format/comptime differences). Checklist under `code-reviewer` or migrate skill only. |
| Commit subject attribution | `review: …` in subjects — nice-to-have; audit JSON already carries attribution. |
| Dynamic workflow exemplar | Document “monitor the loop, edit the workflow” using `fix-diagnostics` as the first real non-duplicate workflow. |
| Fuzz → auto-PR | Vertical only; not core SKU. |
| cgroup / resource isolation | Ops concern for stress tests; out of harness-core. |

---

## 8. Schemas

### 8.1 Merged code-review verdict (unchanged public shape)

Consumers continue to read:

```json
{
  "gate": "code-review",
  "pass": true,
  "range": "<base>..<head>",
  "summary": { "block": 0, "warn": 0, "info": 0 },
  "findings": [ /* … */ ]
}
```

### 8.2 Adversarial audit (new)

```json
{
  "schema_version": 1,
  "mode": "adversarial",
  "policy": "union",
  "instances": [
    { "id": "a", "verdict_path": "specs/reviews/code-review-verdict-a.json", "pass": false },
    { "id": "b", "verdict_path": "specs/reviews/code-review-verdict-b.json", "pass": true }
  ],
  "merged_pass": false,
  "merged_summary": { "block": 2, "warn": 1, "info": 0 },
  "timeouts": []
}
```

### 8.3 Diagnostics JSONL (new)

```json
{
  "tool": "tsc",
  "file": "src/orders/service.ts",
  "line": 42,
  "col": 11,
  "code": "TS2322",
  "message": "Type 'string' is not assignable to type 'number'",
  "package": "src/orders"
}
```

### 8.4 Process rule entry (new)

```markdown
### PR-2026-07-12-01 — no destructive git in parallel implement
- **Signal:** teammate ran `git reset --hard` during group C
- **Rule:** never run stash/reset --hard/clean -fd/force-push while parallel-implement lock is held
- **Enforcement:** pre-bash deny + teammate template
- **Added:** 2026-07-12
```

---

## 9. Wiring map (implementation checklist)

| Deliverable | Primary touch points | Test |
|-------------|----------------------|------|
| Review tier resolution | `implement/SKILL.md`, auto Gate 8, optional `change/SKILL.md` | `test/adversarial-review-wiring.test.js` |
| `merge-review-verdicts.js` | `.claude/scripts/`, scaffold-copy `CORE_SCRIPTS` | unit tests on union/majority/timeout |
| Anti-stub guide | `code-gen`, `code-reviewer` | wiring + optional fixture review |
| `stub-smell-gate.js` | pre-commit, `/gate` | unit + staged fixture |
| Git safety | pre-bash-gate, SECTION 4 templates | deny/allow fixtures |
| `process-rules.md` | implement Step 4, auto SECTION 4, design.md mention | injection wiring test |
| Error-queue skill | new skill + toolchain parsers | fixture diagnostics |
| Canary generalization | implement/feature skills | extend `canary-rollout-wiring.test.js` |
| Migrate templates | `specs/migrate/` templates in scaffold | copy-list completeness |
| Registry | `HARNESS.md`, `harness-manifest.json` | `validate-harness-manifest.js` |

**Scaffold-copy (G22):** every new script/skill referenced from skills must land in `CORE_SCRIPTS` / `CORE_SKILLS` or the completeness test fails — keep that invariant.

---

## 10. Cost and risk

| Risk | Mitigation |
|------|------------|
| Token cost of dual review | Tiered triggers; `review.adversarial: never` escape; default auto thresholds |
| Reviewer disagreement noise | Audit JSON; union policy documented; max 3 fix cycles unchanged |
| False positive stub gate | Allow annotation + tests-only exemption; warn-only under `minimal` tier |
| Git deny blocks legitimate recoveries | Escape env; deny only under parallel lock if needed |
| Error-queue infinite loop | Budget caps (existing wall-clock/agent/cost); max shards; escalate after N cycles |
| Process-rules bloat | Monotonic but reviewable; stop-hook suggests, human prunes between sessions only if safe |
| Complexity creep | Phase A alone is valuable; ship B only when a real mass-migrate demand appears |

---

## 11. Success metrics

### Phase A

| Metric | Pass criterion |
|--------|----------------|
| Dual-review wiring | Skill/auto templates resolve `adversarial` and spawn two instances when thresholds met |
| Silent-bug fixture | At least one “compiles clean / wrong semantics” fixture yields merged BLOCK under `union` |
| Stub / workaround | Reviewer or gate BLOCKs stub-to-green fixture |
| Git safety | Deny fixtures for stash/reset --hard; allow path-scoped commit |
| Process rules | After simulated 2× workflow failure, process rule file exists and is injected |
| Regression | G31, G32, gate reverify, scaffold-copy completeness, `npm test` green |

### Phase B

| Metric | Pass criterion |
|--------|----------------|
| Diagnostics parse | Fixture tsc/ruff logs → stable JSONL + shards |
| Queue loop | Shard fix reduces error count without full-suite between shards |
| Canary | Implement/feature skills document canary; wiring tests pass |
| Migrate | Mapping + dual review + 3-file canary path documented and scaffolded |

---

## 12. Rollout plan

```text
Phase A1  Anti-stub Iron Law + optional stub-smell-gate     (cheap, high signal)
Phase A2  Git safety deny + teammate prompt rules
Phase A3  Dual adversarial review + merge-review-verdicts   (core Bun practice)
Phase A4  process-rules.md path + injection + stop-hook hint
—— human checkpoint: measure token delta on 2–3 dogfood runs ——
Phase B1  fix-from-diagnostics (tsc/eslint/ruff/mypy)
Phase B2  Canary generalization (implement/feature)
Phase B3  specs/migrate templates + skill steps (on demand)
Phase C   Only with product demand
```

**Dogfood:** run Phase A against this monorepo’s own large-diff `/gate` path and one multi-file `/change` before enabling `strict` defaults for scaffolded projects.

**Defaults for scaffolded projects:** `review.adversarial: auto` with the thresholds above — no surprise always-on 2× review for tiny edits.

---

## 13. Open decisions (resolve before implementation)

| # | Decision | Options | Recommendation |
|---|----------|---------|----------------|
| D1 | BLOCK merge policy | `union` vs `majority` | **`union`** for v1; revisit if fix-cycle cost is high |
| D2 | Dual review on `/change` | always-threshold vs `/gate` only | **Same auto thresholds** as implement; keep `/vibe` single |
| D3 | Process rules storage | section of learned-rules vs separate file | **Separate `process-rules.md`** |
| D4 | Error-queue form | skill vs dynamic workflow | **Skill first**; workflow only if orchestration needs it |
| D5 | Migrate entrypoint | `/migrate` vs `/refactor --mechanical` | **`/refactor --mechanical` + `specs/migrate/`** unless usage proves a command is needed |
| D6 | Stub gate strength | reviewer-only vs commit gate | **Reviewer always; commit gate on standard+** |

---

## 14. What not to copy from Bun

| Bun choice | Why we skip or defer |
|------------|----------------------|
| 64 concurrent agents for 11 days | Budget/product reality; harness is multi-project SDLC, not one rewrite |
| “Everything at once” as default | Our brownfield spine prefers seams + canaries; all-at-once only for true mechanical ports with a strong oracle |
| Empty workflows re-wrapping skills | Already removed deliberately |
| Full fuzz farm in core | Optional vertical |
| Human 24/7 babysitting as the product | Prefer process-rules + budgets + `/status` |

---

## 15. Bottom line

Bun’s lesson is a **control-system** lesson:

> Shared prep → canary → implement → multi-agent adversarial review → diagnostics work queues → when agents misbehave, **edit the harness**.

This scaffold already owns writer/grader separation, behaviour oracles, and two Bun-derived gates (G31/G32). Phase A closes the **review and process** gap every autonomous run can use. Phase B unlocks **mass mechanical** work without inventing a second product. Phase C stays demand-driven.

**Next step after design approval:** superpowers-style implementation plan for Phase A only (`docs/superpowers/plans/…`), task-split with wiring tests first, then scripts, then skill text, then registry updates.

---

## 16. References

- [Rewriting Bun in Rust](https://bun.com/blog/bun-in-rust) — primary case study  
- `HARNESS.md` — G31, G32, adversarial security pass, generator-verifier failure-mode audit  
- `.claude/skills/gate/SKILL.md` — 3-instance re-verify  
- `.claude/agents/code-reviewer.md` — fresh-context review contract  
- `.claude/workflows/README.md` — dynamic workflow slot (empty by design)  
- `docs/proposals/context-first-navigation.md` — proposal format / phased delivery precedent  
- `docs/superpowers/plans/2026-07-09-devin-parity-hardening.md` — majority re-verify + learned-rules propagation precedent  
