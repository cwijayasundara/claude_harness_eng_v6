#!/usr/bin/env node

'use strict';

// Upgrade a previously scaffolded project's harness control plane without
// overwriting product config (project-manifest.json, program.md, learned-rules).
// Phase 3 draft — safe-by-default: dry-run unless --apply.
//
// Usage:
//   node .claude/scripts/scaffold-upgrade.js [--target dir] [--plugin-source dir]
//                                           [--profile core|full|brownfield]
//                                           [--apply] [--include-skills]
//
// Default target: cwd. Default plugin source: this harness's .claude/

const fs = require('fs');
const path = require('path');
const { copyScaffoldTree, resolveScaffoldProfile } = require('./scaffold-copy');

const REPO_PLUGIN = path.resolve(__dirname, '..');

// Paths we never overwrite on upgrade (project-owned).
const PRESERVE = new Set([
  'program.md',
  'settings.json', // may have project permissions
  'settings.auto.json',
]);

// State files that are runtime history — never wipe
const PRESERVE_STATE_PREFIX = path.join('.claude', 'state');

function arg(argv, name, fallback) {
  const i = argv.indexOf(name);
  if (i === -1) return fallback;
  return argv[i + 1] !== undefined ? argv[i + 1] : fallback;
}

function listRelativeFiles(dir, base = dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full);
    if (entry.isDirectory()) out.push(...listRelativeFiles(full, base));
    else out.push(rel);
  }
  return out;
}

/**
 * Plan which files would be written from a fresh core/full copy into target.
 * @returns {{ wouldWrite: string[], wouldSkip: string[], profile: string }}
 */
function planUpgrade(pluginSource, target, profileName, { includeSkills = false } = {}) {
  const staging = fs.mkdtempSync(path.join(require('os').tmpdir(), 'harness-upgrade-'));
  try {
    const profile = resolveScaffoldProfile({}, { scaffoldProfile: profileName });
    copyScaffoldTree(pluginSource, staging, profile);
    const stagedClaude = path.join(staging, '.claude');
    const staged = listRelativeFiles(stagedClaude).map((r) => path.join('.claude', r));
    const wouldWrite = [];
    const wouldSkip = [];
    for (const rel of staged) {
      const base = path.basename(rel);
      if (PRESERVE.has(base) && rel.startsWith(`.claude${path.sep}`) && !rel.includes(`${path.sep}templates${path.sep}`)) {
        // preserve top-level program/settings only
        if (['program.md', 'settings.json', 'settings.auto.json'].some((p) => rel.endsWith(p) && rel.split(path.sep).length === 2)) {
          wouldSkip.push(rel);
          continue;
        }
      }
      if (rel.startsWith(PRESERVE_STATE_PREFIX + path.sep) || rel === PRESERVE_STATE_PREFIX) {
        wouldSkip.push(rel);
        continue;
      }
      if (!includeSkills && (rel.includes(`${path.sep}skills${path.sep}`) || rel.endsWith(`${path.sep}skills`))) {
        // skills: skip by default (prompt surface churn); hooks/scripts/git-hooks always upgrade
        wouldSkip.push(rel);
        continue;
      }
      // Always refresh hooks, scripts, git-hooks, agents, templates (non-state)
      wouldWrite.push(rel);
    }
    // Prefer writing control-plane dirs even when includeSkills false
    const forcePrefixes = [
      path.join('.claude', 'hooks'),
      path.join('.claude', 'scripts'),
      path.join('.claude', 'git-hooks'),
      path.join('.claude', 'agents'),
    ];
    for (const rel of staged) {
      if (forcePrefixes.some((p) => rel === p || rel.startsWith(p + path.sep))) {
        if (!wouldWrite.includes(rel)) {
          wouldWrite.push(rel);
          const si = wouldSkip.indexOf(rel);
          if (si !== -1) wouldSkip.splice(si, 1);
        }
      }
    }
    return { wouldWrite: [...new Set(wouldWrite)].sort(), wouldSkip: [...new Set(wouldSkip)].sort(), profile };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function applyUpgrade(pluginSource, target, profileName, plan) {
  const staging = fs.mkdtempSync(path.join(require('os').tmpdir(), 'harness-upgrade-apply-'));
  try {
    copyScaffoldTree(pluginSource, staging, profileName);
    let written = 0;
    for (const rel of plan.wouldWrite) {
      const src = path.join(staging, rel);
      const dest = path.join(target, rel);
      if (!fs.existsSync(src)) continue;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.cpSync(src, dest, { recursive: true });
      written += 1;
    }
    return written;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function main(argv = process.argv.slice(2)) {
  const target = path.resolve(arg(argv, '--target', process.cwd()));
  const pluginSource = path.resolve(arg(argv, '--plugin-source', REPO_PLUGIN));
  const profileName = arg(argv, '--profile', 'core');
  const apply = argv.includes('--apply');
  const includeSkills = argv.includes('--include-skills');

  if (!fs.existsSync(path.join(target, '.claude'))) {
    process.stderr.write(
      `scaffold-upgrade: no .claude/ under ${target}\n` +
        'Fix: run /scaffold first, or pass --target <scaffolded-project>.\n'
    );
    process.exit(1);
  }
  if (!fs.existsSync(path.join(pluginSource, '.claude-plugin', 'plugin.json'))) {
    process.stderr.write(`scaffold-upgrade: invalid plugin source: ${pluginSource}\n`);
    process.exit(1);
  }

  const plan = planUpgrade(pluginSource, target, profileName, { includeSkills });
  process.stdout.write(
    `scaffold-upgrade: profile=${plan.profile} target=${target}\n` +
      `  would write: ${plan.wouldWrite.length} path(s)\n` +
      `  would skip:  ${plan.wouldSkip.length} path(s) (state, settings, skills unless --include-skills)\n`
  );
  if (!apply) {
    process.stdout.write('  dry-run only. Re-run with --apply to copy hooks/scripts/git-hooks/agents.\n');
    process.stdout.write('  Never overwrites project-manifest.json (lives at project root, not in plan).\n');
    process.exit(0);
  }

  const n = applyUpgrade(pluginSource, target, plan.profile, plan);
  process.stdout.write(`scaffold-upgrade: applied ${n} path(s).\n`);
  process.stdout.write(
    'Next: review git diff under .claude/hooks .claude/scripts .claude/git-hooks; ' +
      'run npm test if this is the harness monorepo.\n'
  );
  process.exit(0);
}

module.exports = { planUpgrade, PRESERVE };

if (require.main === module) main();
