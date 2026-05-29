# Dependency-tracing reference — Node / TypeScript / JavaScript

Heuristics for tracing structure and dependencies in a Node/TS codebase (read-only).

- **Imports**: ESM `import x from 'y'` / `import {a} from './b'`; CJS `require('y')`. Note the module system from `package.json` `"type"` and file extensions (`.mjs`/`.cjs`). Resolve relative paths; resolve bare specifiers via `node_modules` / `package.json` `exports`.
- **Path aliases**: `tsconfig.json` `compilerOptions.paths`/`baseUrl` and bundler aliases (Vite `resolve.alias`) remap imports — resolve them or the graph will look broken.
- **Dependencies**: `package.json` `dependencies`/`devDependencies`/`peerDependencies`; workspaces (`workspaces`, pnpm/turbo) for monorepos; lockfile pins versions.
- **Entry points**: `package.json` `main`/`module`/`exports`/`bin`; framework entries (`src/main.tsx`, Next `app/`/`pages/`, Express `app.listen`); `scripts` targets.
- **Barrel files**: `index.ts` re-exporting (`export * from './x'`) hides real definition sites and inflates coupling — follow through them.
- **Dynamic imports**: `import()` expressions, `require(variable)`, lazy routes — static-grep blind spots; flag them.
- **Symbols**: prefer LSP (typescript-language-server) for go-to-definition / find-references; fall back to grep for `function name`/`class Name`/`export const name`.
- **Types vs runtime**: `import type` is erased at build — distinguish type-only deps from runtime deps when assessing coupling.
