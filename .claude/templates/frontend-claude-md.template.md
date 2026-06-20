# Frontend

## Test & Lint Commands (run from this directory)

- `npm test` — run tests
- `npm run lint` — lint
- `npm run typecheck` — type check

## Conventions

- Components in `src/components/` — one component per file
- API client calls in `src/api/` — never call fetch directly from components
- Shared types in `src/types/`
- No `any` types — use `unknown` and narrow
