'use strict';

// The sprint contract is the machine-checkable definition of done; a malformed
// contract must fail at negotiation/commit time, not surface later as a
// confusing curl/Playwright failure inside /evaluate.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const { validate } = require(path.join(__dirname, '..', '.claude', 'hooks', 'lib', 'contract-schema'));

const SCHEMA = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', '.claude', 'skills', 'evaluate', 'references', 'contract-schema.json'), 'utf8'
));

function validContract() {
  return {
    group: 'group-01',
    stories: ['S1'],
    features: ['F1'],
    contract: {
      api_checks: [
        { id: 'a1', method: 'GET', path: '/health', expected_status: 200 },
      ],
      playwright_checks: [
        { id: 'p1', description: 'loads home', steps: [{ action: 'navigate', value: '/' }] },
      ],
    },
  };
}

test('a well-formed contract validates against the real schema', () => {
  assert.deepStrictEqual(validate(SCHEMA, validContract()), []);
});

test('missing required top-level fields are reported', () => {
  const errors = validate(SCHEMA, { group: 'g' });
  assert.ok(errors.some((e) => e.includes('stories')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('features')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('contract')), errors.join('\n'));
});

test('an empty object fails (everything required missing)', () => {
  assert.ok(validate(SCHEMA, {}).length >= 4);
});

test('unknown top-level properties are rejected (additionalProperties false)', () => {
  const c = validContract();
  c.bonus = 'nope';
  const errors = validate(SCHEMA, c);
  assert.ok(errors.some((e) => e.includes('bonus')), errors.join('\n'));
});

test('enum violations are reported with a path', () => {
  const c = validContract();
  c.contract.api_checks[0].method = 'FETCH';
  const errors = validate(SCHEMA, c);
  assert.ok(errors.some((e) => e.includes('method') && e.includes('FETCH')), errors.join('\n'));
});

test('minItems is enforced (stories may not be empty)', () => {
  const c = validContract();
  c.stories = [];
  const errors = validate(SCHEMA, c);
  assert.ok(errors.some((e) => e.includes('stories')), errors.join('\n'));
});

test('type mismatches are reported (stories must be an array)', () => {
  const c = validContract();
  c.stories = 'S1';
  const errors = validate(SCHEMA, c);
  assert.ok(errors.some((e) => e.includes('expected array')), errors.join('\n'));
});

test('numeric bounds are enforced (design min_score 1..10)', () => {
  const c = validContract();
  c.contract.design_checks = { design_quality: { required: true, min_score: 12 } };
  const errors = validate(SCHEMA, c);
  assert.ok(errors.some((e) => e.includes('min_score') || e.includes('maximum')), errors.join('\n'));
});

test('nested required fields inside check items are enforced', () => {
  const c = validContract();
  delete c.contract.api_checks[0].expected_status;
  const errors = validate(SCHEMA, c);
  assert.ok(errors.some((e) => e.includes('expected_status')), errors.join('\n'));
});

test('contract schema accepts optional matrix_ids on verification checks', () => {
  const c = validContract();
  c.contract.api_checks = [
    {
      id: 'api-create',
      matrix_ids: ['VM-001'],
      method: 'POST',
      path: '/todos',
      expected_status: 201,
    },
  ];
  c.contract.playwright_checks = [
    {
      id: 'e2e-create',
      matrix_ids: ['VM-001'],
      description: 'create todo',
      steps: [],
    },
  ];
  c.contract.design_checks = {
    design_quality: {
      matrix_ids: ['VM-001'],
      required: true,
      min_score: 7,
    },
  };
  c.contract.accessibility_checks = {
    matrix_ids: ['VM-001'],
    required: true,
    urls: ['/'],
    block_impacts: ['serious', 'critical'],
  };
  c.contract.security_checks = {
    matrix_ids: ['VM-001'],
    required: true,
    block_severities: ['critical', 'high'],
  };
  c.contract.performance_checks = [
    {
      matrix_ids: ['VM-001'],
      endpoint: '/todos',
      method: 'GET',
      max_response_time_ms: 300,
    },
  ];

  assert.deepStrictEqual(validate(SCHEMA, c), []);

  const contractProps = SCHEMA.properties.contract.properties;
  assert.deepStrictEqual(contractProps.api_checks.items.properties.matrix_ids, {
    type: 'array',
    items: { type: 'string' },
  });
  assert.deepStrictEqual(contractProps.playwright_checks.items.properties.matrix_ids, {
    type: 'array',
    items: { type: 'string' },
  });
  assert.deepStrictEqual(contractProps.design_checks.properties.design_quality.properties.matrix_ids, {
    type: 'array',
    items: { type: 'string' },
  });
  assert.deepStrictEqual(contractProps.accessibility_checks.properties.matrix_ids, {
    type: 'array',
    items: { type: 'string' },
  });
  assert.deepStrictEqual(contractProps.security_checks.properties.matrix_ids, {
    type: 'array',
    items: { type: 'string' },
  });
  assert.deepStrictEqual(contractProps.performance_checks.items.properties.matrix_ids, {
    type: 'array',
    items: { type: 'string' },
  });
});

test('the shipped sprint-contract template validates against the shipped schema (drift guard)', () => {
  const template = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', '.claude', 'templates', 'sprint-contract.json'), 'utf8'
  ));
  assert.deepStrictEqual(validate(SCHEMA, template), []);
});

test('validation depth is bounded — deep nesting reports an error instead of crashing', () => {
  let schema = { type: 'string' };
  let value = 'leaf';
  for (let i = 0; i < 300; i++) {
    schema = { type: 'object', properties: { k: schema } };
    value = { k: value };
  }
  const errors = validate(schema, value);
  assert.ok(errors.some((e) => e.includes('maximum validation depth')), errors.slice(0, 2).join('\n'));
});
