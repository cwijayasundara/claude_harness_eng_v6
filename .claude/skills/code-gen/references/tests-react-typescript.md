# Test authoring reference — React / TypeScript (vitest + RTL)

Idioms for unit/component/integration tests on the frontend. (E2E stays Playwright — cross-stack, see the agent's Playwright section.)

- **Runner**: `vitest` + React Testing Library + `@testing-library/jest-dom` matchers, `jsdom` environment. Co-locate `Component.test.tsx` next to the component.
- **Query by accessibility, in order**: `getByRole` (with `name`) → `getByLabelText` → `getByText`. Never CSS selectors; `getByTestId` only as a last resort. If you can't query by role, that's a real a11y/markup defect, not a reason to reach for test-ids.
- **Drive with `userEvent`** (not `fireEvent`) to simulate real interaction; `await` it.
- **Async UI**: `findBy*` / `await waitFor(...)` for appearing content; assert loading → resolved transitions; assert error and empty states, not just success.
- **Mock at the `src/api/` boundary**, not internal hooks/components: `vi.mock('../api/users')` or **MSW** (`setupServer`) to stub HTTP. Test the component's observable behavior given a response, not its internals.
- **Behavior, not internals**: assert what the user sees/can do; avoid snapshotting large trees (brittle) and asserting state/props directly.
- **Types in tests too**: no `any`; type mock return values to match the real API contract so a backend shape change breaks the test (good).
- **Cleanup**: RTL auto-cleans the DOM; reset mocks between tests (`vi.clearAllMocks()` / `restoreMocks: true`).
