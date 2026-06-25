#!/usr/bin/env node

'use strict';

// scaffold-render.js — pure (no-FS-write) helpers for scaffold-apply.js.
// Builds the manifest object, derives LSP servers, and renders templates.
// Kept separate from scaffold-apply.js to honour the one-responsibility rule
// and the per-file line cap. See scaffold-apply.js for the profile schema.

const LSP_TABLE = {
  python: { server: 'pyright', binary: 'pyright', install: 'npm i -g pyright' },
  typescript: {
    server: 'typescript-language-server',
    binary: 'typescript-language-server',
    install: 'npm i -g typescript-language-server typescript',
  },
  javascript: {
    server: 'typescript-language-server',
    binary: 'typescript-language-server',
    install: 'npm i -g typescript-language-server typescript',
  },
  go: { server: 'gopls', binary: 'gopls', install: 'go install golang.org/x/tools/gopls@latest' },
  rust: { server: 'rust-analyzer', binary: 'rust-analyzer', install: 'rustup component add rust-analyzer' },
};

function lspServers(profile) {
  const stack = profile.stack || {};
  const langs = new Set();
  if (Array.isArray(profile.lsp)) {
    for (const e of profile.lsp) if (e && e.language) langs.add(String(e.language).toLowerCase());
  }
  for (const part of [stack.backend, stack.frontend]) {
    if (part && part.language) langs.add(String(part.language).toLowerCase());
  }
  const servers = [];
  for (const lang of langs) {
    const t = LSP_TABLE[lang];
    if (t) servers.push({ language: lang === 'javascript' ? 'typescript' : lang, ...t });
  }
  return servers;
}

function verificationBlock(mode) {
  if (mode === 'B') {
    return {
      mode: 'local',
      local: { backend_url: 'http://localhost:8000', frontend_url: 'http://localhost:3000', start_commands: [] },
    };
  }
  if (mode === 'C') {
    return {
      mode: 'stub',
      stub: { schema_source: 'specs/design/api-contracts.schema.json', auto_generate_mock_server: true },
    };
  }
  return { mode: 'docker', docker: { compose_file: 'docker-compose.yml', services: ['backend', 'frontend'] } };
}

function evaluationBlock() {
  return {
    api_base_url: 'http://localhost:8000',
    ui_base_url: 'http://localhost:3000',
    health_check: '/health',
    design_score_threshold: 7,
    design_max_iterations: 10,
    test_corpus_dir: 'specs/test_artefacts',
  };
}

function buildManifest(profile) {
  const stack = profile.stack || {};
  // Lite-shaped = CLI / library / single-script (projectType D) or any non-web
  // stack. These projects don't earn full-stack ceremony, so default them to the
  // cheaper cost posture: Sonnet generation (cost tier), single-story groups skip
  // sprint decomposition (trimmed ceremony), and no Docker deploy phase (local
  // verification). Each default is still overridable by an explicit profile field.
  const lite = isLiteShaped(profile);
  const manifest = {
    name: profile.name || 'untitled-project',
    description: profile.description || '',
    stack: { backend: stack.backend || null, frontend: stack.frontend || null, database: stack.database || null },
    lsp: { servers: lspServers(profile) },
    evaluation: evaluationBlock(),
    execution: {
      default_mode: 'full', model_tier: profile.modelTier || (lite ? 'cost' : 'balanced'),
      ceremony: profile.ceremony || (lite ? 'trimmed' : 'full'),
      session_chaining: true, teammate_model: 'sonnet',
    },
    verification: verificationBlock(profile.verificationMode || (lite ? 'B' : undefined)),
  };
  if (Array.isArray(profile.frameworkPacks) && profile.frameworkPacks.length) {
    manifest.framework_skill_packs = profile.frameworkPacks;
  }
  if (lite) {
    manifest.architecture = { enabled: false };
  }
  return manifest;
}

function stackSummary(profile) {
  const b = (profile.stack && profile.stack.backend) || null;
  if (!b) return 'custom stack';
  return [b.language, b.version, b.package_manager, b.linter, b.typechecker, b.test_runner]
    .filter(Boolean).join(' · ');
}

function lspInstallLines(servers) {
  if (!servers.length) {
    return '- (no LSP servers configured — add to project-manifest.json lsp.servers if needed)';
  }
  return servers.map((s) => `- \`${s.install}\` — ${s.language} (${s.server})`).join('\n');
}

