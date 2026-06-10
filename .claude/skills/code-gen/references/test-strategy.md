# Test Strategy Reference

The layer model, boundary-condition checklist, and test-data rules read by generator teammates while writing tests. Part of the engineering-standards (code-gen) reference pack. TDD discipline, mock-boundary rules, and the coverage gate are canonical in `code-gen/SKILL.md` and the `superpowers:test-driven-development` skill — this file adds the layer model and boundary checklist, not a second copy of those rules.

---

## Test Strategy

Tests run in three layers. Each layer has a distinct purpose and cost profile.

Across all layers, tests verify behavior through public interfaces. They should describe what the system does, not how the internals happen to be arranged. A test that fails after a harmless internal refactor is usually testing the wrong thing.

### Layer 1 — Unit Tests
- Test a single function or class in isolation.
- Prefer exported functions, documented domain services, or public class methods. Avoid private helpers unless they are the real public interface of a small module.
- No network, no database, no file system.
- Mock only external boundaries (see code-gen SKILL.md for mock rules).
- Fast: all unit tests must complete in under 10 seconds total.
- Location: `tests/unit/` mirroring the source tree.

### Layer 2 — Integration Tests
- Test interactions between two or more modules (e.g., service + repository against a real test DB).
- Use a real database in a Docker container, not SQLite substitutes unless explicitly approved.
- Seed data is reset between tests using transactions or truncation.
- Location: `tests/integration/`.

### Layer 3 — End-to-End Tests (E2E)
- Test complete user flows through the running application.
- Use Playwright (see `test-playwright.md` for config and patterns).
- Run against a locally started application with a seeded test database.
- Location: `tests/e2e/`.

---

## Coverage Requirements

| Layer | Minimum Threshold |
|-------|-------------------|
| Unit | 100% of business-logic branches (target); the ratchet **floor is 80%** |
| Integration | All happy paths + documented error paths per endpoint |
| E2E | All user stories in the current sprint contract |

The numeric gate is single-sourced: the **floor is 80%, target 100%**, enforced by `/auto` Gate 3 and the coverage hook (see `.claude/skills/code-gen/SKILL.md`). This file defers to those for the exact number. A failing coverage gate blocks merge — it is not advisory.

---

## Boundary Condition Generation

For every function under test, generate test cases for:
1. **Empty inputs** — empty string, empty array, zero, null/None.
2. **Boundary values** — min/max valid range, one below min, one above max.
3. **Invalid types** — if the language allows runtime type errors, test them.
4. **Error paths** — every documented exception/error case must have a test.
5. **Concurrency** — if the function is called concurrently, test for race conditions.

Name boundary tests descriptively:
- `"returns empty list when no items match filter"`
- `"raises OrderNotFoundError when order_id does not exist"`
- `"caps quantity at MAX_ITEMS_PER_ORDER when input exceeds limit"`

---

## Public Interface Testing

Good tests enter through one of:

- API route or handler
- UI interaction
- CLI command
- exported module function
- documented domain service method

Avoid assertions on:

- private helper calls
- internal function names
- mock call counts between internal collaborators
- exact implementation ordering unless ordering is part of the contract
- database rows directly when a public API response or domain service result is the behavior under test

If the only way to test behavior is through fragile internals, flag an interface design problem before adding more tests.

---

## Tracer-Bullet TDD

The red-green-refactor / vertical-slice discipline (one failing behavior test → minimum code → pass → repeat) is canonical in `.claude/skills/code-gen/SKILL.md` and the `superpowers:test-driven-development` skill — follow those rather than a second copy here. This file's contribution is the layer model and the boundary-condition checklist above, not the TDD loop.

---

## Test Data Rules

- Use realistic domain values in all tests. See `test-data.md` for fixture patterns.
- Never use placeholder values: `"test"`, `0`, `"foo"`, `null` as stand-ins for real domain objects.
- Use factory functions or builder patterns to construct test data — not inline object literals.
- Randomize test data where possible using seeded fakers (Faker.js, Faker for Python).
  - Seed the faker in CI to get deterministic results (`faker.seed(12345)`).

---

## Gotchas

- Mocking business logic instead of testing it (hides bugs, creates false confidence)
- Writing tests that only test the happy path — error paths matter equally
- Using `time.sleep()` or `waitForTimeout` in tests — use proper async patterns
- Tests that depend on execution order — each test must be independently runnable
- Asserting on implementation details (private method calls) instead of observable outcomes
- Using production database credentials in any test environment
- Hardcoded port numbers without fallback — use dynamic port allocation in integration tests
