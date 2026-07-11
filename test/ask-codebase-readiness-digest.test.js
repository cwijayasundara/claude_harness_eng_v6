'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const ask = require('../.claude/scripts/ask-codebase');
const digest = require('../.claude/scripts/readiness-digest');

function tmp() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ask-'));
  fs.mkdirSync(path.join(root, 'specs', 'brownfield'), { recursive: true });
  fs.mkdirSync(path.join(root, 'specs', 'reviews'), { recursive: true });
  fs.mkdirSync(path.join(root, '.claude', 'state'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  return root;
}

test('ask-codebase renders markdown with citations from pack', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'src', 'session.py'), 'def validate_session(token):\n    return True\n');
  fs.writeFileSync(path.join(root, 'specs/brownfield/code-graph.json'), JSON.stringify({
    files: [{
      path: 'src/session.py',
      symbols: [{ name: 'validate_session', kind: 'function', line: 1, end: 2, signature: 'validate_session(token)' }],
    }],
    edges: [],
    metrics: { files: 1, hubs: [] },
  }));
  fs.mkdirSync(path.join(root, 'specs/brownfield/wiki'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs/brownfield/wiki/WIKI.md'), '# Wiki\n\nSession validation lives in session.py\n');

  const { md, pack } = ask.ask({ root, question: 'where is session validation', budget: 800 });
  assert.ok(md.includes('Ask the codebase'));
  assert.ok(md.includes('session'));
  assert.ok(pack);
  const code = ask.main(['--root', root, 'where is session validation']);
  assert.equal(code, 0);
  assert.ok(fs.existsSync(path.join(root, 'specs/reviews/ask-last.md')));
});

test('readiness-digest writes alerts when quality-card missing', () => {
  const root = tmp();
  // minimal so agent-readiness pillars don't crash
  fs.writeFileSync(path.join(root, 'project-manifest.json'), JSON.stringify({
    observability: { enabled: false },
  }));
  const { digest: d, md } = digest.buildDigest(root);
  assert.ok(Array.isArray(d.alerts));
  assert.ok(d.alerts.some((a) => /quality-card/i.test(a)));
  assert.match(md, /Agent readiness digest/);
  const code = digest.main(['--root', root]);
  assert.equal(code, 0);
  assert.ok(fs.existsSync(path.join(root, 'specs/reviews/readiness-digest.md')));
});

test('harness-manifest registers new sensors with existing wired_at paths', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../harness-manifest.json'), 'utf8'));
  const ids = [
    'quality-card', 'pr-walkthrough', 'human-codebase', 'observability-static',
    'perf-smell-static', 'ask-codebase', 'readiness-digest',
  ];
  for (const id of ids) {
    const s = manifest.sensors.find((x) => x.id === id);
    assert.ok(s, `missing sensor ${id}`);
    assert.ok(s.wired_at, id);
    const abs = path.join(__dirname, '..', s.wired_at);
    assert.ok(fs.existsSync(abs), `wired_at missing on disk: ${s.wired_at}`);
  }
});
