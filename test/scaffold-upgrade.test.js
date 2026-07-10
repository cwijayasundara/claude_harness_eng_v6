'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const { applyScaffold } = require('../.claude/scripts/scaffold-apply');
const { planUpgrade } = require('../.claude/scripts/scaffold-upgrade');

const PLUGIN = path.resolve(__dirname, '..', '.claude');

function scaffoldCore() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'upgrade-'));
  const target = path.join(work, 'project');
  const profilePath = path.join(work, 'profile.json');
  fs.writeFileSync(profilePath, JSON.stringify({
    name: 'upgrade-probe',
    description: 'upgrade test',
    stack: { backend: null, frontend: null, database: null },
    projectType: 'D',
    verificationMode: 'C',
    modelTier: 'cost',
    tracker: 'A',
    frameworkPacks: [],
    lsp: [],
  }));
  applyScaffold({
    profile: profilePath,
    pluginSource: PLUGIN,
    target,
    scaffoldProfile: 'core',
  });
  return { work, target };
}

test('planUpgrade dry-run lists hooks/scripts and skips state', () => {
  const { work, target } = scaffoldCore();
  try {
    const plan = planUpgrade(PLUGIN, target, 'core', { includeSkills: false });
    assert.ok(plan.wouldWrite.some((p) => p.includes(`${path.sep}hooks${path.sep}`) || p.includes('/hooks/')),
      `expected hooks in write plan: ${plan.wouldWrite.slice(0, 5)}`);
    assert.ok(plan.wouldWrite.some((p) => p.includes('gate-registry') || p.includes('scripts')),
      'expected scripts in write plan');
    assert.ok(plan.wouldSkip.some((p) => p.includes('state')),
      'state should be skipped');
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test('planUpgrade never targets project-manifest.json at root', () => {
  const { work, target } = scaffoldCore();
  try {
    const plan = planUpgrade(PLUGIN, target, 'core', {});
    assert.ok(!plan.wouldWrite.includes('project-manifest.json'));
    assert.ok(!plan.wouldWrite.some((p) => p === 'project-manifest.json'));
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});
