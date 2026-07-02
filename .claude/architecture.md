# Architecture

## Layer Hierarchy

The project follows a strict layered architecture. Dependencies flow **downward only** — a layer may import from layers below it but never from layers above it.

```
┌─────────────┐
│     UI      │  ← Layer 6 (highest)
├─────────────┤
│     API     │  ← Layer 5
├─────────────┤
│   Service   │  ← Layer 4
├─────────────┤
│ Repository  │  ← Layer 3
├─────────────┤
│   Config    │  ← Layer 2
├─────────────┤
│    Types    │  ← Layer 1 (lowest)
└─────────────┘
```

### Layer Definitions

| Layer | Responsibility | May Import From |
|-------|---------------|-----------------|
| Types | Domain models, interfaces, enums, shared type definitions | (none) |
| Config | Environment variables, feature flags, constants, app configuration | Types |
| Repository | Data access, persistence, external data sources | Types, Config |
| Service | Business logic, domain rules, orchestration | Types, Config, Repository |
| API | Route handlers, request/response mapping, middleware, validation | Types, Config, Repository, Service |
| UI | Components, pages, client-side state, rendering | Types, Config, Service, API |

## One-Way Dependency Rule

**Never import from a higher layer.**

Violations:
- A `Service` importing from `API` — FORBIDDEN
- A `Repository` importing from `Service` — FORBIDDEN
- A `Config` importing from `Repository` — FORBIDDEN
- A `Types` importing from any other layer — FORBIDDEN

The `verify-on-save` hook enforces this rule on every file save; the git `pre-commit` gate re-checks staged files. If the layer gate matches no staged source file (the project doesn't follow a `<root>/<layer>/` layout), `pre-commit` warns loudly instead of silently passing — configure or disable the check via `project-manifest.json` (see Customization).

## Verification Commands

### Types layer
```bash
# No imports from Config, Repository, Service, API, or UI
grep -rn "from.*config\|from.*repository\|from.*service\|from.*api\|from.*ui" src/types/
```

### Config layer
```bash
# No imports from Repository, Service, API, or UI
grep -rn "from.*repository\|from.*service\|from.*api\|from.*ui" src/config/
```

### Repository layer
```bash
# No imports from Service, API, or UI
grep -rn "from.*service\|from.*api\|from.*ui" src/repository/
```

### Service layer
```bash
# No imports from API or UI
grep -rn "from.*api\|from.*ui" src/service/
```

### API layer
```bash
# No imports from UI
grep -rn "from.*ui" src/api/
```

### Full architecture audit
```bash
# Run the architecture check hook directly
node .claude/hooks/verify-on-save.js  # per-file; the git pre-commit hook scans staged files
```

## Cross-Cutting Concerns

The following concerns span all layers and are handled via shared utilities, not inline in each layer:

| Concern | Implementation |
|---------|---------------|
| **Logging** | Centralized logger (e.g., `src/lib/logger`) — all layers import from `lib`, not from each other |
| **Authentication** | Auth context passed via dependency injection or middleware; never hardcoded per-layer |
| **Telemetry** | Instrumentation via a shared `src/lib/telemetry` module with span/trace helpers |
| **Error Handling** | Typed error classes in `Types`; caught and mapped at `API` boundary; never swallowed silently |

## Bounded Contexts (Vertical Boundaries)

The layer check is horizontal; bounded contexts are its vertical complement. Two contexts (e.g., `src/billing`, `src/user`) may not reach into each other's internals — a cross-context import is allowed only via the target's public surface (its root, `index`, `public`, or `__init__`) or an explicit allow-edge.

This check is **opt-in**: it runs only when `project-manifest.json` declares `architecture.contexts` (see Customization). Both `verify-on-save` and the git `pre-commit` gate enforce it, after the layer check.

## Customization

Layer names, source roots, and bounded contexts are configured via the `architecture` block of `project-manifest.json` in the project root. Without a manifest (or without an `architecture` block), the defaults above apply: layers `types → config → repository → service → api → ui` under `src/`.

```json
{
  "architecture": {
    "layers": ["domain", "application", "infrastructure", "presentation"],
    "layer_roots": ["src", "backend/src"],
    "contexts": {
      "roots": ["src/billing", "src/user"],
      "allow": [["billing", "user"]],
      "public": ["index", "public", "__init__"]
    }
  }
}
```

- `layers` — layer names in order, **lowest to highest**; a layer may import only from layers earlier in the list.
- `layer_roots` — directories scanned for `<root>/<layer>/` paths (default `["src"]`).
- `contexts` — optional bounded-context rules: `roots` name the context directories, `allow` lists permitted cross-context edges (`["billing", "user"]` = billing may import user's internals), `public` overrides the default public-surface names.

To **disable** the layer check entirely — the right default for libraries, CLIs, data pipelines, and ML projects that don't follow a layered hierarchy — set `"architecture": { "enabled": false }` (or `"layers": []`). `/scaffold` sets this automatically for those project shapes.
