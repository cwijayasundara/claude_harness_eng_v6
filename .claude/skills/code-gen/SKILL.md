---
name: code-gen
description: Code generation quality principles — TDD, typing, error handling, logging, API integration, LLM integration.
---

# Code Generation Skill

Reference skill for generator teammates. Read this before writing any code.

---

## Core Quality Principles

### 1. Small Modules — One File, One Responsibility
- Each file must have a single, clearly named responsibility.
- **Warning threshold:** 200 lines — add a comment noting the file is growing large.
- **Block threshold:** 300 lines — do not submit. Split before opening a PR.
- If you hit 300 lines, decompose into sub-modules and re-export from an index file.

### 2. Static Typing — Annotate Everything
- Every function parameter, return value, and variable must have an explicit type.
- **TypeScript:** Zero `any`. Use `unknown` + type guard if the shape is truly unknown.
- **Python:** Full type hints on all functions. Use `TypeVar`, `Generic`, `Protocol` where appropriate.
- Type aliases for domain concepts (`UserId = str`, `type OrderId = string`).

### 3. Functions Under 30 Lines
- If a function body exceeds 30 lines, decompose it into named sub-functions (the `pre-write-gate` hook enforces this limit deterministically).
- Each sub-function should be testable in isolation.
- Use descriptive names that read as a sentence: `validateOrderItems`, `buildPaymentPayload`.
- Avoid deeply nested control flow — extract branches into named helpers.

### 4. Single Owner for State Mutations
- Every state-creating operation (DB insert, file write, queue publish) must have exactly ONE call site.
- If a route handler creates a record, the service it calls must receive the ID — not create a second record.
- **Anti-pattern:** Route creates Task, then calls `service.start(query)` which also creates a Task → duplicate records.
- **Correct pattern:** Route creates Task with ID, then calls `service.start(task_id)` which operates on the existing record.
- When a background task or async flow needs a resource, pass the ID, don't re-create it.
- Test this explicitly: after calling the endpoint, assert the exact count of records created (e.g., `assert db.query(Task).count() == 1`).

### 5. Explicit Error Handling
- Define typed error classes per domain (e.g., `class OrderNotFoundError extends AppError`).
- Never use bare `except Exception` or `catch (e: any)`.
- All error paths must be covered by tests.
- Propagate errors up with context; do not swallow silently.
- In TypeScript: use `Result<T, E>` or typed throws with JSDoc `@throws`.

### 6. No Dead Code
- Every line of code must trace to a user story or a technical requirement.
- Do not leave commented-out code in PRs.
- Remove unused imports, variables, and parameters immediately.
- If code is speculative ("might need later"), do not include it.

### 7. Self-Documenting — Names Over Comments
- Variable and function names should make comments unnecessary.
- Types act as documentation — a well-typed function signature is its own doc.
- Use comments only for non-obvious decisions (algorithm choice, regulatory constraints).
- Avoid `// TODO` in submitted code — file a story instead.
- **No stub-to-green.** Do not clear compile/lint by shipping `todo!()`, `unimplemented!()`, `NotImplementedError`, empty `pass`/`...` bodies, or `throw new Error("TODO")` on production paths. Implement the behaviour, or defer with an explicit story and `// harness:stub-ok story=E#-S#` on the same line (the `stub-smell-gate` enforces markers at commit on standard+ tiers).
- **Paragraph rule (Bun).** If you need a paragraph-long comment to justify a workaround, the code is wrong — fix the code; do not document the hack.

### 8. Deep Modules — Simple Interface, Useful Behavior
- Prefer modules with small, stable interfaces that hide meaningful complexity.
- A module interface includes its types, invariants, error modes, ordering requirements, and configuration — not just the function signature.
- Apply the deletion test before adding a module: if deleting it removes complexity entirely, it was probably shallow ceremony; if deleting it spreads complexity across callers, it is earning its keep.
- Do not create pass-through services, repositories, hooks, helpers, or adapters just to satisfy a pattern.
- One implementation behind an interface is not proof an abstraction is needed. Introduce interfaces/adapters when there are two real implementations, a test boundary around an external dependency, or a clear domain seam.

