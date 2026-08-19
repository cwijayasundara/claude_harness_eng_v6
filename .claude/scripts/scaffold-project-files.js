#!/usr/bin/env node

'use strict';

// Files /scaffold used to hand-write after apply (module CLAUDE.md, CODEBASE_MAP,
// mutation starters, model-tier pins, git hooksPath). One writer so the command
// is: confirm profile → run apply → report. Do not grow scaffold-apply.js.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { applyTier, normalizePreset } = require('./model-tier');

function hasFrontend(profile) {
  return !!(profile.stack && profile.stack.frontend);
}

function hasBackend(profile) {
  return !!(profile.stack && profile.stack.backend);
}

function langOf(part) {
  return String((part && part.language) || '').toLowerCase();
}

function mutationSpec(profile) {
  const back = langOf(profile.stack && profile.stack.backend);
  const front = langOf(profile.stack && profile.stack.frontend);
  if (back === 'python') {
    return { tool: 'mutmut', config_file: 'pyproject.toml', critical_globs: [] };
  }
  if ([back, front].some((l) => l === 'typescript' || l === 'javascript')) {
    return { tool: 'stryker', config_file: 'stryker.conf.json', critical_globs: [] };
  }
  return null;
}

function writeModuleClaude(target, src, profile) {
  const written = [];
  if (!hasBackend(profile) || !hasFrontend(profile)) return written;
  const map = [
    ['templates/backend-claude-md.template.md', 'backend/CLAUDE.md'],
    ['templates/frontend-claude-md.template.md', 'frontend/CLAUDE.md'],
  ];
  for (const [from, to] of map) {
    const fromPath = path.join(src, from);
    if (!fs.existsSync(fromPath)) continue;
    const toPath = path.join(target, to);
    fs.mkdirSync(path.dirname(toPath), { recursive: true });
    fs.copyFileSync(fromPath, toPath);
    written.push(toPath);
  }
  return written;
}

function writeCodebaseMap(target, src, profile) {
  const from = path.join(src, 'templates/codebase-map.template.md');
  if (!fs.existsSync(from)) return null;
  let body = fs.readFileSync(from, 'utf8');
  if (hasBackend(profile) && hasFrontend(profile)) {
    body = body.replace(
      '| `src/` | Application source code |',
      '| `backend/` | API service |\n| `frontend/` | Web UI |',
    );
  }
  const out = path.join(target, 'CODEBASE_MAP.md');
  fs.writeFileSync(out, body);
  return out;
}

function writeMutationConfig(target, src, profile) {
  const spec = mutationSpec(profile);
  if (!spec) return [];
  const written = [];
  const manifestPath = path.join(target, 'project-manifest.json');
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.quality = manifest.quality || {};
    if (!manifest.quality.mutation) {
      manifest.quality.mutation = spec;
      fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    }
  }
  if (spec.tool === 'mutmut') {
    const dest = path.join(target, 'pyproject.toml');
    if (!fs.existsSync(dest)) {
      const tpl = fs.readFileSync(path.join(src, 'templates/mutmut-pyproject.template.toml'), 'utf8');
      const mutate = hasFrontend(profile) ? 'backend/src/' : 'src/';
      const runner = hasFrontend(profile) ? 'cd backend && uv run pytest -x -q' : 'uv run pytest -x -q';
      fs.writeFileSync(dest, tpl.replace('{{PATHS_TO_MUTATE}}', mutate).replace('{{RUNNER_CMD}}', runner));
      written.push(dest);
    }
  }
  if (spec.tool === 'stryker') {
    const dest = path.join(target, 'stryker.conf.json');
    if (!fs.existsSync(dest)) {
      const tpl = fs.readFileSync(path.join(src, 'templates/stryker.conf.json.template'), 'utf8');
      const glob = hasFrontend(profile) && langOf(profile.stack.frontend)
        ? 'frontend/src/**/*.ts'
        : 'src/**/*.ts';
      fs.writeFileSync(dest, tpl.replace('{{TEST_RUNNER}}', 'command').replace('{{MUTATE_GLOB}}', glob));
      written.push(dest);
    }
  }
  return written;
}

function applyModelTier(target, profile) {
  const agents = path.join(target, '.claude', 'agents');
  if (!fs.existsSync(agents)) return;
  const manifestPath = path.join(target, 'project-manifest.json');
  let tier = profile.modelTier;
  if (!tier && fs.existsSync(manifestPath)) {
    try { tier = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).execution.model_tier; } catch (_) { /* */ }
  }
  applyTier(agents, normalizePreset(tier || 'cost'));
}

function initGit(target) {
  try {
    if (!fs.existsSync(path.join(target, '.git'))) {
      execFileSync('git', ['init', '-q'], { cwd: target, stdio: 'ignore' });
    }
    execFileSync('git', ['config', 'core.hooksPath', '.claude/git-hooks'], {
      cwd: target, stdio: 'ignore',
    });
  } catch (_) { /* git missing in some CI images — hooks still copied */ }
}

function copyDocs(target, pluginSource) {
  const harnessRoot = path.dirname(pluginSource);
  const docsSrc = path.join(harnessRoot, 'docs');
  if (!fs.existsSync(docsSrc)) return [];
  const dest = path.join(target, 'docs');
  fs.mkdirSync(dest, { recursive: true });
  const written = [];
  for (const name of ['telemetry.md', 'testing.md', 'extras.md', 'prompting-standards.md', 'model-allocation.md']) {
    const from = path.join(docsSrc, name);
    if (!fs.existsSync(from)) continue;
    const to = path.join(dest, name);
    fs.copyFileSync(from, to);
    written.push(to);
  }
  return written;
}

function writeProjectFiles(target, pluginSource, profile) {
  const written = [
    ...writeModuleClaude(target, pluginSource, profile),
    writeCodebaseMap(target, pluginSource, profile),
    ...writeMutationConfig(target, pluginSource, profile),
    ...copyDocs(target, pluginSource),
  ].filter(Boolean);
  applyModelTier(target, profile);
  initGit(target);
  return written;
}

module.exports = { writeProjectFiles, mutationSpec };
