# Sprint dedup pre-check — wiring `modularity-reviewer` into `/design --delta`

**Date:** 2026-07-08
**Why:** `/sprint` (shipped 2026-07-04, `docs/superpowers/specs/2026-07-04-sprint-delta-lane-design.md`) evolves `specs/design/` sprint-to-sprint via non-destructive amendments, gated by a human-reviewed diff (GATE 2). `/feature`'s single-story lane shares the same `/design --delta` machinery. Neither currently checks whether the *new* components a design amendment proposes duplicate something that already exists — the only duplication sensor the harness has, `modularity-reviewer` (gap G6), runs solely in `/brownfield --full` as a periodic, whole-repo, advisory pass. A 2026-07-08 external research pass (`sprint-lane-shipped-2026-07-04` memory) confirmed no other surveyed coding-agent product (Anthropic's own harness docs, Kiro, spec-kit, Devin) ships a working duplicate-prevention mechanism either — this closes that gap preventively rather than leaving it purely reactive.

## Scope (decided)

- **Wired once, in shared machinery:** a new **Step D3.5** in `design/SKILL.md` Delta Mode, between Step D3 (planner writes the amendment) and Step D4 (grounding gate). Both `/sprint` (many-story) and `/feature`'s impact-classifier (single-story) callers get it automatically — no changes needed in either conductor.
- **Scoped, not whole-repo:** the reviewer judges only `modularity-pack.json` entries (hubs/cycles/duplication candidates) that overlap the amendment's own new/changed component paths — not the entire codebase. Keeps cost bounded to the sprint's actual diff, matching `/sprint`'s incremental philosophy.
- **Surfaced, not blocking:** mirrors the existing contract-drift check (Step D5) — a `CONCERNS` verdict is not an automatic hard stop. It is displayed at GATE 2 alongside the amendment; the human decides. This matches `modularity-review`'s documented status in `harness-manifest.json` ("a maintainability sensor, not a gate") — duplication judgment is inferential, not deterministic like the Step D4 grounding gate, so it must not fail-closed on a false positive.
- **Degrades loudly, not silently:** no `code-graph.json` (a pure-greenfield sprint that never ran `/brownfield`) → skip, with an explicit "duplication pre-check skipped: no code graph" note carried to GATE 2. Never a silent implicit PASS.
- **Rejected alternative — folding the check into the planner's own Step D3 prompt** (self-check, no second agent): rejected because the same agent that chose the design would be judging its own choice — the self-evaluation bias the harness's generator/evaluator split exists to avoid elsewhere.
- **Rejected alternative — hard-block on `CONCERNS`** (like Step D4): rejected for the same reason `modularity-review` is documented as advisory everywhere else in the harness — inferential semantic judgment, not a deterministic trace check; blocking on it risks stopping legitimate work on a false positive.

## §1 — Step D3.5 in `design/SKILL.md` Delta Mode

Inserted between existing Step D3 and Step D4:

1. **Precondition.** Check `specs/brownfield/code-graph.json` exists.
   - Missing → skip this step entirely. Record `"duplication_precheck": "skipped-no-graph"` for GATE 2 to display (see §3). Do not run modularity-pack or spawn a reviewer.