### 9. Public Interface as Test Surface
- Tests should verify observable behavior through public interfaces: API endpoints, CLI commands, UI flows, exported module functions, or documented domain services.
- Do not test private helpers, implementation details, internal call order, or mock interactions unless that is the public contract.
- If a helper is complex enough to need direct tests, consider making it a named domain module with a clear public interface.
- A good test should survive internal refactors when behavior is unchanged.

### 10. Performance & Latency — Don't Ship the Slow Pattern
Readability comes first, but readable code is not allowed to be needlessly slow. The evaluator runs a runtime **latency ratchet** on read endpoints (p95 regression vs a baseline) plus an advisory budget check from `project-manifest.json` → `execution.latency_budget_ms` (default read 300ms / write 800ms, override per-endpoint in the sprint contract). Code to that budget. These are *criteria*, not "make it fast" — each is a specific pattern to avoid unless you can name why it's unavoidable here:

- **No N+1 queries.** Loading a list and then querying per-row inside a loop is the single most common latency killer. Fetch the set in one query — use a join, an `IN (...)`/`WHERE id = ANY(...)`, or the ORM's eager-load (`selectinload`/`joinedload`). If you write a query inside a `for` loop over rows, stop and batch it.
- **Bound every result set.** Any endpoint or query that returns a collection must paginate or `LIMIT`. Never `SELECT *` an unbounded table into memory. Default to a capped page size; accept `limit`/`offset` (or cursor) params.
- **Index the columns you filter, sort, or join on.** If a query has a `WHERE`/`ORDER BY`/`JOIN` on a column, that column needs an index (declare it in the model/migration). A full table scan that passes tests at 10 rows is a timeout at 10⁶.
- **Run independent awaits concurrently.** Two `await`s with no data dependency are a sequential stall — gather them (`asyncio.gather`, `Promise.all`). Sequential awaits are only correct when the second genuinely needs the first's result.
- **Never block the event loop on a hot path.** No synchronous CPU-bound work, blocking SDK call, or sync DB driver inside an async request handler — it stalls every concurrent request. Use async clients, or push blocking work to `asyncio.to_thread`/a worker (see the async-bridging rule and the thread-pool gotcha below). Sync `postgresql://` in an async app is both a correctness *and* a latency bug.
- **Don't re-compute or re-fetch what doesn't change per request.** Hoist constant work (compiled regexes, loaded config, opened clients, expensive lookups) out of the request path to startup/module scope. Cache genuinely expensive, repeated, read-mostly results — but only with an explicit invalidation story; a cache without invalidation is a correctness bug, so don't add one speculatively.
- **Stream or page large payloads.** Don't build a giant string/list in memory to return it; stream, or return a bounded page.

When clarity and speed genuinely conflict on a hot path, keep the readable version and leave a one-line comment naming the trade-off — that signals to the evaluator and reviewer it was a deliberate choice, not an oversight.

---

## Testing Rules — honor `quality.test_discipline`

Read `project-manifest.json#quality.test_discipline`. New scaffolds default to `outcomes`. Missing key on an old project is treated as `tdd` by the hooks.

**"Coverage isn't about bug prevention — it's about guaranteeing the agent has double-checked the behavior of every line of code it wrote."** — Steve Krenzel

**Shared (every discipline):** coverage floor + mutation-smoke + test-deletion stay. Tests enter through public interfaces. Only mock external boundaries. Never mock business logic. Isolate tests from `.env`. Realistic test data. Names describe behavior.

### `outcomes` (default)

Tests and production code land together at the **named seams** in `specs/test_artefacts/test-plan.md`. One behavior at a time through the public interface. Do not run the write-lock / red-phase / test-integrity stack. Do not write all tests first, then all implementation.

### `tdd`

Write-lock / red-phase / test-integrity stay on.

