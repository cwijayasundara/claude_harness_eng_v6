'use strict';

// The dependency manifests and tool config a greenfield project needs before
// any story can run — emitted deterministically instead of written by an agent.
//
// Why this exists. In the 2026-08-21 sprint-1 baseline the first story, E1-S1
// ("Register and sign in with a hashed, non-logged credential"), was a clean
// four-criterion story marked `small`. Its SPAWN PROMPT was not: "Nothing
// exists yet in backend/ or frontend/ except a CLAUDE.md each — you are
// bootstrapping both projects' skeletons as part of this story", with
// `backend/pyproject.toml and uv project files (bootstrap)` in its file
// ownership. It ran 208 turns, grew from 18K to 324K of context, and cost
// $16.87 by itself.
//
// The story was never the problem. In a greenfield repo the first story
// inevitably absorbs project bootstrap because nothing else does it — and
// bootstrap is the most templatable work in the whole build. Framework choice
// and tool config (ruff, mypy, pytest, tsconfig, eslint, vitest) is boilerplate
// an LLM re-derives at conversational prices, one turn at a time.
//
// What stays with the stories: DOMAIN dependencies. A story that needs
// argon2-cffi or asyncpg adds it. This module emits only the framework and
// tooling floor, and never overwrites a manifest that already exists — so a
// re-scaffold cannot discard what a story added.

const BACKEND = {
  'python/fastapi': {
    dir: 'backend',
    manifest: 'pyproject.toml',
    // Floors, not pins: `uv sync` resolves the newest compatible set, and the
    // committed lockfile is what makes the build reproducible.
    dependencies: [
      'fastapi>=0.115.0',
      'pydantic-settings>=2.5.0',
      'pydantic[email]>=2.9.0',
      'uvicorn[standard]>=0.30.0',
    ],
    dev: [
      'httpx>=0.27.0',
      'mypy>=1.11.0',
      'pytest>=8.3.0',
      'pytest-asyncio>=0.24.0',
      'ruff>=0.6.0',
    ],
  },
};

const FRONTEND = {
  'typescript/react': {
    dir: 'frontend',
    manifest: 'package.json',
    dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' },
    dev: {
      '@types/node': '^20.14.0',
      '@types/react': '^19.0.0',
      '@vitejs/plugin-react': '^4.3.0',
      '@vitest/coverage-v8': '^2.1.0',
      eslint: '^9.17.0',
      typescript: '^5.6.0',
      'typescript-eslint': '^8.18.0',
      vite: '^5.4.0',
      vitest: '^2.1.0',
    },
    scripts: {
      dev: 'vite', build: 'tsc --noEmit && vite build', preview: 'vite preview',
      lint: 'eslint .', typecheck: 'tsc --noEmit', test: 'vitest run',
    },
    envDts: '/// <reference types="vite/client" />\n',
  },
  'typescript/next': {
    dir: 'frontend',
    manifest: 'package.json',
    dependencies: { next: '^15.0.0', react: '^19.0.0', 'react-dom': '^19.0.0' },
    dev: {
      '@types/node': '^20.14.0',
      '@types/react': '^19.0.0',
      '@vitest/coverage-v8': '^2.1.0',
      eslint: '^9.17.0',
      typescript: '^5.6.0',
      'typescript-eslint': '^8.18.0',
      vitest: '^2.1.0',
    },
    scripts: {
      dev: 'next dev', build: 'next build', start: 'next start',
      lint: 'eslint .', typecheck: 'tsc --noEmit', test: 'vitest run',
    },
    envDts: '/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n',
  },
};

// Everything below [tool.uv] is fixed policy, not a per-project choice, so it
// is a constant rather than something the template function assembles.
const PY_TOOL_CONFIG = `[tool.uv]
package = false

[tool.pytest.ini_options]
asyncio_mode = "auto"
asyncio_default_fixture_loop_scope = "session"
testpaths = ["tests"]

[tool.ruff]
line-length = 100
src = ["src"]

[tool.ruff.lint]
select = ["E", "F", "I", "UP"]

[tool.mypy]
python_version = "3.12"
strict = true
explicit_package_bases = true
`;

