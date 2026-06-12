'use strict';

// The round-trip script proves down-migrations actually run. The DB-touching
// paths need a live database; these tests cover detection, the prisma
// no-down-path verdict, and the missing-DATABASE_URL guard (exit 2 = "not
// proven", never a silent pass).

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { test } = require('node:test');

const script = path.join(__dirname, '..', '.claude', 'scripts', 'migration-roundtrip.sh');

function run(dir, args = [], env = {}) {
  return spawnSync('bash', [script, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: '', ...env },
  });
}

function projectWith(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-rt-'));
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  return dir;
}

test('detects alembic, django, prisma, knex, and none', () => {
  const cases = [
    [{ 'alembic.ini': '' }, 'alembic'],
    [{ 'manage.py': '' }, 'django'],
    [{ 'prisma/schema.prisma': '' }, 'prisma'],
    [{ 'knexfile.js': '' }, 'knex'],
  ];
  for (const [files, expected] of cases) {
    const res = run(projectWith(files), ['--detect-only']);
    assert.strictEqual(res.status, 0, res.stdout + res.stderr);
    assert.ok(res.stdout.includes(`migration tool: ${expected}`), res.stdout);
  }
  const none = run(projectWith({}), ['--detect-only']);
  assert.strictEqual(none.status, 2);
});

test('prisma reports no-down-migration as UNSUPPORTED (exit 2), never a pass', () => {
  const res = run(projectWith({ 'prisma/schema.prisma': '' }));
  assert.strictEqual(res.status, 2, res.stdout + res.stderr);
  assert.ok(/no down migrations/i.test(res.stderr), res.stderr);
});

test('refuses to run without DATABASE_URL and says why', () => {
  const res = run(projectWith({ 'alembic.ini': '' }));
  assert.strictEqual(res.status, 2, res.stdout + res.stderr);
  assert.ok(/DATABASE_URL/.test(res.stderr), res.stderr);
  assert.ok(/DISPOSABLE/i.test(res.stderr), res.stderr);
});
