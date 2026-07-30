# Scaffold-encoded artifacts + TS boundary-doubles kit — Plan

> Continues the Boris-thesis work ([[boundary-test-doubles]]): encode domain knowledge as infrastructure. Branch `scaffold-encoding-and-ts-kit` off `main`.

**Goal:** (Part 1) mirror the reviewed Python test-double kit + G36 sensor to the TS/React stack; (Part 2) make `/scaffold` emit *encoded* project-specific artifacts (a real CLAUDE.md + a REVIEW.md wired into the code-reviewer) instead of generic ones.

**Confirmed scope:** Part 2 = enriched CLAUDE.md + REVIEW.md wired into reviewer (defer project-skill-gen). Part 1 = TS kit + G36 widened to co-located TS tests + a `harness:live-ok` inline marker.

## Global constraints
- Env flag verbatim `HARNESS_TEST_REPLAY` = `"1"`; TS doubles bind to `process.env.HARNESS_TEST_REPLAY === '1'`, NOT a bare constructor bool.
- TS conventions per harness: vitest + RTL, MSW at the `src/api/` boundary, raw-fetch LLM wrapper (no assumed TS Anthropic SDK), Faker seeded, `tests/fixtures/{service}/{op}.json` + `tests/fixtures/llm/{op}/{key}.json` (mirror Python paths exactly).
- TS templates validated by a real `tsx` round-trip; `npx tsc --noEmit`/`tsx` both available.
- Gates degrade loudly; `harness:live-ok` marker suppresses per-line only (mirror `harness:secret-ok`).
- Full `npm test` green each increment. Don't edit CLAUDE.md/.mcp.json/settings.

---

## Feature A — TS boundary-doubles kit + G36 TS coverage

### A1 — TS kit templates (`.claude/templates/boundary-doubles/*.ts`)
- `replay-transport.ts` — mirror `replay_transport.py`: `replayEnabled()` (env flag), `class MissingFixtureError`, `ReplayTransport { replay(op), record(op, resp), pathFor(op) }`, fixtures at `tests/fixtures/{service}/{op}.json`.
- `fake-llm.ts` — mirror `fake_llm.py`: `requestKey(payload)` = first 16 of sha256 of canonical JSON (`JSON.stringify` with sorted keys), `class GoldenNotFoundError`, `FakeLLMClient { respond(op, payload), recordGolden(op, payload, resp) }`, fixtures at `tests/fixtures/llm/{op}/{key}.json`.
- `db-fixture.ts` — transactional-rollback helper (documented Prisma `$transaction`/pg pattern), in-memory fast path when `TEST_DATABASE_URL` unset.
- `msw-handlers.ts` — MSW `setupServer` serving the same fixtures for `src/api/` component tests (fills the MSW-named-but-unshown gap).
- `vitest.setup.ts` — analogue of `conftest.py`: register MSW server (beforeAll/afterEach/afterAll), provide fake LLM/db, throw if requested without the flag.
- `vitest.config.template.ts` — wires `setupFiles` + `test.environment: 'jsdom'` (scaffold ships none today).
- `at-template.test.ts` — Ports-and-Adapters AT mirroring `at-template.py`.

### A2 — real TS record→replay round-trip (`test/boundary-doubles-ts-roundtrip.test.js`)
node:test spawns `npx tsx -e '<script>'` importing the templates: record → replay byte-identical (ReplayTransport); golden keyed by stable requestKey order-independence (FakeLLMClient); MissingFixtureError/GoldenNotFoundError on miss. Skip LOUDLY if `tsx` unavailable.

### A3 — G36 TS coverage (`.claude/hooks/lib/live-externals-gate.js` + tests)
- Widen `IN_SCOPE` to also match co-located TS tests by name: `\.(test|spec)\.(tsx?)$` and `__tests__/`, in addition to `tests/integration/` + `e2e/`.
- Broaden `SDK_RE` with common TS clients: `AnthropicVertex`, `AnthropicBedrock`, `GoogleGenerativeAI`, `CohereClient`, `Mistral`.
- Add a per-line `harness:live-ok` suppression marker (mirror `harness:secret-ok`): a finding on a line carrying it is dropped. Update classifier + tests + the failBlock message to mention the marker.

---

## Feature B — Scaffold emits encoded artifacts

### B1 — enrich root CLAUDE.md
- Add placeholders to `.claude/templates/claude-md.template.md` for a new "## This Project" block: layer/import hierarchy, bounded contexts + allowed edges, topology, observability SLO, sensor tier, and the domain vertical + its human-readable bounded contexts (from `.claude/config/scaffold-packs.json` `verticalPacks`).
- Extend `renderClaudeMd(templateBody, profile)` in `.claude/scripts/scaffold-render.js` (+ `buildManifest`/profile plumbing) to fill them from the manifest fields the scaffold already captures. Absent fields render a clear "not configured" line, never a dangling token.
- Test: `test/scaffold-claude-md-encoding.test.js` — a profile with layers/contexts/vertical renders a CLAUDE.md containing those specifics; an empty profile renders no dangling `{tokens}`.

### B2 — REVIEW.md + wire into code-reviewer
- New template `.claude/templates/review.template.md`: a project review policy composed from captured knowledge — the layer/import rules a reviewer must reject, bounded-context edges, security posture (sensor tier + security-boundary triggers), framework-pack conventions, and the constitution-invariants pointer.
- `renderReviewMd(templateBody, profile)` in scaffold-render.js + `writeReviewMd()` in `.claude/scripts/scaffold-apply.js` writing `REVIEW.md` at project root (added to the written-files list ~:251-255).
- Wire the `.claude/agents/code-reviewer.md` agent to read `REVIEW.md` when present and enforce its project rules (so it is not shelfware — closes Boris's "reviewer rejects wrong pattern = failure of automation").
- Tests: `test/scaffold-review-md.test.js` (render contains layer/context/security specifics) + a wiring assertion that `code-reviewer.md` references `REVIEW.md`.

### B3 — registration
- Templates copied wholesale by `copyTree` (scaffold-apply.js:237) → new `.ts` templates + `review.template.md` auto-included; verify. No `scaffold-copy.js` CORE_SCRIPTS change unless a new script is added.
- Note the TS kit + scaffold encoding in `HARNESS.md` (G34 entry extension) — additive.

## Final
Full `npm test` green; independent whole-branch review (most capable model), focus on: TS kit fidelity to the Python contract, the G36 marker + scope not over-matching, and the scaffold render never emitting a dangling token or a wrong project rule into a generated CLAUDE.md/REVIEW.md.
