# Semantic divergence checklist (Bun Phase C)

Use when reviewing or executing a **mechanical port / language swap / faithful rewrite** — code that is *syntactically parallel* across languages but can diverge in behaviour. Inspired by regressions Bun hit after Zig→Rust: “looks identical, means something else.”

Apply this checklist in:

- `/refactor --mechanical` after canary and before full fan-out  
- Dual `code-reviewer` passes on migrate diffs (`specs/migrate/` in scope)  
- Any bulk rewrite where the oracle is the existing test suite  

## Iron Law

**Same shape ≠ same semantics.** Prefer a failing test or a named checklist finding over “it compiles.”

## High-frequency hazards

### 1. Assert / debug macros with side effects

| Pattern | Trap |
|---------|------|
| Zig `assert(expr)` / C `assert(expr)` | Argument **always evaluates** (function or always-on assert) |
| Rust `debug_assert!(expr)` / C `NDEBUG` | Side effects **erased in release** |

**Review:** if the original assert *did work* (insert, register, mutate), release builds may drop it. Keep the work outside the assert, or use a always-on check.

### 2. Integer / float truncation and rounding

| Pattern | Trap |
|---------|------|
| Toward-zero trunc vs `floor` | Negative non-integers yield different sec/nsec pairs |
| Float → int casts | Saturating vs wrapping vs panic |

**Review:** port time, duration, and index math with explicit rounding mode; add a negative-input case.

### 3. Slice / buffer bounds and odd lengths

| Pattern | Trap |
|---------|------|
| Truncating cast of odd-length byte buffers | One language ignores trailing byte; another panics |
| Off-by-one in block sizes / overflow lists | Lower ceilings become reachable panics in safe languages |

**Review:** odd-length, empty, and max-bound fixtures; do not “fix” by raising silent caps without documenting.

### 4. Comptime / format-string / macro evaluation order

| Pattern | Trap |
|---------|------|
| Comptime format preprocessing | Markers rewritten before args vs after stringification |
| Eager vs lazy `unwrap_or` / default args | Side effects or panics in unused default expressions |

**Review:** port format helpers as macros when the source was comptime; prefer lazy defaults (`unwrap_or_else`, closures).

### 5. Drop / defer / cleanup lifetime

| Pattern | Trap |
|---------|------|
| Explicit `defer` at every call site | Easy to miss error paths → leak or double-free |
| Implicit `Drop` / RAII | Async close after drop → UAF if ownership handed to a runtime |

**Review:** async close / libuv-style callbacks must **leak or transfer** ownership intentionally; error paths must still free exactly once.

### 6. Release vs debug safety

| Pattern | Trap |
|---------|------|
| ReleaseFast / unchecked indexing | Port to safe language panics on paths that “worked” |
| Placeholder constants left from the port | Wrong block sizes, capacities, feature flags |

**Review:** grep for “stand-in”, “Phase B”, magic sizes, and `todo` capacity constants on hot paths.

### 7. Concurrency and GC / manual memory mixes

| Pattern | Trap |
|---------|------|
| Re-entrant JS callbacks during native work | Hashmap rehash invalidates pointers mid-walk |
| GC roots vs manual free | Watchers pinned forever or double-free on close |

**Review:** re-entrancy and “valueOf/toString mutates buffer” cases when bridging GC and native memory.

## How to report findings

Use severity:

- **BLOCK** — reachable behaviour change vs the source language or vs the suite oracle  
- **WARN** — plausible divergence without a concrete failing path yet  
- **INFO** — style-only idiomatic difference with no behaviour impact  

Cite: source language construct → target construct → why semantics differ → fix.

## When *not* to apply

Skip this checklist for ordinary product features, tiny `/vibe` edits, and refactors that do not cross a language or runtime boundary. For those, the normal structure/correctness lenses are enough.
