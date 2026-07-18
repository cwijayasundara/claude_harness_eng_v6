'use strict';
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');

const ownership = require(path.resolve(__dirname, '..', '.claude', 'scripts', 'ownership-check.js'));

test('ownership parseComponentMap ignores non-path seam metadata, keeps real paths', () => {
  // seam metadata values are NOT backtick-wrapped as paths; the file path IS.
  const map = [
    '| Story | Files | Seam | Mechanism |',
    '|---|---|---|---|',
    '| E1-S1 | `src/services/upload_service.py` | seam: true | extension_mechanism: config |',
  ].join('\n');
  const owned = ownership.parseComponentMap(map);
  assert.ok(owned.has('src/services/upload_service.py'), 'the real source path is still owned');
  assert.ok(![...owned].some((t) => /true|config|seam|mechanism/i.test(t)), 'seam metadata words are not swept into ownership');
});
