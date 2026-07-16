'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { projectEncodingBlock, encContexts } = require('../.claude/scripts/scaffold-encoding');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const FULL = {
  architecture: {
    layers: ['types', 'config', 'repository', 'service', 'api'],
    contexts: { enabled: true, allow: ['billing->shared', 'orders->shared'] },
  },
  quality: { sensor_tier: 'strict' },
  topology: 'api-service',
  execution: { model_tier: 'opus' },
  observability: { slo: { error_rate: 0.01 } },
  domain_vertical_packs: ['private-equity'],
};

test('projectEncodingBlock encodes the captured project specifics', () => {
  const out = projectEncodingBlock(FULL);
  assert.match(out, /## This Project/);
  assert.match(out, /types → config → repository → service → api/);
  assert.match(out, /billing->shared/);
  assert.match(out, /sensor tier[^\n]*strict/i);
  assert.match(out, /api-service/);
  assert.match(out, /opus/);
  assert.match(out, /private-equity/);
});

test('projectEncodingBlock degrades gracefully on an empty manifest (no dangling tokens)', () => {
  const out = projectEncodingBlock({});
  assert.match(out, /## This Project/);
  assert.match(out, /Import hierarchy[^\n]*not configured/);
  assert.doesNotMatch(out, /\{[a-z-]+\}/); // no unfilled placeholder leaked in
});

test('encContexts is null when contexts are disabled/absent, present when enabled', () => {
  assert.strictEqual(encContexts(null), null);
  assert.strictEqual(encContexts({ contexts: { enabled: false } }), null);
  assert.match(encContexts({ contexts: { enabled: true, allow: [] } }), /fully isolated/);
});

test('scaffold wiring: template carries the placeholder and writeClaudeMd fills it', () => {
  assert.match(read('.claude/templates/claude-md.template.md'), /\{project-encoding\}/);
  assert.match(read('.claude/scripts/scaffold-apply.js'), /projectEncodingBlock\(render\.buildManifest\(profile\)\)/);
});
