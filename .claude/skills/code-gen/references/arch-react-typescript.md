# Architecture reference — React / TypeScript

Conventions for designing a React + TypeScript frontend's structure and contracts. Use when planning architecture for a React stack.

- **Layering / folders** (matches the generated `frontend/CLAUDE.md`): `src/components/` (one component per file, presentational + container), `src/api/` (the only place network I/O happens), `src/types/` (shared types), `src/hooks/`, `src/routes`/pages. Components never call `fetch` directly.
- **Build/stack**: Vite (SPA) or Next.js (SSR/RSC) per requirements; TypeScript strict; design tokens (Tailwind config / CSS vars), not raw hex.
- **Typed API client mirrors the backend**: the `src/api/` client returns types in `src/types/` whose shapes **exactly match** the backend Pydantic response models. Plan one source of truth for the contract (shared schema) so a backend change surfaces as a frontend type error.
- **State strategy**: local state by default; lift to context/store only when shared; server state via a data-fetching layer (react-query or hand-rolled in `src/api/`) with loading/error/empty/success modeled explicitly (discriminated unions).
- **Routing**: define routes and their data dependencies; auth-gated routes guard before render.
- **Accessibility by design**: semantic structure so the design-critic and Playwright can locate by role/label — plan headings, landmarks, labelled controls.
- **Component map**: assign each UI story to component/api/type files; mark `Produces:`/`Consumes:` at the TypeScript-interface boundary.
