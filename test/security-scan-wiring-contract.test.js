'use strict';

// Locks the G3 wiring so a security control can't be silently un-wired: the
// pre-commit hook must run the baseline secrets sensor, and /gate must invoke
// the computational scan under the security-boundary trigger.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('pre-commit hook wires the baseline secrets sensor', () => {
  const src = read('.claude/git-hooks/pre-commit');
  assert.match(src, /baselineSecretFindings/, 'must import the baseline secrets scanner');
  assert.match(src, /checkSecrets\(projectDir, staged\)/, 'must call checkSecrets on staged files');
  // It must run before the source-only early exit (secrets hide in config/yaml).
  assert.ok(
    src.indexOf('checkSecrets(projectDir, staged)') < src.indexOf("docs-only commit"),
    'checkSecrets must run before the docs-only early exit'
  );
});

test('/gate invokes the computational security scan under the boundary trigger', () => {
  const skill = read('.claude/skills/gate/SKILL.md');
  assert.match(skill, /security-scan\.js/, '/gate must reference the security-scan CLI');
  assert.match(skill, /--all --staged --boundary-only/, '/gate must run the boundary-gated scan');
});

test('security-scan CLI and lib are present and required correctly', () => {
  assert.ok(fs.existsSync(path.join(ROOT, '.claude/scripts/security-scan.js')));
  assert.ok(fs.existsSync(path.join(ROOT, '.claude/hooks/lib/security-scan.js')));
  const cli = read('.claude/scripts/security-scan.js');
  assert.match(cli, /require\('\.\.\/hooks\/lib\/security-scan'\)/, 'CLI must reuse the tested lib');
});

test('pre-commit hook wires the amendment-provenance gate before the source-only early exit', () => {
  const src = read('.claude/git-hooks/pre-commit');
  assert.match(src, /checkAmendmentProvenance\(projectDir, staged\)/, 'must call checkAmendmentProvenance on all staged files');
  // It must run before the source-only early exit (design docs are markdown/json, not SOURCE_EXTS).
  // Search from checkSecrets (which is the call site context) to avoid matching the function definition.
  const checkSecretsCall = src.indexOf('checkSecrets(projectDir, staged)');
  const mainTryStart = src.indexOf('const staged = stagedFiles();');
  const callSiteStart = Math.max(mainTryStart, checkSecretsCall);
  const checkAmendmentInCallSite = src.indexOf('checkAmendmentProvenance(projectDir, staged)', callSiteStart);
  const stagedSourceCheck = src.indexOf('stagedSource.length === 0', callSiteStart);
  assert.ok(
    checkAmendmentInCallSite > callSiteStart && checkAmendmentInCallSite < stagedSourceCheck,
    'checkAmendmentProvenance must run before the source-only early exit (before stagedSource.length === 0)'
  );
});