2. **Refresh the pack.** `node .claude/scripts/modularity-pack.js` (existing script, unmodified — already handles a missing graph by exiting 2, which step 1's precondition check already short-circuits before reaching here). Always refresh before reading, same convention as Step D5's contract-drift check.
3. **Derive touched scope.** From the amendment just written in Step D3: the new/changed `component-map.md` rows and the paths just added to `reasons-canvas.md`'s `Governs` list for this amendment. This is already machine-readable per the existing Governs-list convention (design/SKILL.md's Entities/Governs sections) — no new extraction code needed, just read the same list Step D3 already produced.
4. **Spawn the reviewer, scoped.** Spawn Agent with `subagent_type="modularity-reviewer"`, prompt:
   > You are being invoked as part of `/design --delta` Step D3.5, not a full `/brownfield --full` pass. Read `specs/brownfield/modularity-pack.md`/`.json` as usual, but restrict your duplication/responsibility/argument-clump judgment to entries that overlap these paths (this amendment's new/changed components): `<touched-scope path list>`. Ignore pre-existing candidates unrelated to this sprint's changes. Write your output to `specs/reviews/design-delta-duplication-<amendment-id>.md` and `specs/reviews/design-delta-duplication-<amendment-id>.json` instead of the default `specs/reviews/modularity-review.md`/`-verdict.json` — do not touch those default files (see §2 for the agent-side change enabling this).
5. **Malformed/missing verdict.** If the agent errors out or the JSON file is absent/unparseable after the spawn, treat as `"duplication_precheck": "inconclusive"` for GATE 2 — never silently treated as `PASS`. (Same "no vacuous pass" discipline the fitness audit already established for other sensors — see `deep-dive-2026-07-02-fitness-audit` memory.)

## §2 — `modularity-reviewer.md` output-path override (small, targeted edit)

The agent's Output section currently hardcodes `specs/reviews/modularity-review.md`/`-verdict.json`. Add one sentence: *"If the invoking prompt specifies explicit output paths, write there instead of the defaults above — this lets a scoped caller (e.g. `/design --delta` Step D3.5) avoid overwriting the periodic `/brownfield --full` review."* No other change to the agent's review methodology, grounding, or verdict schema (`{"verdict": "PASS|CONCERNS", "findings": [...], "confirmed_legitimate_hubs": [...]}` stays identical).

## §3 — GATE 2 (Step D7) display update

Add a fourth item to the existing display list (amendment narrative; `git diff`; contract-drift verdict + Breaking Changes; design-delta evaluator verdict):

- The duplication pre-check result: either the verdict + findings from `specs/reviews/design-delta-duplication-<amendment-id>.json`, or the explicit `skipped-no-graph` / `inconclusive` marker from §1.

The human approval question in Step D7 is unchanged in mechanics (still "Does this design amendment correctly evolve the existing architecture? Approve to commit... or provide corrections.") — the duplication finding is additional context for that same decision, not a new separate gate.

## §4 — Registry + docs

- `harness-manifest.json`: update the `modularity-review` sensor's `description` to mention the new invocation site (currently: *"Run in /brownfield --full; judges duplication/responsibility/clumps/cycles against source, confirms legit hubs."* → append *"; also invoked scoped-to-amendment from `/design --delta` Step D3.5 (sprint/feature design-delta lanes)."*). No change to `id`, `type`, `status`, `scope`, or `wired_at` — same sensor, one more call site, not a new sensor.
- `HARNESS.md`: G6 line (~line 96) — append the new invocation site so the shipped-control record stays accurate: *"...runs in `/brownfield --full` and, scoped to the amendment's touched components, in `/design --delta` Step D3.5."*
- `sprint/SKILL.md` and `feature/SKILL.md`: no changes needed — both already delegate design work entirely to `/design --delta`; this is the point of wiring it in the shared machinery once.

## §5 — Tests

- `test/modularity-wiring-contract.test.js` (existing file — add tests, don't replace): a new test scoped specifically to the Delta Mode section of `design/SKILL.md` (not "matches anywhere in the file," which would pass trivially once the string appears elsewhere) — assert the Delta Mode section contains Step D3.5 referencing `modularity-pack.js`, `modularity-reviewer`, the scoped-output-path instruction, and the `skipped-no-graph` / `inconclusive` skip markers. Assert Step D7's display list mentions the duplication pre-check.
- New assertion in the same file (or a new `test/modularity-reviewer-output-override.test.js` if cleaner): `modularity-reviewer.md` documents the output-path override sentence from §2.
- `harness-manifest.json` / `HARNESS.md` assertions: extend existing manifest-validation coverage to confirm the `modularity-review` description mentions the new call site (simple substring match, same style as other wiring-contract assertions in this file).
- No new script/pure-function tests are needed — this feature adds no new deterministic code path (it reuses `modularity-pack.js` unchanged and instructs two existing agents via prompt); all new testable surface is documentation/wiring, which is exactly what `modularity-wiring-contract.test.js` already exists to lock down.

## Risks & mitigations

- **Reviewer agent doesn't honor the output-path override from the prompt (competing instructions with its own frontmatter file).** Mitigation: §2's edit makes the override an explicit, first-class instruction in the agent's own file rather than relying solely on the invoking prompt to override baked-in defaults.
- **Cost/latency of an extra agent spawn on every design-delta run.** Mitigation: scoped-not-whole-repo keeps the reviewer's read surface small; the precondition check (§1.1) skips it entirely for graphless greenfield sprints, where there's nothing to compare against anyway.
- **False positive `CONCERNS` blocking a human's flow.** Mitigation: explicitly surfaced-not-blocking (see Scope) — the human adjudicates at GATE 2, same as contract-drift's `breaking` verdict today.
- **Weak wiring-contract test that passes without the feature actually being present** (a regex matching anywhere in the file rather than within the Delta Mode section specifically). Mitigation: §5 tests scope their assertions to the Delta Mode section's text range, not file-wide presence.

## Out of scope

- The TDAD-style source→test dependency map idea (surfaced in the same 2026-07-08 external research pass) — a separate, unrelated mechanism (pre-commit test-impact mapping, not duplication detection); its own design if pursued.
- Changing `modularity-review`'s cadence classification, blocking status, or verdict schema for the existing `/brownfield --full` call site — that invocation is untouched.
- Any change to `/sprint/SKILL.md` or `/feature/SKILL.md` conductors themselves — both already delegate to `/design --delta` unchanged.
- Full-repo duplication scanning as part of every sprint (rejected — see Scope's "scoped, not whole-repo").
