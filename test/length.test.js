'use strict';

// Regression: an immediately-invoked arrow bound to a const is matched by
// ARROW_FUNC_RE but never opens a body at a deeper level. Before the flush fix it
// stayed on the stack and blocked its ENCLOSING function from ever being popped, so
// that function measured to an arbitrary later brace. The symptom was a phantom
// length that changed depending on what was appended AFTER the function — a 16-line
// function reported as 31 because unrelated code followed it.
{
  const { oversizedFunctions } = require('../.claude/hooks/lib/length.js');
  const { test: t } = require('node:test');
  const a = require('assert');

  const SHORT_FN_WITH_IIFE = [
    'function small(x) {',
    "  const parsed = (() => { try { return JSON.parse(x); } catch (_) { return null; } })();",
    '  return parsed;',
    '}',
    '',
  ].join('\n');

  t('a function containing an IIFE arrow is not reported oversized', () => {
    a.deepStrictEqual(oversizedFunctions(SHORT_FN_WITH_IIFE, '.js'), []);
  });

  t('braces inside string literals are not counted as code', () => {
    const src = [
      'function small() {',
      "  const open = '{';",
      '  const close = "}";',
      '  return open + close;',
      '}',
      '',
    ].join('\n');
    a.deepStrictEqual(oversizedFunctions(src, '.js'), []);
  });

  t('a comment containing example code is not parsed as a declaration', () => {
    // This is the case that made writing a comment ABOUT the parser trip the parser.
    const src = [
      'function small() {',
      '  // example: function inner() { return 1; }',
      '  /* also: const f = (() => {})(); */',
      '  return 1;',
      '}',
      '',
    ].join('\n');
    a.deepStrictEqual(oversizedFunctions(src, '.js'), []);
  });

  t('braces inside a template literal are not counted as code', () => {
    const src = [
      'function small(x) {',
      '  return `a ${x} b {{ c`;',
      '}',
      '',
    ].join('\n');
    a.deepStrictEqual(oversizedFunctions(src, '.js'), []);
  });

  t('a genuinely oversized function is still reported', () => {
    const body = Array.from({ length: 40 }, (_, i) => `  const v${i} = ${i};`).join('\n');
    const src = `function big() {\n${body}\n  return 0;\n}\n`;
    const over = oversizedFunctions(src, '.js');
    a.strictEqual(over.length, 1, 'the cap must still bite on real length');
    a.strictEqual(over[0].name, 'big');
  });

  t('its measured length does not change when unrelated code is appended', () => {
    const filler = Array.from({ length: 40 }, (_, i) => `function pad${i}() {\n  return ${i};\n}\n`).join('\n');
    a.deepStrictEqual(
      oversizedFunctions(SHORT_FN_WITH_IIFE + filler, '.js'), [],
      'appending code after a function must not inflate that function\'s measured length'
    );
  });
}
const { test } = require('node:test');
const assert = require('node:assert');
const { oversizedFunctions, newlyOversized, newlyOverFileLimit, FILE_HARD_LIMIT } = require('../.claude/hooks/lib/length');
const L = FILE_HARD_LIMIT;

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

// --- file-length ratchet: newlyOverFileLimit ---
test('newlyOverFileLimit: a file under the limit is fine', () => {
  assert.strictEqual(newlyOverFileLimit(null, L - 1), false);
  assert.strictEqual(newlyOverFileLimit(L - 10, L - 1), false);
});

test('newlyOverFileLimit: a NEW file over the limit is blocked', () => {
  assert.strictEqual(newlyOverFileLimit(null, L + 50), true);
});

test('newlyOverFileLimit: an edit that newly crosses the limit is blocked', () => {
  assert.strictEqual(newlyOverFileLimit(L - 1, L), true);
});

test('newlyOverFileLimit: a legacy over-limit file is grandfathered when unchanged or shrunk', () => {
  assert.strictEqual(newlyOverFileLimit(L + 50, L + 50), false); // unchanged
  assert.strictEqual(newlyOverFileLimit(L + 50, L + 20), false); // shrunk, still over
});

test('newlyOverFileLimit: a legacy over-limit file that GROWS is blocked', () => {
  assert.strictEqual(newlyOverFileLimit(L + 50, L + 51), true);
});
