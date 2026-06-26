'use strict';

// Thin, idempotent wrapper around `gh` to open one stacked draft PR for a
// cluster. branch/base come from wave-plan.js; this script only opens (or finds)
// the PR so the agent never hand-rolls `gh pr create` flags.

const { execFileSync } = require('child_process');

function defaultRunner(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8' });
}

function existingPrUrl(branch, runner) {
  try {
    const out = runner('gh', ['pr', 'list', '--head', branch, '--state', 'open', '--json', 'url', '--jq', '.[0].url']);
    const url = String(out).trim();
    return url || null;
  } catch (_) {
    return null;
  }
}

function openPr(opts, runner = defaultRunner) {
  const { branch, base, title, body } = opts || {};
  if (!branch || !base) throw new Error('wave-pr: branch and base are required');
  const existing = existingPrUrl(branch, runner);
  if (existing) return existing;
  const out = runner('gh', [
    'pr', 'create', '--draft',
    '--base', base, '--head', branch,
    '--title', title || branch, '--body', body || '',
  ]);
  return String(out).trim();
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const get = (n) => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : null; };
  try {
    process.stdout.write(`${openPr({ branch: get('--branch'), base: get('--base'), title: get('--title'), body: get('--body') })}\n`);
  } catch (e) {
    process.stderr.write(`wave-pr: ${e.message}\n`);
    process.exit(2);
  }
}

module.exports = { openPr, existingPrUrl };