// CLAUDE.md template uses plain-text placeholders, not {{X}} markers.
function renderClaudeMd(templateBody, profile) {
  const servers = lspServers(profile);
  const verify = servers.length
    ? servers.map((s) => `${s.binary} --version`).join(' && ')
    : 'echo "no LSP servers configured"';
  return templateBody
    .replace('{project-name}', profile.name || 'untitled-project')
    .replace('{description from user input}', profile.description || stackSummary(profile))
    .replace('{lsp_install_commands}', lspInstallLines(servers))
    .replace('{lsp_verify_command}', verify);
}

function backendInstall(profile) {
  const b = (profile.stack && profile.stack.backend) || null;
  if (!b) return '';
  const pm = (b.package_manager || '').toLowerCase();
  if (pm === 'uv') return 'cd backend && uv sync && cd ..';
  if (pm === 'npm') return 'cd backend && npm ci && cd ..';
  return '';
}

function lspHealthChecks(servers) {
  if (!servers.length) {
    return 'echo "  (no LSP servers configured — add to project-manifest.json lsp.servers if needed)"';
  }
  return servers.map((s) => [
    `if command -v ${s.binary} &>/dev/null; then`,
    `  echo "  ✓ ${s.server} ($(${s.binary} --version 2>/dev/null || echo 'version unknown'))"`,
    'else',
    `  echo "  ✗ ${s.server} not found — install with: ${s.install}"`,
    'fi',
  ].join('\n'));
}

function initShValues(profile) {
  const v = profile.verificationMode;
  return {
    BACKEND_INSTALL: backendInstall(profile),
    FRONTEND_INSTALL: profile.stack && profile.stack.frontend ? 'cd frontend && npm ci && cd ..' : '',
    DOCKER_COMPOSE_CMD: v === 'A' ? 'docker compose up -d --build' : 'echo "  (no docker compose step)"',
    LSP_HEALTH_CHECKS: lspHealthChecks(lspServers(profile)),
    HEALTH_CHECKS: v === 'C'
      ? 'echo "  (stub mode — no health checks)"'
      : 'echo "  (add curl health checks from project-manifest.json evaluation.* here)"',
  };
}

// Replace every {{KEY}} from values; any unresolved {{X}} collapses to ''.
function renderTemplate(body, values) {
  return body.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : '');
}

const PROJECT_TYPE_LABELS = {
  A: 'Consumer-facing app (high design bar)',
  B: 'Internal tool / dashboard',
  C: 'API-only / backend service (no UI)',
  D: 'Minimal — CLI / library / single-script',
};

// Mirrors buildManifest's `lite` signal so the README describes the same posture
// the manifest was stamped with.
function isLiteShaped(profile) {
  const stack = profile.stack || {};
  return profile.projectType === 'D' || (!stack.frontend && !stack.backend);
}

// Values for the project-tailored SCAFFOLD_README.md (project-readme.template.md).
function projectReadmeValues(profile) {
  const name = profile.name || 'untitled-project';
  const lite = isLiteShaped(profile);
  const tier = profile.modelTier || (lite ? 'cost' : 'balanced');
  const start = lite
    ? `/build --lite "${name}: ${profile.description || stackSummary(profile)}"   # interactive\n`
      + '/build --lite --auto docs/prd.md                # headless: small PRD -> PR'
    : '/build docs/prd.md            # gated: approve BRD, stories, design, then build\n'
      + '/build docs/prd.md --auto     # headless: PRD -> PR, zero approval gates';
  const posture = lite
    ? `${tier} (Sonnet generation) · trimmed ceremony · local verification`
    : `${tier} (Opus generation) · full ceremony · docker verification`;
  return {
    PROJECT_NAME: name,
    STACK_SUMMARY: stackSummary(profile),
    PROJECT_TYPE_LABEL: PROJECT_TYPE_LABELS[profile.projectType] || 'Custom project',
    POSTURE: posture,
    MODEL_TIER: tier,
    RECOMMENDED_START: start,
  };
}

function renderProjectReadme(templateBody, profile) {
  return renderTemplate(templateBody, projectReadmeValues(profile));
}

function calibrationProfile(projectType) {
  if (projectType === 'C' || projectType === 'D') return null;
  const consumer = projectType === 'A';
  return {
    scoring: {
      weights: consumer
        ? { design_quality: 1.5, originality: 1.5, craft: 1.5, functionality: 1.0 }
        : { design_quality: 0.75, originality: 0.5, craft: 0.5, functionality: 1.5 },
      threshold: consumer ? 8 : 6,
      per_criterion_minimum: consumer ? 5 : 4,
    },
    iteration: { max_iterations: consumer ? 10 : 5, plateau_window: 3, plateau_delta: 0.3, pivot_after_plateau: consumer },
  };
}

module.exports = {
  lspServers, buildManifest, renderClaudeMd, renderTemplate, initShValues, calibrationProfile,
  renderProjectReadme,
};
