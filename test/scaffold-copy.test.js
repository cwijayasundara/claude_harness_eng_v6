'use strict';

// Locks in the two cross-cutting copy guarantees that keep a scaffolded project
// from silently losing its hook layer:
//   1. a {"type":"commonjs"} .claude/package.json marker — without it an app whose
//      root package.json is "type":"module" reparses every require()-based harness
//      hook/script as ESM and crashes with "require is not defined";
//   2. the .claude/git-hooks/ tree (entries + lib/) — Step 8 wires it via
//      `git config core.hooksPath .claude/git-hooks`, the only location where the
//      hooks' __dirname-relative require()s resolve.
// Both must hold across every scaffold profile (selected `core`/`brownfield` and
// the unselected `full` copy path).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { applyScaffold } = require('../.claude/scripts/scaffold-apply');

const PLUGIN_SOURCE = path.resolve(__dirname, '..', '.claude');

const BASE_PROFILE = {
  name: 'marker-probe',
  description: 'Probe for the CommonJS marker and git-hooks copy.',
  stack: { backend: null, frontend: null, database: null },
  projectType: 'D',
  verificationMode: 'C',
  modelTier: 'balanced',
  tracker: 'A',
  frameworkPacks: [],
  lsp: [],
};

function scaffoldInto(scaffoldProfile) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scaffold-copy-'));
  const target = path.join(workDir, 'project');
  const profilePath = path.join(workDir, 'profile.json');
  fs.writeFileSync(profilePath, JSON.stringify(BASE_PROFILE));
  applyScaffold({ profile: profilePath, pluginSource: PLUGIN_SOURCE, target, scaffoldProfile });
  return { workDir, target };
}

for (const profile of ['core', 'full']) {
  test(`scaffold (${profile}) copies the CommonJS marker and the git-hooks tree`, () => {
    const { workDir, target } = scaffoldInto(profile);
    try {
      const marker = JSON.parse(fs.readFileSync(path.join(target, '.claude', 'package.json'), 'utf8'));
      assert.strictEqual(marker.type, 'commonjs', '.claude/package.json must pin CommonJS');

      for (const rel of ['pre-commit', 'commit-msg', 'prepare-commit-msg', path.join('lib', 'refactor-purity.js')]) {
        assert.ok(
          fs.existsSync(path.join(target, '.claude', 'git-hooks', rel)),
          `git-hooks/${rel} must be copied so core.hooksPath resolves it`,
        );
      }

      // The pre-commit's __dirname-relative require()s resolve only from
      // .claude/git-hooks/ — prove the dependency targets landed alongside it.
      assert.ok(fs.existsSync(path.join(target, '.claude', 'hooks', 'lib', 'layers.js')), 'hooks/lib/layers.js (required by pre-commit) must exist');
      assert.ok(fs.existsSync(path.join(target, '.claude', 'hooks', 'lib', 'tdd.js')), 'hooks/lib/tdd.js (required by refactor-purity) must exist');
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });
}

for (const profile of ['core', 'brownfield', 'full']) {
  test(`scaffold (${profile}) copies scripts required by copied prompt wiring`, () => {
    const { workDir, target } = scaffoldInto(profile);
    try {
      assert.ok(
        fs.existsSync(path.join(target, '.claude', 'scripts', 'verification-matrix-gate.js')),
        'verification-matrix-gate.js must be copied because /test and /auto call it',
      );
      assert.ok(
        fs.existsSync(path.join(target, '.claude', 'scripts', 'ownership-check.js')),
        'ownership-check.js must be copied because the pre-commit hook and /gate call it',
      );
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });
}
