# Stack reference — React / TypeScript (implementation)

Idiomatic, type-safe, testable patterns for the frontend. These idioms make the code pass the typecheck/lint hooks, the Playwright layer, and the design-critic on the first attempt.

- **TypeScript strict, zero `any`** (the `typecheck` hook blocks on `tsc`). Type every prop, hook return, and API response; prefer discriminated unions for variant state (`{status:'loading'} | {status:'error',msg} | {status:'ok',data}`); use `unknown` + narrowing over `any`.
- **Components**: function components + hooks only; one component per file; obey the Rules of Hooks (no conditional hooks); keep `useEffect` dependency arrays correct and **clean up** (abort fetches, clear timers) to avoid set-state-after-unmount and races (use `AbortController`).
- **Separation** (matches the generated `frontend/CLAUDE.md`): API calls live in `src/api/`, never `fetch` directly inside a component; shared types in `src/types/`. Components render state; the api layer owns I/O.
- **Every async UI handles all states**: loading, error, empty, and success — never just the happy path. A spinner that never resolves or an unhandled rejection is a defect the evaluator will see.
- **Accessibility is functional, not optional**: semantic HTML, real `<button>`/`<label>`/`<form>`, `aria-*` where needed. The evaluator's Playwright layer and the `design-critic` locate elements by **role/label/text** — markup that isn't reachable by `getByRole` is a failure, not a flaky test.
- **Aesthetics**: for `layer: frontend` stories, invoke the `frontend-design` skill and honor `specs/design/mockups/aesthetic-direction.md` — design tokens, not raw hex; avoid generic Tailwind-default look (the `design-critic` scores originality and will send it back).
- **Tests**: `vitest` + React Testing Library; query by **role/label/text**, never CSS selectors or `data-testid` as a crutch; drive with `userEvent`; assert observable behavior (what the user sees), not internal state or component internals; mock at the `src/api/` boundary, not internal hooks. Playwright E2E uses the same semantic locators.

**Full-stack contract:** define the typed contract once and share it — a Pydantic response model whose shape exactly matches the TypeScript interface the frontend consumes. Mismatches here are the #1 source of evaluator 422/shape failures.
