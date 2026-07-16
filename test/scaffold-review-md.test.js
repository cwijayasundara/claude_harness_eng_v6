'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { reviewPolicyBlock, renderReviewMd } = require('../.claude/scripts/scaffold-encoding');
const render = require('../.claude/scripts/scaffold-render');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const MANIFEST = {
  architecture: { layers: ['types', 'service', 'api'], contexts: { enabled: true, allow: ['a->shared'] } },
  quality: { sensor_tier: 'strict' },
  domain_vertical_packs: ['private-equity'],
};

test('reviewPolicyBlock encodes the project review rules', () => {
  const out = reviewPolicyBlock(MANIFEST);
  assert.match(out, /Encoded Policy/);
  assert.match(out, /types → service → api/);
  assert.match(out, /a->shared/);
  assert.match(out, /sensor tier `strict`/);
  assert.match(out, /private-equity/);
  assert.match(out, /constitution\.md/);
});

test('renderReviewMd fills the template with no dangling tokens', () => {
  const body = read('.claude/templates/review.template.md');
  const out = renderReviewMd(body, { name: 'acme-svc' }, render);
  assert.match(out, /Review Policy — acme-svc/);
  assert.match(out, /Encoded Policy/);
  assert.doesNotMatch(out, /\{project-name\}|\{review-policy\}/);
});

test('scaffold + reviewer wiring is in place', () => {
  // scaffold writes REVIEW.md
  assert.match(read('.claude/scripts/scaffold-apply.js'), /writeReviewMd\(target, pluginSource, profile\)/);
  // the code-reviewer agent reads it (so REVIEW.md is not shelfware)
  assert.match(read('.claude/agents/code-reviewer.md'), /REVIEW\.md/);
});
