# Mutation-Smoke Reference — Proving Tests Actually Bite

Coverage proves a line *ran*. Traceability proves a test *exists*. Neither proves the test would **fail if the code broke** — a test can execute a line, trace an obligation, and assert nothing meaningful. Mutation-smoke closes that gap: it breaks the code on purpose and checks that a test goes red.

It is the automated, repeatable form of the manual checkpoint in `pinning-down-behavior` ("flip a behavior, watch the pin fail"). Runner: `.claude/scripts/mutation-smoke.js`.

---

## What it does

For each target file it finds **mutation sites** (one per high-signal operator), and for each: applies the mutation, runs your test command, records **killed** (the suite failed — good) or **survived** (the suite still passed — a gap), then restores the file byte-for-byte. The **mutation score** is `killed / tested`.

A **survivor** is a mutation no test caught — behavior nobody actually verifies. Survivors are the output that matters; chase them, not the score.

## Operators

Relational/equality (`>` ↔ `>=`, `<` ↔ `<=`, `==` ↔ `!=`, `===` ↔ `!==`), logical (`&&` ↔ `||`, Python `and` ↔ `or`), and boolean literals (`true`/`false`, `True`/`False`). JavaScript/TypeScript and Python. This is the classic high-signal core — a *smoke* gate, not exhaustive mutation testing (no Stryker/mutmut dependency).

## The design contract — why survivors are trustworthy

- **False survivors are impossible.** The runner never mutates inside a string or a comment. A mutation there would change nothing, "survive," and falsely flag a gap — so it is excluded by construction. Every survivor it reports is a real, behavior-bearing mutation no test killed.
- **False kills are tolerable.** A mutation that produces syntactically broken code (e.g. corrupting a TypeScript generic) fails to compile/run and counts as *killed*. That costs a little signal — but it can never cause a false gate failure. The asymmetry is deliberate: a survivor is always actionable; a kill is at worst uninformative.

## Usage

```bash
# Gate: mutate the files a group changed, run that project's tests.
node .claude/scripts/mutation-smoke.js \
  --files backend/src/orders/service.py \
  --files backend/src/orders/pricing.py \
  --test-cmd "cd backend && uv run pytest -q" \
  --max-mutants 40 \
  --threshold 0.8 \
  --out specs/reviews/mutation-report.json

# Dry run: list sites without running anything (fast, for scoping).
node .claude/scripts/mutation-smoke.js --files src/auth.ts --dry-run
```

| Flag | Meaning |
|------|---------|
| `--files <f>` | Target source file (repeatable). Non-JS/Python or missing files are skipped. |
| `--test-cmd "<cmd>"` | The project's test command. Required unless `--dry-run`. Operator config, never untrusted input. |
| `--cwd <dir>` | Directory to run the test command in (default: current). |
| `--max-mutants N` | Cap mutants tested (deterministic first-N by position). Bounds runtime. |
| `--timeout-ms N` | Per-mutant test timeout (default 60000); a timeout counts as killed. |
| `--threshold T` | Minimum score to pass (default 0.8). |
| `--out <file>` | Write the JSON report. |
| `--dry-run` | List sites only; run no mutants. |

Exit `0` = pass, `1` = score below threshold, `2` = usage error.

## Report shape

```json
{ "score": 0.86, "total_sites": 51, "tested": 40, "killed": 34, "threshold": 0.8, "pass": true,
  "survived": [ { "file": "backend/src/orders/pricing.py", "line": 47, "operator": ">=->>", "original": ">=", "mutated": ">" } ] }
```

## How to use it (and how not to)

- **Scope it to changed files.** Mutating the whole repo per build is slow; target the diff of the current group/seam. Always `--max-mutants` to bound runtime and `log()` what was capped — a silent cap reads as "fully checked" when it wasn't.
- **Fix survivors by adding the missing assertion**, not by raising the threshold or deleting the mutated branch. A survivor at `pricing.py:47 >=->>` means no test pins the boundary at that comparison — add the `N-1 / N / N+1` boundary case from `test-design.md` §2.
- **It complements, does not replace, the obligation gate.** The constraint-obligation gate ensures a negative test *exists* for each schema rule; mutation-smoke ensures the tests *bite*. Run obligation grounding first (cheap, deterministic), mutation-smoke second (runs the suite, costs time).

## Gotchas

- A near-zero score with many survivors usually means the test command isn't actually exercising the file (wrong path, tests skipped) — verify the suite runs green unmutated first.
- Don't point `--test-cmd` at a flaky suite: nondeterministic failures inflate kills. Stabilize flakes before trusting the score.
- The operator set is intentionally small. A surviving bug outside these operators (a wrong constant, a missing call) won't be caught — mutation-smoke raises confidence, it does not certify correctness.
