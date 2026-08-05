/**
 * Post-deploy E2E target guard.
 *
 * The build-loop Playwright config starts the app itself (`webServer: docker
 * compose up`) against a localhost baseURL. A post-deploy suite does the
 * opposite: it attaches to an environment that already exists, creates its own
 * data, and cannot reset a database between runs. That makes "which host am I
 * pointed at" a safety question, not a config detail — a self-provisioning
 * suite aimed at the wrong environment writes to it.
 *
 * Default-deny on an explicit allowlist, deliberately: host-shaped heuristics
 * for "looks like production" are guesswork, and guessing wrong here is the
 * expensive direction.
 */
'use strict';

const assert = require('assert');
const { test } = require('node:test');

const { resolveTarget } = require('../.claude/scripts/e2e-target-guard.js');

const ALLOW = ['https://test.example.com', 'https://*.staging.example.com'];

test('a target on the allowlist resolves', () => {
  const res = resolveTarget({ baseUrl: 'https://test.example.com', allowlist: ALLOW });
  assert.deepStrictEqual(res.errors, []);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.target, 'https://test.example.com');
});

test('a wildcard allowlist entry matches only within its own domain', () => {
  assert.strictEqual(resolveTarget({ baseUrl: 'https://pr-42.staging.example.com', allowlist: ALLOW }).ok, true);
  const evil = resolveTarget({ baseUrl: 'https://staging.example.com.attacker.test', allowlist: ALLOW });
  assert.strictEqual(evil.ok, false, 'a suffix-lookalike host must not match the wildcard');
});

test('an unlisted target is refused even when it looks harmless', () => {
  const res = resolveTarget({ baseUrl: 'https://demo.example.com', allowlist: ALLOW });
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors.some((e) => /not on the allowlist/i.test(e)));
});

test('an empty allowlist refuses everything rather than allowing everything', () => {
  // Fail-closed: an unconfigured allowlist is the most likely state on day one,
  // and it must not silently mean "any host is fine".
  const res = resolveTarget({ baseUrl: 'https://test.example.com', allowlist: [] });
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors.some((e) => /e2e_targets/.test(e)), 'must name the setting to configure');
});

test('a missing or non-http target is refused with a usable message', () => {
  assert.strictEqual(resolveTarget({ baseUrl: '', allowlist: ALLOW }).ok, false);
  assert.strictEqual(resolveTarget({ baseUrl: undefined, allowlist: ALLOW }).ok, false);
  assert.strictEqual(resolveTarget({ baseUrl: 'not a url', allowlist: ALLOW }).ok, false);
  assert.strictEqual(resolveTarget({ baseUrl: 'file:///etc/passwd', allowlist: ALLOW }).ok, false);
});

test('localhost is refused when the run declares it needs a deployed target', () => {
  const local = { baseUrl: 'http://localhost:3000', allowlist: ['http://localhost:3000'] };
  assert.strictEqual(resolveTarget(local).ok, true, 'allowed when not requiring deployment');
  const res = resolveTarget({ ...local, requireDeployed: true });
  assert.strictEqual(res.ok, false, 'a post-deploy run pointed at localhost is a false green');
  assert.ok(res.errors.some((e) => /localhost|loopback/i.test(e)));
});

test('the unlisted escape hatch works but is reported, never silent', () => {
  const res = resolveTarget({
    baseUrl: 'https://adhoc.example.com', allowlist: ALLOW, allowUnlisted: true,
  });
  assert.strictEqual(res.ok, true);
  assert.ok(res.warnings.some((w) => /allowlist/i.test(w)),
    'bypassing the allowlist must leave a warning in the run output');
});

test('the escape hatch never excuses a malformed or loopback target', () => {
  assert.strictEqual(
    resolveTarget({ baseUrl: 'not a url', allowlist: ALLOW, allowUnlisted: true }).ok, false);
  assert.strictEqual(
    resolveTarget({
      baseUrl: 'http://127.0.0.1:3000', allowlist: [], allowUnlisted: true, requireDeployed: true,
    }).ok, false);
});

test('a trailing slash does not change whether a target is allowed', () => {
  assert.strictEqual(resolveTarget({ baseUrl: 'https://test.example.com/', allowlist: ALLOW }).ok, true);
});

test('the resolved target drops any embedded credentials rather than echoing them', () => {
  const embedded = ['https://u', 'pw@test.example.com'].join(':'); // harness:secret-ok — fixture, not a credential
  const res = resolveTarget({ baseUrl: embedded, allowlist: ALLOW });
  assert.ok(!JSON.stringify(res).includes('pw@'), 'credentials must never reach logs or the verdict');
});
