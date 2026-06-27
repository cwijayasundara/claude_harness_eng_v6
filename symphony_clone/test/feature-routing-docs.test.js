'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('symphony README documents the agent-feature label and brownfield routing', () => {
  const readme = read('README.md');
  assert.match(readme, /agent-feature|FEATURE_LABEL/);
  assert.match(readme, /\/feature/);
  assert.match(readme, /brownfield/i);
});

test('the tracker-config template carries the optional featureLabel field', () => {
  const tpl = fs.readFileSync(
    path.join(__dirname, '..', '..', '.claude', 'templates', 'tracker-config.template.json'), 'utf8',
  );
  assert.match(tpl, /featureLabel/);
  JSON.parse(tpl.replace(/\/\/.*$/gm, '')); // tolerate // comments; must still be JSON-ish
});