1. Write one failing behavior test through the public interface.
2. Run it — it must fail for the right reason.
3. Write the minimum code to pass.
4. Refactor if needed, re-run, commit.
5. Repeat for the next behavior.

### `at-first`

For **behavior stories only**: write the acceptance test against the Ports-and-Adapters seam, record the red receipt (`record-at-red.js`), then implement. Coverage / mutation-smoke / test-deletion still apply. The write-lock stack stays off.

**Also always:**

- Isolate tests from `.env` files: pass `_env_file=None` (pydantic) or mock `dotenv.load_dotenv`.
- Async frameworks need async driver schemes (`postgresql+asyncpg://`, not `postgresql://`).
- Integration tests for multi-step flows assert the final state and exact record counts.

---

## External API Integration

When generated code calls any external API (third-party services, partner APIs, cloud services), follow these rules. See `.claude/skills/code-gen/references/api-integration-patterns.md` for full templates.

### Service Wrapper Pattern (Mandatory)

Every external API gets a dedicated wrapper class. This is the ONLY file that imports the SDK or makes HTTP calls to that service.

```
Business Logic (process_service.py)
    ↓ calls typed methods
API Wrapper (external_client.py)    ← only file that imports SDK / makes HTTP calls
    ↓ calls
External API
```

Rules:
- One wrapper class per external API
- Wrapper exposes project-internal typed models, not SDK types
- Business logic never sees SDK response objects — only your domain types
- The wrapper is the mock boundary in tests

### Error Taxonomy (Mandatory)

Every wrapper classifies errors into typed categories:

```python
class ApiTransientError(Exception):
    """Retryable: 429, 502, 503, timeout, connection reset."""
    pass

class ApiPermanentError(Exception):
    """Not retryable: 400, 401, 403, 404, schema mismatch."""
    pass

class ApiRateLimitError(ApiTransientError):
    """Rate limited with backoff hint."""
    def __init__(self, message: str, retry_after: float | None = None):
        super().__init__(message)
        self.retry_after = retry_after
```

- Business logic catches `ApiTransientError` to retry/degrade, `ApiPermanentError` to fail fast
- No bare `except Exception` in any API-calling code
- All exceptions carry HTTP status code and response body for debugging

### Retry and Rate Limiting

- Retry config lives in `config.yml` under `external_apis.{service_name}.retry`, not hardcoded
- Wrapper applies exponential backoff internally — business logic is unaware of retries
- Respect `Retry-After` headers when present
- Log every retry attempt at WARNING level

### Async Bridging

When an SDK is synchronous but the backend is async:
- Use `asyncio.to_thread()` only inside the wrapper class
- Never bridge in business logic
- Prefer async SDKs or HTTP clients when available

### Secrets

- API keys in `.env` only, loaded via config layer
- Wrapper reads from injected config, never from `os.environ` directly
- `.env.example` committed with placeholder values

---

## Parallel Execution

- **File ownership:** consult `component-map.md` before touching any file.
- **Plan approval required** before starting parallel work.
- **Shared interfaces:** message teammates before changing a type or API contract that crosses boundaries.
- **Task sizing:** aim for 5–6 discrete tasks per teammate per sprint cycle.
- **Conflicts:** if two teammates need the same file, one blocks; do not merge partial changes.

---

## Read these when the task calls for it

The rules above apply to every change. The rest loads only when relevant — don't read it preemptively.

- **Worked patterns.** For the concrete shape of the principles above, read `.claude/skills/code-gen/references/code-patterns.md`.
- **LLM calls.** When the code you're writing calls an LLM, read `.claude/skills/code-gen/references/llm-integration.md` first — structured output is mandatory and the failure modes are specific.
- **Production code.** For configuration, error-envelope, and layering rules, read `.claude/skills/code-gen/references/production-standards.md`.
- **Before handing off.** The mistakes that fail review are listed in `.claude/skills/code-gen/references/review-failure-gotchas.md` — check it when a change is ready, not while drafting.
