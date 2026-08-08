#!/usr/bin/env node

'use strict';

// Post-deploy E2E target guard.
//
// The build-loop Playwright config starts the app itself and points at
// localhost. A post-deploy suite attaches to an environment that already
// exists, provisions its own data, and cannot reset a database between runs —
// so "which host is this pointed at" is a safety question. A self-provisioning
// suite aimed at the wrong environment writes to it.
//
// Fail-closed on an explicit allowlist. Heuristics for "looks like production"
// are guesswork, and guessing wrong is the expensive direction.
//
// Usage:
//   E2E_BASE_URL=https://test.example.com node .claude/scripts/e2e-target-guard.js --require-deployed
//
// Allowlist lives in project-manifest.json#verification.e2e_targets.
// Escape hatch: E2E_ALLOW_UNLISTED=1 (warns loudly; never silent).

const fs = require('fs');
const path = require('path');

const LOOPBACK = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);
const MANIFEST_KEY = 'verification.e2e_targets';

function parseUrl(raw) {
  const text = String(raw || '').trim();
  if (!text) return { error: 'E2E_BASE_URL is not set — a post-deploy run needs an explicit target' };
  let url;
  try {
    url = new URL(text);
  } catch (_) {
    return { error: `E2E_BASE_URL is not a valid URL: ${JSON.stringify(text)}` };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { error: `E2E_BASE_URL must be http(s), found ${url.protocol}` };
  }
  return { url };
}

// Credentials in the URL must never reach a log, a verdict, or a CI annotation.
function scrub(url) {
  const clean = new URL(url.toString());
  clean.username = '';
  clean.password = '';
  const text = clean.toString();
  return text.endsWith('/') && clean.pathname === '/' ? text.slice(0, -1) : text;
}

// `https://*.staging.example.com` matches one or more leading labels within
// that domain, and nothing outside it — a suffix lookalike such as
// `staging.example.com.attacker.test` must not match.
function patternMatches(pattern, url) {
  let patternUrl;
  try {
    patternUrl = new URL(String(pattern).trim());
  } catch (_) {
    return false;
  }
  if (patternUrl.protocol !== url.protocol) return false;
  if ((patternUrl.port || '') !== (url.port || '')) return false;

  const host = url.hostname.toLowerCase();
  const patternHost = patternUrl.hostname.toLowerCase();
  if (!patternHost.startsWith('*.')) return host === patternHost;
  const suffix = patternHost.slice(2);
  return host.endsWith(`.${suffix}`) && host.length > suffix.length + 1;
}

/**
 * @param {object} opts
 * @param {string} opts.baseUrl        the requested target
 * @param {string[]} opts.allowlist    project-manifest verification.e2e_targets
 * @param {boolean} [opts.allowUnlisted] bypass the allowlist, with a warning
 * @param {boolean} [opts.requireDeployed] refuse loopback targets
 * @returns {{ok: boolean, target: string|null, errors: string[], warnings: string[]}}
 */
function resolveTarget(opts = {}) {
  const { baseUrl, allowlist = [], allowUnlisted = false, requireDeployed = false } = opts;
  const errors = [];
  const warnings = [];

  const { url, error } = parseUrl(baseUrl);
  if (error) return { ok: false, target: null, errors: [error], warnings };

  const target = scrub(url);
  if (url.username || url.password) {
    warnings.push('credentials were embedded in E2E_BASE_URL and have been stripped; pass them as secrets instead');
  }

  if (requireDeployed && LOOPBACK.has(url.hostname.toLowerCase())) {
    errors.push(`${url.hostname} is a loopback address — a post-deploy run pointed at localhost is a false green`);
  }

  const listed = allowlist.some((pattern) => patternMatches(pattern, url));
  if (!listed) {
    if (!allowlist.length && !allowUnlisted) {
      errors.push(`no E2E targets configured — set ${MANIFEST_KEY} in project-manifest.json`);
    } else if (!allowUnlisted) {
      errors.push(`${target} is not on the allowlist (${MANIFEST_KEY}): ${allowlist.join(', ')}`);
    } else {
      warnings.push(`${target} is NOT on the allowlist; proceeding because E2E_ALLOW_UNLISTED is set`);
    }
  }

  return { ok: errors.length === 0, target, errors, warnings };
}

function readAllowlist(root) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'project-manifest.json'), 'utf8'));
    const targets = manifest && manifest.verification && manifest.verification.e2e_targets;
    return Array.isArray(targets) ? targets : [];
  } catch (_) {
    return [];
  }
}

function main(argv) {
  const rootIdx = argv.indexOf('--root');
  const root = rootIdx >= 0 ? argv[rootIdx + 1] : process.cwd();
  const result = resolveTarget({
    baseUrl: process.env.E2E_BASE_URL,
    allowlist: readAllowlist(root),
    allowUnlisted: process.env.E2E_ALLOW_UNLISTED === '1',
    requireDeployed: argv.includes('--require-deployed'),
  });

  for (const w of result.warnings) process.stderr.write(`e2e-target-guard: WARNING ${w}\n`);
  if (!result.ok) {
    process.stderr.write('e2e-target-guard: BLOCKED\n');
    for (const e of result.errors) process.stderr.write(`  - ${e}\n`);
    process.exit(1);
  }
  process.stdout.write(`${result.target}\n`);
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { resolveTarget, readAllowlist, MANIFEST_KEY };
