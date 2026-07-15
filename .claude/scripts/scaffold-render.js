#!/usr/bin/env node

'use strict';

// scaffold-render.js — pure (no-FS-write) helpers for scaffold-apply.js.
// Builds the manifest object, derives LSP servers, and renders templates.
// Kept separate from scaffold-apply.js to honour the one-responsibility rule
// and the per-file line cap. See scaffold-apply.js for the profile schema.

const { resolveTopology, topologyPreset } = require('./topologies.js');

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

// G9: app-level observability baseline. `enabled` is decided by the topology
// preset (G10) AND-ed with the presence of a backend to instrument.
function observabilityBlock(enabled) {
  return {
    enabled: !!enabled,
    metrics_path: '/metrics',
    red_labels: ['method', 'route', 'status'],
    slo: { error_rate_pct: 1.0, p95_ms: 500 },
  };
}

function tokenGovernorBlock() {
  return {
    enabled: true,
    mode: 'enforced',
    living_navigation: true,
    context_search_required: true,
    max_source_read_lines: 300,
    tool_output_token_estimates: true,
    compress_tool_output: true,
    ccr_enabled: true,
    preserve_full_outputs: true,
    budget_warn_pct: 80,
  };
}

// Auto-attaches tech-stack specialty packs based on the chosen stack, additive
// to whatever the user explicitly picked (docs/superpowers/specs/2026-07-07-
// python-react-specialty-pack-design.md). Must be the single place this
// derivation happens — both the manifest (below) and the actual skill copy
// (scaffold-apply.js) call this same function, so what gets recorded and what
// gets copied can never diverge.
function deriveFrameworkPacks(profile) {
  const explicit = Array.isArray(profile.frameworkPacks) ? profile.frameworkPacks : [];
  const derived = new Set(explicit);
  const stack = profile.stack || {};
  if (stack.backend && stack.backend.framework === 'fastapi') derived.add('fastapi-code');
  if (stack.frontend && stack.frontend.framework === 'react') derived.add('react-code');
  return Array.from(derived);
}

function attachPacksToManifest(manifest, profile) {
  const frameworkPacks = deriveFrameworkPacks(profile);
  if (frameworkPacks.length) {
    manifest.framework_skill_packs = frameworkPacks;
  }
  if (Array.isArray(profile.domainVerticalPacks) && profile.domainVerticalPacks.length) {
    manifest.domain_vertical_packs = profile.domainVerticalPacks;
  }
}

// Default sensor tier (PR4 / operability dial). cli-or-library and other lite
// shapes get minimal; product apps get standard. Explicit profile.sensorTier wins.
function defaultSensorTier(profile, topology) {
  const explicit = profile.sensorTier || (profile.quality && profile.quality.sensor_tier);
  if (explicit === 'minimal' || explicit === 'standard' || explicit === 'strict') return explicit;
  if (topology === 'cli-or-library') return 'minimal';
  return 'standard';
}

function qualityBlock(profile, topology) {
  const quality = {
    sensor_tier: defaultSensorTier(profile, topology),
    agent_readiness: {
      mode: 'report',
      min_active_pillars: 3,
      forbid_regression: false,
    },
  };
  // Preserve optional mutation / drift knobs if the profile already carries them
  // (interactive scaffold interview or re-scaffold).
  if (profile.quality && typeof profile.quality === 'object') {
    if (profile.quality.mutation) quality.mutation = profile.quality.mutation;
    if (profile.quality.drift) quality.drift = profile.quality.drift;
  }
  return quality;
}

function buildManifest(profile) {
  const stack = profile.stack || {};
  const lite = isLiteShaped(profile);
  const topology = resolveTopology(profile, lite);
  const preset = topologyPreset(topology);
  const manifest = {
    name: profile.name || 'untitled-project',
    description: profile.description || '',
    stack: { backend: stack.backend || null, frontend: stack.frontend || null, database: stack.database || null },
    lsp: { servers: lspServers(profile) },
    evaluation: evaluationBlock(),
    execution: {
      default_mode: 'full',
      model_tier: profile.modelTier || preset.model_tier,
      ceremony: profile.ceremony || preset.ceremony,
      session_chaining: true, teammate_model: 'sonnet',
    },
    verification: verificationBlock(profile.verificationMode || preset.verification_mode),
    topology,
    quality: qualityBlock(profile, topology),
    token_governor: tokenGovernorBlock(),
  };
  manifest.observability = observabilityBlock(preset.observability_enabled && !!stack.backend);
  attachPacksToManifest(manifest, profile);
  if (preset.architecture) {
    manifest.architecture = preset.architecture;
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
  if (profile.projectType === 'D') return true;
  if (profile.projectType === 'C') return false;
  if (stack.frontend || stack.database) return false;
  if (!stack.backend) return true;
  const text = `${profile.name || ''} ${profile.description || ''}`.toLowerCase();
  const hasSmallSurface = /\b(cli|library|script|tool|utility|agent)\b/.test(text);
  return hasSmallSurface || !stack.backend.framework;
}

// Values for the project-tailored SCAFFOLD_README.md (project-readme.template.md).
function projectReadmeValues(profile) {
  const name = profile.name || 'untitled-project';
  const lite = isLiteShaped(profile);
  // Product default is cost tier (enterprise Token Saver); profile may override.
  const tier = profile.modelTier || 'cost';
  const start = lite
    ? `/build --lite "${name}: ${profile.description || stackSummary(profile)}"   # interactive\n`
      + '/build --lite --auto docs/prd.md                # headless: small PRD -> PR'
    : '/build docs/prd.md            # gated: approve BRD, stories, design, then build\n'
      + '/build docs/prd.md --auto     # headless: PRD -> PR, zero approval gates';
  // Generation is Sonnet on cost/balanced; only max-quality bumps generator to Opus.
  const genLabel = tier === 'max-quality' ? 'Opus generation' : 'Sonnet generation';
  const posture = lite
    ? `${tier} (${genLabel}) · trimmed ceremony · local verification`
    : `${tier} (${genLabel}) · full ceremony · docker verification`;
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
  renderProjectReadme, deriveFrameworkPacks, defaultSensorTier, qualityBlock,
};