function keyOf(part) {
  if (!part) return null;
  const lang = String(part.language || '').toLowerCase();
  const fw = String(part.framework || '').toLowerCase();
  return lang && fw ? `${lang}/${fw}` : null;
}

/**
 * Which bootstraps a profile calls for. An unrecognised stack yields nothing
 * rather than a guess — emitting a wrong pyproject.toml is worse than emitting
 * none, because a story would then have to detect and undo it.
 */
function plan(profile) {
  const stack = (profile && profile.stack) || {};
  const out = [];
  const back = BACKEND[keyOf(stack.backend)];
  if (back) out.push({ ...back, part: 'backend' });
  const front = FRONTEND[keyOf(stack.frontend)];
  if (front) out.push({ ...front, part: 'frontend' });
  return out;
}

function tomlList(items) {
  return items.map((d) => `    "${d}",`).join('\n');
}

function pyprojectFor(spec, name) {
  return `[project]
name = "${spec.dir}"
version = "0.1.0"
description = "${name} ${spec.dir}"
requires-python = ">=3.12"
dependencies = [
${tomlList(spec.dependencies)}
]

[dependency-groups]
dev = [
${tomlList(spec.dev)}
]

${PY_TOOL_CONFIG}`;
}

function packageJsonFor(spec) {
  return `${JSON.stringify({
    name: spec.dir,
    version: '0.1.0',
    private: true,
    type: 'module',
    scripts: spec.scripts,
    dependencies: spec.dependencies,
    devDependencies: spec.dev,
  }, null, 2)}\n`;
}

const TSCONFIG = `${JSON.stringify({
  compilerOptions: {
    target: 'ES2022',
    lib: ['ES2022', 'DOM', 'DOM.Iterable'],
    module: 'ESNext',
    moduleResolution: 'bundler',
    jsx: 'react-jsx',
    strict: true,
    noUncheckedIndexedAccess: true,
    noEmit: true,
    esModuleInterop: true,
    skipLibCheck: true,
    resolveJsonModule: true,
    baseUrl: '.',
    paths: { '@/*': ['./src/*'] },
  },
  include: ['src', 'tests'],
}, null, 2)}\n`;

const VITEST_CONFIG = `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
    coverage: { provider: 'v8', reporter: ['text', 'lcov'] },
  },
});
`;

const ESLINT_CONFIG = `import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { ignores: ['dist', 'coverage', '.next'] },
);
`;

/**
 * Files a bootstrap spec contributes, as {relativePath: contents}.
 * Pure: the caller decides what to write and what already exists.
 */
function filesFor(spec, projectName) {
  if (spec.manifest === 'pyproject.toml') {
    return {
      [`${spec.dir}/pyproject.toml`]: pyprojectFor(spec, projectName || spec.dir),
      [`${spec.dir}/src/__init__.py`]: '',
      [`${spec.dir}/tests/__init__.py`]: '',
    };
  }
  return {
    [`${spec.dir}/package.json`]: packageJsonFor(spec),
    [`${spec.dir}/tsconfig.json`]: TSCONFIG,
    [`${spec.dir}/vitest.config.ts`]: VITEST_CONFIG,
    [`${spec.dir}/eslint.config.mjs`]: ESLINT_CONFIG,
    // tsconfig `include` names src and tests, and tsc fails TS18003 when an
    // included path has no inputs — so a bootstrap without this leaves a
    // project whose own `typecheck` script errors on turn one. The reference
    // file is the framework's standard ambient-types shim, not product code.
    [`${spec.dir}/src/env.d.ts`]: spec.envDts,
  };
}

/** The install that warms the toolchain, per spec. */
function installCommand(spec) {
  return spec.manifest === 'pyproject.toml'
    ? { cwd: spec.dir, command: 'uv', args: ['sync', '--all-groups'] }
    : { cwd: spec.dir, command: 'npm', args: ['install', '--no-audit', '--no-fund'] };
}

module.exports = {
  BACKEND, FRONTEND, keyOf, plan, filesFor, installCommand,
  pyprojectFor, packageJsonFor, TSCONFIG, VITEST_CONFIG, ESLINT_CONFIG, PY_TOOL_CONFIG,
};
