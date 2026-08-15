#!/usr/bin/env node

'use strict';

// The hard boundary between the planning session and the coding loop.
//
// plan-approval.js proves each phase was reviewed. This file proves the
// *bundle* is sealed and coding may start. /auto checks the seal; a changed
// artifact voids it the same way a changed approval artifact voids the receipt.
//
// CLI:
//   plan-seal.js write [--lane --auto|--autonomous] [--root DIR]
//   plan-seal.js check [--require-human] [--root DIR]
//
// Exit: 0 = pass, 1 = gate failure, 2 = usage or IO error.

const fs = require('fs');
const path = require('path');
const {
  run: runApproval,
  readReceipt,
  PHASES,
} = require('./plan-approval.js');
const { digest, FEATURES_LIVE_FIELDS } = require('./plan-artifact-digest.js');

const SEAL_REL = path.join('specs', 'reviews', 'plan-seal.json');
const LANES = new Set(['--auto', '--autonomous']);

const EXTRA_ARTIFACTS = [
  'features.json',
  path.join('specs', 'design', 'component-map.md'),
  path.join('specs', 'design', 'program-design.md'),
  path.join('specs', 'design', 'architecture.md'),
  path.join('specs', 'test_artefacts', 'test-plan.md'),
  path.join('specs', 'test_artefacts', 'verification-matrix.json'),
];

function arg(argv, name, fallback) {
  const i = argv.indexOf(name);
  if (i === -1 || argv[i + 1] === undefined) return fallback;
  return String(argv[i + 1]);
}

function rawArg(argv, name) {
  const i = argv.indexOf(name);
  return i === -1 ? null : (argv[i + 1] === undefined ? null : String(argv[i + 1]));
}

function fail(message) {
  process.stderr.write(`plan-seal: ${message}\n`);
  return 2;
}

function sealPath(root) {
  return path.join(root, SEAL_REL);
}

function readSeal(root) {
  const file = sealPath(root);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function collectArtifacts(root) {
  const seen = new Set();
  const artifacts = [];
  for (const phase of PHASES) {
    const receipt = readReceipt(root, phase);
    for (const item of (receipt && receipt.artifacts) || []) {
      if (!item || !item.path || seen.has(item.path)) continue;
      const sha256 = digest(root, item.path);
      if (!sha256) continue;
      seen.add(item.path);
      artifacts.push({ path: item.path, sha256, phase });
    }
  }
  for (const rel of EXTRA_ARTIFACTS) {
    if (seen.has(rel)) continue;
    const sha256 = digest(root, rel);
    if (!sha256) continue;
    seen.add(rel);
    artifacts.push({ path: rel, sha256, phase: null });
  }
  return artifacts;
}

function approvalCheck(root, requireHuman) {
  const argv = ['check', '--phase', 'all', '--root', root];
  if (requireHuman) argv.push('--require-human');
  return runApproval(argv, root);
}

function writeSeal(argv, root, now) {
  const lane = rawArg(argv, '--lane');
  if (lane && !LANES.has(lane)) return fail(`--lane must be one of ${[...LANES].join(' | ')}`);

  const requireHuman = !lane;
  const approval = approvalCheck(root, requireHuman);
  if (approval !== 0) {
    process.stderr.write('plan-seal: cannot write — plan-approval check failed.\n');
    return 1;
  }

  const artifacts = collectArtifacts(root);
  if (!lane && artifacts.length === 0) {
    return fail('a human seal must name at least one approved artifact');
  }

  const seal = {
    status: lane ? 'waived' : 'sealed',
    waived_by: lane || null,
    sealedAt: now(),
    artifacts,
  };
  const file = sealPath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(seal, null, 2)}\n`);
  process.stdout.write(
    lane
      ? `plan-seal: waived by ${lane}. Coding may start in this session.\n`
      : `plan-seal: sealed ${artifacts.length} artifact(s). /clear, then /auto --sealed.\n`,
  );
  return 0;
}

function checkSeal(argv, root) {
  const requireHuman = argv.includes('--require-human');
  const seal = readSeal(root);
  if (!seal) {
    process.stderr.write(
      'plan-seal: BLOCKED — no seal. After the four plan gates run: '
      + 'node .claude/scripts/plan-seal.js write\n',
    );
    return 1;
  }
  if (seal.status === 'waived') {
    if (requireHuman) {
      process.stderr.write(
        `plan-seal: BLOCKED — seal was waived by ${seal.waived_by}; this lane requires a human seal.\n`,
      );
      return 1;
    }
  } else if (seal.status !== 'sealed') {
    process.stderr.write(`plan-seal: BLOCKED — seal status is ${seal.status}.\n`);
    return 1;
  }

  const stale = (seal.artifacts || []).filter((a) => digest(root, a.path) !== a.sha256);
  if (stale.length) {
    process.stderr.write(
      `plan-seal: BLOCKED — sealed artifacts changed: ${stale.map((a) => a.path).join(', ')} `
      + '— re-run plan-seal.js write after re-approval.\n',
    );
    return 1;
  }

  const approval = approvalCheck(root, requireHuman);
  if (approval !== 0) {
    process.stderr.write('plan-seal: BLOCKED — underlying plan-approval no longer holds.\n');
    return 1;
  }

  process.stdout.write('plan-seal: OK.\n');
  return 0;
}

function run(argv, root, deps) {
  const now = (deps && deps.now) || (() => new Date().toISOString());
  const cwd = arg(argv, '--root', root) || root;
  const verb = argv[0];
  if (verb === 'write') return writeSeal(argv, cwd, now);
  if (verb === 'check') return checkSeal(argv, cwd);
  return fail('usage: plan-seal.js <write|check> [--lane --auto|--autonomous] [--require-human] [--root DIR]');
}

module.exports = { run, readSeal, SEAL_REL, FEATURES_LIVE_FIELDS };

if (require.main === module) process.exit(run(process.argv.slice(2), process.cwd()));
