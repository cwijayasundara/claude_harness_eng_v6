---
name: react-code
description: Build client-side React apps with Vite — useEffect cleanup and stale-closure bugs, dependency-array gotchas, Context vs. server-state libraries for API data, Vite environment variables, and testing with Vitest. Scoped to Vite+React client-side apps — NOT Next.js (App Router/Server Components/Server Actions need different guidance). Triggers on "useEffect", "React hook", "stale closure", "dependency array", "Vite env variable", "React Vitest testing".
---

# React (Vite, client-side)

Sources: https://react.dev/learn/synchronizing-with-effects, https://vite.dev/guide/env-and-mode (fetched 2026-07-07 — re-verify if this content seems stale).

**Scope note:** this skill covers Vite+React client-side SPA patterns. If the project is Next.js (App Router, Server Components, Server Actions), this content does not apply — that's a meaningfully different rendering model needing its own guidance, not covered here.

## Quick Reference

- `references/hooks-and-state.md` — `useEffect` cleanup functions, stale-closure bugs (including the classic fetch-race-condition), dependency-array gotchas, when to reach for Context vs. a server-state library for API data.
- `references/vite-and-testing.md` — Vite environment variables (`VITE_` prefix, `.env` file precedence), and Vitest/React Testing Library basics.

## Gotchas (do not skip)

- **A `useEffect` without a cleanup function leaks whatever it set up** — subscriptions, intervals, event listeners, connections. If the setup has a natural "undo" (`disconnect`, `unsubscribe`, `removeEventListener`, `clearInterval`), the effect needs a cleanup function that calls it.
- **React intentionally double-invokes effects in development (Strict Mode)** — setup → cleanup → setup again. This is deliberately surfacing real cleanup bugs, not a framework bug. If an effect breaks under double-invocation, the cleanup is incomplete.
- **Fetches inside `useEffect` can race** — a slow earlier request can resolve after a faster later one and overwrite it with stale data. Use an `ignore` flag set in the cleanup function to discard results from a superseded effect run (see `references/hooks-and-state.md`).
- **Objects/functions created inline are a new reference every render** — putting one directly in a dependency array causes the effect to re-run every render, not just when the "real" value changes. Move them outside the component or memoize them.
- **Only `VITE_`-prefixed environment variables reach client code.** Anything without that prefix is silently `undefined` in `import.meta.env` — this is a deliberate secret-leakage guard, not a bug to work around.

## Not Yet Covered Here (fetch before relying on these topics)

Next.js-specific rendering (Server Components, Server Actions, the App Router's data-fetching model) is explicitly out of scope for this skill — fetch `https://nextjs.org/docs` fresh rather than assuming Vite+React conventions transfer.
