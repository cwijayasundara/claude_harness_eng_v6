'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  parseTsc,
  parseEslint,
  parseRuff,
  parseMypy,
  parseAuto,
  shardDiagnostics,
  packageOf,
} = require('../.claude/hooks/lib/diagnostics-parse');
const { run: runShard } = require('../.claude/scripts/diagnostics-shard');

test('packageOf uses src/<mod> and packages/<name>', () => {
  assert.equal(packageOf('src/orders/service.ts'), 'src/orders');
  assert.equal(packageOf('packages/core/src/a.ts'), 'packages/core');
  assert.equal(packageOf('lib/util.ts'), 'lib');
  assert.equal(packageOf('src/a.ts'), 'src');
});

test('parseTsc paren and colon forms', () => {
  const text = [
    "src/a.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.",
    'src/b.ts:3:1 - error TS2304: Cannot find name x.',
  ].join('\n');
  const rows = parseTsc(text);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].code, 'TS2322');
  assert.equal(rows[0].line, 10);
  assert.equal(rows[1].code, 'TS2304');
  assert.equal(rows[1].file, 'src/b.ts');
});

test('parseEslint stylish and json', () => {
  const stylish = [
    '/proj/src/a.ts',
    '  10:5  error  Unexpected any  @typescript-eslint/no-explicit-any',
  ].join('\n');
  const s = parseEslint(stylish);
  assert.equal(s.length, 1);
  assert.equal(s[0].code, '@typescript-eslint/no-explicit-any');

  const json = JSON.stringify([
    {
      filePath: 'src/b.ts',
      messages: [
        { line: 2, column: 1, severity: 2, ruleId: 'no-unused-vars', message: 'x is unused' },
        { line: 3, column: 1, severity: 1, ruleId: 'semi', message: 'warn only' },
      ],
    },
  ]);
  const j = parseEslint(json);
  assert.equal(j.length, 1);
  assert.equal(j[0].code, 'no-unused-vars');
});

test('parseRuff text and json', () => {
  const text = 'src/a.py:10:5: E501 Line too long (120 > 100)';
  const rows = parseRuff(text);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].code, 'E501');

  const json = JSON.stringify([
    {
      filename: 'src/b.py',
      location: { row: 4, column: 2 },
      code: 'F401',
      message: 'unused import',
    },
  ]);
  const j = parseRuff(json);
  assert.equal(j[0].code, 'F401');
  assert.equal(j[0].line, 4);
});

test('parseMypy with and without col and code', () => {
  const text = [
    'src/a.py:10: error: Incompatible types  [assignment]',
    'src/b.py:3:5: error: Name "x" is not defined',
  ].join('\n');
  const rows = parseMypy(text);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].code, 'assignment');
  assert.equal(rows[1].line, 3);
  assert.equal(rows[1].col, 5);
});

test('parseAuto picks tsc when TS codes present', () => {
  const rows = parseAuto("src/a.ts(1,1): error TS1005: ';' expected.");
  assert.ok(rows.length >= 1);
  assert.equal(rows[0].tool, 'tsc');
});

test('shardDiagnostics groups by package and respects maxPerShard', () => {
  const diags = [];
  for (let i = 0; i < 3; i++) {
    diags.push({
      tool: 'tsc',
      file: `src/orders/f${i}.ts`,
      line: i,
      col: 1,
      code: 'TS1',
      message: 'x',
      package: 'src/orders',
    });
  }
  diags.push({
    tool: 'tsc',
    file: 'src/users/a.ts',
    line: 1,
    col: 1,
    code: 'TS1',
    message: 'y',
    package: 'src/users',
  });
  const shards = shardDiagnostics(diags, { maxPerShard: 2 });
  assert.ok(shards.length >= 2);
  const orders = shards.filter((s) => s.package === 'src/orders');
  assert.equal(orders.length, 2); // 3 errors → 2 shards at max 2
  assert.equal(orders[0].error_count, 2);
  assert.equal(orders[1].error_count, 1);
});

test('diagnostics-shard CLI writes errors.jsonl and shards.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diag-shard-'));
  const capture = path.join(dir, 'tsc.txt');
  fs.writeFileSync(
    capture,
    "src/a.ts(1,1): error TS2322: Type 'string' is not assignable.\n"
  );
  const code = runShard(
    ['--tool', 'tsc', '--from-file', capture, '--out-dir', path.join(dir, 'out')],
    dir
  );
  assert.equal(code, 0);
  const errors = fs.readFileSync(path.join(dir, 'out', 'errors.jsonl'), 'utf8').trim();
  assert.ok(errors.includes('TS2322'));
  const shards = JSON.parse(fs.readFileSync(path.join(dir, 'out', 'shards.json'), 'utf8'));
  assert.equal(shards.total_errors, 1);
  assert.equal(shards.shard_count, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});
