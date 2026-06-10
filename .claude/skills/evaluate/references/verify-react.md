# Verification reference — React / TypeScript (black-box)

Deep frontend rigor for the evaluator. Same black-box rule: **the build, the type checker, the test runner, and the live browser produce the evidence** — never read components to decide they look right.

## Environment & build

- Run frontend commands from the frontend directory with the project's package manager (`npm`/`pnpm`). Missing `node_modules` (deps not installed) is an infrastructure FAIL, not a code FAIL — note it and stop.
- **The build is a gate.** `npm run build` must exit 0. A build failure (a `tsc` type error, an unresolved import, a failed bundler step) is a hard FAIL — capture the first error with `file:line`. A green test suite over code that doesn't build is still a FAIL.

## Types, lint, unit tests

- `npm run typecheck` (`tsc --noEmit`): type errors → FAIL, `error_type: type_error`, capture `file:line`.
- `npm run lint` (`eslint`): surface lint errors as evidence.
- `npm test` (`vitest`): a nonzero exit is a FAIL; capture the failing test name + the RTL assertion. Treat a test that queries by CSS/`data-testid` instead of role/label, or asserts component internals, as low-value — note it, but a genuine assertion failure is real.

## Live browser signals (Layer 2 — interpret, never guess from source)

- **Blank/white screen** → an uncaught JS error or a render crash. Pull `browser_console_messages`; an unhandled exception or a React error-boundary trip is a FAIL with the console error as evidence.
- **`getByRole`/`getByLabel` can't find an element that should exist** → a real markup/accessibility defect (non-semantic element, missing label), **not** a flaky locator. Do not "fix" it by switching to a CSS selector — record the failure.
- **Hydration mismatch** (Next.js: "Text content does not match server-rendered HTML", "Hydration failed") in the console → a FAIL even if the page eventually renders; capture the message.
- **A spinner/loading state that never resolves** → inspect network: a pending/failed request (4xx/5xx, CORS, wrong base URL) means the fetch is broken. A stuck loading state is a FAIL.
- **Unhandled promise rejection / "Can't perform a React state update on an unmounted component"** in the console → an async/effect-cleanup defect; classify (`type_error`/`timeout`) from the message.
- **Forms**: after submit, verify the asserted outcome actually happened (navigation, success message, persisted change). A button that appears to click but produces no network call in the request log is a FAIL, not a pass.

## Frontend `error_type` mapping

| Browser / tool signal | error_type |
|---|---|
| `tsc`/build type error | `type_error` |
| unresolved import / module not found | `import_error` |
| failed `fetch` / 4xx-5xx from the UI | `connection_refused` / `validation_error` |
| spinner never resolves / request hangs | `timeout` |
| RTL/vitest assertion failed | `assertion_error` |
| uncaught console exception / hydration error | `assertion_error` (cite the console message) |

For `files_likely_involved`, map the component/module from the stack trace or the failing route's source path under `src/` — not framework/`node_modules` frames.
