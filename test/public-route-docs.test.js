'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('README and project README template present the same three public routes', () => {
  const docs = [
    read('README.md'),
    read('.claude/templates/project-readme.template.md'),
  ];
  for (const doc of docs) {
    assert.match(doc, /New product\s+[-→>]+ \/build/);
    assert.match(doc, /Existing product\s+[-→>]+ \/feature "<request>"/);
    assert.match(doc, /Verify\/review\s+[-→>]+ \/gate/);
  }
});
