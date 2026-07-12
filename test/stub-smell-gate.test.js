'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const {
  classifyStubSmells,
  isProductionSource,
  findingLine,
} = require('../.claude/hooks/lib/stub-smell');

test('isProductionSource excludes tests and docs', () => {
  assert.equal(isProductionSource('src/orders/service.ts'), true);
  assert.equal(isProductionSource('src/orders/service.test.ts'), false);
  assert.equal(isProductionSource('test/foo.js'), false);
  assert.equal(isProductionSource('docs/readme.md'), false);
});

test('flags todo! and unimplemented! in production rust-like code', () => {
  const findings = classifyStubSmells('src/runtime/foo.rs', 'fn f() { todo!(); }\n');
  assert.ok(findings.some((f) => f.id === 'todo-macro'));
});

test('flags NotImplementedError', () => {
  const findings = classifyStubSmells(
    'src/svc.py',
    'def work():\n    raise NotImplementedError("later")\n'
  );
  assert.ok(findings.some((f) => f.id === 'not-implemented-error'));
});

test('harness:stub-ok on same line allows the marker', () => {
  const findings = classifyStubSmells(
    'src/svc.py',
    'def work():\n    raise NotImplementedError("later")  # harness:stub-ok story=E1-S1\n'
  );
  assert.equal(findings.length, 0);
});

test('does not scan test files', () => {
  const findings = classifyStubSmells(
    'src/svc.test.ts',
    'throw new Error("TODO implement");\n'
  );
  assert.equal(findings.length, 0);
});

test('findingLine is stable', () => {
  const line = findingLine({
    file: 'src/a.ts',
    line: 3,
    id: 'todo-macro',
    message: 'x',
  });
  assert.match(line, /STUB SMELL/);
  assert.match(line, /src\/a\.ts:3/);
});
