# Vite Environment Variables and Testing with Vitest

Source: https://vite.dev/guide/env-and-mode (fetched 2026-07-07 — re-verify if this content seems stale). The Vitest/React Testing Library section below states only long-stable, version-independent conventions — it was not backed by a detailed fresh fetch this session (the official Vitest getting-started guide doesn't cover React-specific setup); verify against `https://testing-library.com/docs/react-testing-library/intro/` if anything here seems off.

## Environment Variables

Vite exposes env data via `import.meta.env`, statically replaced at build time (which is what makes tree-shaking of unused branches work):

```js
if (import.meta.env.DEV) {
  console.log('dev mode');
}
```

Built-in constants: `import.meta.env.MODE`, `.BASE_URL`, `.PROD`, `.DEV`, `.SSR`.

**Only `VITE_`-prefixed variables reach client code** — this is a deliberate guard against accidentally bundling secrets into client-shipped JavaScript:

```
# .env
VITE_PUBLIC_KEY=abc123
SECRET_API_KEY=confidential
```

```js
import.meta.env.VITE_PUBLIC_KEY  // "abc123"
import.meta.env.SECRET_API_KEY   // undefined — not exposed
```

## `.env` File Precedence (later overrides earlier)

1. `.env` — all contexts
2. `.env.local` — all contexts, git-ignored
3. `.env.[mode]` — mode-specific (e.g. `.env.staging`)
4. `.env.[mode].local` — mode-specific, git-ignored

## Gotchas

- **Env values are strings.** A variable set to `"false"` is still a truthy non-empty string in JS — convert explicitly (`import.meta.env.VITE_FLAG === "true"`), don't rely on implicit boolean coercion.
- **Changing `.env` requires a dev-server restart** — values are read once at startup, not watched for changes.
- **`NODE_ENV` and Vite's `mode` are separate concepts.** A production build can still run under a custom mode (e.g. `vite build --mode staging`), and mode-specific `.env` files are keyed by that mode name, not by `NODE_ENV`.
- **Add a `vite-env.d.ts`** to get TypeScript IntelliSense for custom `VITE_*` variables without losing type safety on the rest of `import.meta.env`.

## Testing with Vitest + React Testing Library (established conventions)

Vitest reads the project's existing `vite.config.*` by default, so Vite plugins/aliases already configured for the app apply to tests too. For component tests, configure the `jsdom` (or `happy-dom`) test environment — either globally in `vite.config.ts`'s `test.environment` field, or per-file with a `// @vitest-environment jsdom` comment.

```jsx
import { render, screen } from '@testing-library/react';
import { test, expect } from 'vitest';
import { Greeting } from './Greeting';

test('renders a greeting', () => {
  render(<Greeting name="Ada" />);
  expect(screen.getByText('Hello, Ada')).toBeInTheDocument();
});
```

**Common gotchas:**
- State updates triggered outside of an explicit user-interaction helper (e.g. a `useEffect` firing after mount) can produce an `act()` warning if not awaited — prefer `@testing-library/user-event` for interactions and `findBy*`/`waitFor` queries (which internally wrap updates in `act()`) over manually triggering DOM events.
- Query by role/text/label (`getByRole`, `getByText`) rather than by test IDs or CSS selectors where practical — it more closely matches how a user actually perceives the UI, and is more resilient to markup refactors that don't change behavior.
- Async data fetching in a component under test needs an async query (`findByText`, or `await waitFor(...)`) — a synchronous `getByText` immediately after `render()` will not see data that arrives after a fetch resolves.
