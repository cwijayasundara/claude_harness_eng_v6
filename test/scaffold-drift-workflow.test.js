'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { applyScaffold } = require('../.claude/scripts/scaffold-apply');

const PLUGIN_SOURCE = path.resolve(__dirname, '..', '.claude');
const PROFILE = {
  name: 'sample-cli',
  description: 'A tiny Node CLI utility.',
  stack: { backend: null, frontend: null, database: null },
  projectType: 'D',
  verificationMode: 'C',
  modelTier: 'balanced',
  tracker: 'A',
  frameworkPacks: [],
  lsp: [],
};

function scaffold(profile, opts = {}) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scaffold-drift-'));
  const target = path.join(workDir, 'project');
  const profilePath = path.join(workDir, 'profile.json');
  fs.writeFileSync(profilePath, JSON.stringify(profile));
  const result = applyScaffold({ profile: profilePath, pluginSource: PLUGIN_SOURCE, target, ...opts });
  return { workDir, target, result };
}

test('default scaffold does not activate the drift workflow', () => {
  const { workDir, target } = scaffold(PROFILE);
  try {
    assert.ok(!fs.existsSync(path.join(target, '.github/workflows/harness-drift.yml')));
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('profile quality.drift.workflow activates the drift workflow', () => {
  const profile = { ...PROFILE, quality: { drift: { workflow: true } } };
  const { workDir, target, result } = scaffold(profile);
  try {
    assert.ok(fs.existsSync(path.join(target, '.github/workflows/harness-drift.yml')));
    assert.ok(result.written.some((f) => f.endsWith(path.join('.github', 'workflows', 'harness-drift.yml'))));
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('--drift-workflow option activates the drift workflow', () => {
  const { workDir, target } = scaffold(PROFILE, { driftWorkflow: true });
  try {
    assert.ok(fs.existsSync(path.join(target, '.github/workflows/harness-drift.yml')));
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});
