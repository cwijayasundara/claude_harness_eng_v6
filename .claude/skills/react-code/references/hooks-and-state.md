# useEffect Cleanup, Stale Closures, and Dependency Arrays

Source: https://react.dev/learn/synchronizing-with-effects (fetched 2026-07-07 — re-verify if this content seems stale)

## Cleanup Functions — What and Why

A cleanup function is the optional value `useEffect`'s callback returns. It runs before the effect re-runs, and on unmount. Effects that create something (a subscription, a timer, a connection) almost always need a cleanup that undoes it:

| Setup | Cleanup |
|---|---|
| `connect()` | `disconnect()` |
| `subscribe()` | `unsubscribe()` |
| `addEventListener()` | `removeEventListener()` |
| `setInterval()` | `clearInterval()` |
| `showModal()` | `close()` |

```jsx
// Without cleanup — a new interval is created every time this effect re-runs,
// and the old one is never cleared.
useEffect(() => {
  const id = setInterval(() => setCount(c => c + 1), 1000);
}, []);

// With cleanup — correct.
useEffect(() => {
  const id = setInterval(() => setCount(c => c + 1), 1000);
  return () => clearInterval(id);
}, []);
```

## Stale-Closure Bug: the Fetch Race Condition

This is the single most common real-world `useEffect` bug:

```jsx
// BAD — a slow earlier request can resolve after a faster later one
useEffect(() => {
  fetchBio(person).then(result => {
    setBio(result);   // could be stale by the time this runs
  });
}, [person]);
```

Sequence: select "Alice" → fetch starts. Quickly select "Bob" → a second fetch starts. If Alice's slower response arrives *after* Bob's, the UI ends up showing Alice's bio while `person` state says "Bob".

```jsx
// GOOD — the cleanup function marks a superseded effect run as stale
useEffect(() => {
  let ignore = false;
  fetchBio(person).then(result => {
    if (!ignore) {
      setBio(result);
    }
  });
  return () => { ignore = true; };
}, [person]);
```

**Anti-pattern to avoid:** using a `ref` to skip re-running setup instead of writing a real cleanup function. This hides the underlying bug rather than fixing it — the connection/subscription never actually gets torn down when the component unmounts, it just avoids being *recreated*.

## Dependency Array Gotchas

- **Missing a dependency the effect actually reads** silently breaks the effect for that value's changes — e.g. an effect that reads `isPlaying` but has `[]` as its dependency array will never react to `isPlaying` changing again after mount.
- **Empty `[]` = run once on mount.** No array at all = run after *every* render. `[a, b]` = run on mount and whenever `a` or `b` changes. These are meaningfully different, not stylistic variants.
- **Inline objects/functions are a new reference every render.** `useEffect(() => subscribe(options), [options])` where `options = { timeout: 1000 }` is defined inline re-runs the effect every single render, because `options` is never `===` to the previous render's `options`. Move the object outside the component (if it's truly static) or otherwise avoid depending on a freshly-created reference each render.
- **Refs are stable across renders and are safe to omit** from the dependency array — including them is not wrong, but omitting them is the common convention since a ref's identity never changes.

## Context vs. a Server-State Library — Decision Rule

- **Local UI state that doesn't need to survive a refetch or be shared across unrelated parts of the tree** (a toggle, a form field, a modal's open/closed state): plain `useState`, or `useContext` if it needs to be shared a few levels down without prop-drilling.
- **Data that came from an API** (a list of items, a user profile fetched by ID): don't just stash it in Context and call it done. Context has no built-in caching, deduplication, revalidation, or loading/error state — you'd be reimplementing all of that by hand. A dedicated server-state library (e.g. TanStack Query) gives you caching, automatic refetch, and race-condition handling (the exact bug above) for free.
- **The dividing line:** if the data's source of truth lives on a server and the UI is a read-through cache of it, treat it as server state, not client state — even if it's technically stored in a `useState` somewhere.
