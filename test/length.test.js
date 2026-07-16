'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { oversizedFunctions, newlyOversized } = require('../.claude/hooks/lib/length');

const names = (content, ext) => oversizedFunctions(content, ext).map((f) => f.name);
// filler body lines at a given indent
const filler = (n, indent) => Array.from({ length: n }, (_, i) => `${' '.repeat(indent)}x${i} = ${i}`).join('\n');

test('a short module-level function followed by a long class is NOT flagged (class-boundary bug)', () => {
  // Reproduces the fake_llm.py shape: a 2-line module function, then a class
  // whose body is long. The parser must close the function at the `class` line,
  // not measure it to EOF.
  const content = [
    'def short_helper(payload):',
    '    return payload',
    '',
    'class Big:',
    '    def a(self):',
    filler(20, 8),
    '    def b(self):',
    filler(20, 8),
  ].join('\n');
  assert.deepStrictEqual(names(content, '.py'), []);
});

test('a genuinely long standalone function IS still flagged (detection preserved)', () => {
  const content = ['def big_fn():', filler(35, 4)].join('\n');
  assert.ok(names(content, '.py').includes('big_fn'));
});

test('a long method inside a class IS flagged individually', () => {
  const content = ['class C:', '    def big_method(self):', filler(35, 8)].join('\n');
  assert.ok(names(content, '.py').includes('big_method'));
});

test('a module function placed AFTER a class is measured at its true (small) length', () => {
  const content = [
    'class First:',
    '    def m(self):',
    '        return 1',
    '',
    'def trailing_helper(x):',
    '    return x + 1',
  ].join('\n');
  assert.deepStrictEqual(names(content, '.py'), []);
});

// --- ratchet: newlyOversized (retro R3) ---
const bigFn = (name, bodyLines) => [`def ${name}():`, filler(bodyLines, 4)].join('\n');
const newNames = (before, after) => newlyOversized(before, after, '.py').map((f) => f.name);

test('newlyOversized on a NEW file (before=null) grandfathers nothing', () => {
  assert.deepStrictEqual(newNames(null, bigFn('fresh', 35)), ['fresh']);
});

test('newlyOversized grandfathers a pre-existing oversized function left unchanged', () => {
  const legacy = bigFn('legacy', 35);
  assert.deepStrictEqual(newNames(legacy, legacy), []);
});

test('newlyOversized flags a pre-existing oversized function that GREW', () => {
  assert.deepStrictEqual(newNames(bigFn('legacy', 35), bigFn('legacy', 45)), ['legacy']);
});

test('newlyOversized flags a NEW oversized function while grandfathering the untouched legacy one', () => {
  const before = bigFn('legacy', 35);
  const after = [bigFn('legacy', 35), '', bigFn('added', 35)].join('\n');
  assert.deepStrictEqual(newNames(before, after), ['added']);
});

test('newlyOversized returns nothing when no function is oversized', () => {
  assert.deepStrictEqual(newNames(null, 'def small():\n    return 1\n'), []);
});
