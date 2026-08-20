'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const {
  layerFor,
  layersFor,
  attachObligations,
  filesByStory,
  mergeReviewed,
} = require('../.claude/scripts/test-plan-enrich');

test('layerFor maps frontend/ui to e2e and backend/fullstack to api', () => {
  assert.strictEqual(layerFor({ layer: 'frontend' }), 'e2e');
  assert.strictEqual(layerFor({ layer: 'UI' }), 'e2e');
  assert.strictEqual(layerFor({ layer: 'backend' }), 'api');
  assert.strictEqual(layerFor({ layer: 'fullstack' }), 'api');
  assert.strictEqual(layerFor({ layer: 'config' }), 'unit');
});

test('layersFor adds accessibility/performance/security from AC wording', () => {
  const a11y = layersFor({ layer: 'frontend' }, 'axe reports no violations and contrast is 4.5:1');
  assert.ok(a11y.includes('e2e') && a11y.includes('accessibility'));
  const perf = layersFor({ layer: 'backend' }, 'p95 latency stays under 300 ms');
  assert.ok(perf.includes('api') && perf.includes('performance'));
  const sec = layersFor({ layer: 'backend' }, 'cross-owner isolation returns 404');
  assert.ok(sec.includes('security'));
  const unit = layersFor({ layer: 'backend' }, 'the stored credential hash begins with argon2id');
  assert.ok(unit.includes('unit'));
});

test('layersFor promotes a fullstack page AC to e2e', () => {
  const layers = layersFor(
    { layer: 'fullstack' },
    'a user loads the Next home page and the browser renders the tracer value',
  );
  assert.strictEqual(layers[0], 'e2e');
});

test('attachObligations maps schema models onto the matching AC', () => {
  const requirements = [
    {
      id: 'VM-001', ac_id: 'E2-S1-AC1', story_id: 'E2-S1',
      title: 'Identity API: register and sign in',
      text: 'an account is created and the stored hash begins with argon2id',
    },
    {
      id: 'VM-002', ac_id: 'E3-S1-AC2', story_id: 'E3-S1',
      title: 'Create a short link',
      text: 'an invalid target_url is rejected with 422',
    },
    {
      id: 'VM-003', ac_id: 'E7-S1-AC3', story_id: 'E7-S1',
      title: 'Health and error envelope',
      text: 'the response is 503 with a JSON body matching ErrorResponse',
    },
  ];
  const traces = requirements.map((r) => ({ id: r.id, traces: [r.ac_id], matrix_id: r.id }));
  const obligations = [
    { id: 'OBL-CreateShortLinkRequest.target_url-format', field: 'CreateShortLinkRequest.target_url', rule: 'format' },
    { id: 'OBL-ErrorResponse.code-required', field: 'ErrorResponse.code', rule: 'required' },
    { id: 'OBL-RegisterRequest.email-required', field: 'RegisterRequest.email', rule: 'required' },
  ];
  const result = attachObligations(requirements, traces, obligations);
  assert.strictEqual(result.attached, 3);
  assert.deepStrictEqual(result.unmatched, []);
  assert.ok(requirements[1].obligations.includes('OBL-CreateShortLinkRequest.target_url-format'));
  assert.ok(requirements[2].obligations.includes('OBL-ErrorResponse.code-required'));
  assert.ok(requirements[0].obligations.includes('OBL-RegisterRequest.email-required'));
  assert.ok(traces[1].traces.includes('OBL-CreateShortLinkRequest.target_url-format'));
});

test('mergeReviewed keeps reviewed layers and unions obligations by ac_id', () => {
  const next = [
    {
      id: 'VM-001', ac_id: 'E1-S1-AC1', required_layers: ['api'],
      checks: [{ id: 'CHK-VM-001-api', layer: 'api' }],
      obligations: ['OBL-new'], implementation_paths: ['backend/a.py'],
    },
    {
      id: 'VM-002', ac_id: 'E1-S1-AC2', required_layers: ['api'],
      checks: [{ id: 'CHK-VM-002-api', layer: 'api' }],
      obligations: [], implementation_paths: [],
    },
  ];
  const traces = next.map((r) => ({ id: r.id, traces: [r.ac_id] }));
  const merged = mergeReviewed([
    {
      id: 'VM-009', ac_id: 'E1-S1-AC1', required_layers: ['api', 'security'],
      checks: [{ id: 'CHK-VM-009-security', layer: 'security' }],
      obligations: ['OBL-reviewed'], implementation_paths: ['backend/old.py'],
    },
    { id: 'VM-010', ac_id: 'GONE-AC', required_layers: ['api'] },
  ], next, traces);
  assert.deepStrictEqual(merged.dropped, ['GONE-AC']);
  assert.deepStrictEqual(next[0].required_layers, ['api', 'security']);
  assert.deepStrictEqual(next[0].checks, [{ id: 'CHK-VM-001-security', layer: 'security' }]);
  assert.deepStrictEqual(next[0].obligations, ['OBL-new', 'OBL-reviewed']);
  assert.ok(next[0].implementation_paths.includes('backend/old.py'));
  assert.deepStrictEqual(next[1].required_layers, ['api']);
});

test('filesByStory inverts design-traces onto story ids', () => {
  const map = filesByStory([
    { id: 'backend/src/auth.py', traces: ['E2-S1'] },
    { id: 'frontend/app/login.tsx', traces: ['E2-S2', 'E2-S1'] },
  ]);
  assert.deepStrictEqual(map.get('E2-S1'), ['backend/src/auth.py', 'frontend/app/login.tsx']);
});
