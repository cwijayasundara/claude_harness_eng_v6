'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const { validate } = require(path.join(__dirname, '..', '.claude', 'hooks', 'lib', 'contract-schema'));
const schema = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', '.claude', 'skills', 'evaluate', 'references', 'contract-schema.json'), 'utf8'));

// W4: the sprint contract can carry an accessibility (axe-core) gate, mirroring
// design_checks. Because `contract` is additionalProperties:false, the block only
// validates because the schema explicitly allows it.

function withContract(contract) {
  return { group: 'A', stories: ['E1-S1'], features: ['F1'], contract };
}

test('a contract with a valid accessibility_checks block validates', () => {
  const errors = validate(schema, withContract({
    accessibility_checks: { required: true, block_impacts: ['serious', 'critical'], urls: ['http://localhost:3000'] },
  }));
  assert.deepStrictEqual(errors, []);
});

test('an unknown impact level is rejected by the enum', () => {
  const errors = validate(schema, withContract({
    accessibility_checks: { block_impacts: ['catastrophic'] },
  }));
  assert.ok(errors.length >= 1, 'invalid impact must produce an error');
  assert.ok(errors.some((e) => /catastrophic/.test(e)), 'error names the bad value');
});

test('the schema documents the four axe impact levels', () => {
  const impacts = schema.properties.contract.properties.accessibility_checks
    .properties.block_impacts.items.enum;
  assert.deepStrictEqual(impacts, ['minor', 'moderate', 'serious', 'critical']);
});
