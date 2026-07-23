'use strict';

const assert = require('assert');
const { shipsIn } = require('./helpers/pack-membership');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const qualityCard = require('../.claude/scripts/quality-card');
const walkthrough = require('../.claude/scripts/pr-walkthrough');
const prBody = require('../.claude/scripts/pr-body');
const humanCodebase = require('../.claude/scripts/human-codebase');
const obsGate = require('../.claude/scripts/observability-gate');
const perfGate = require('../.claude/scripts/perf-smell-gate');

function tmp() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-'));
  fs.mkdirSync(path.join(root, 'specs', 'reviews'), { recursive: true });
  fs.mkdirSync(path.join(root, 'specs', 'brownfield'), { recursive: true });
  fs.mkdirSync(path.join(root, '.claude', 'state'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  return root;
}

function write(root, rel, text) {
  const f = path.join(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
}

test('quality-card PASSes when evaluator + code-review pass', () => {
  const root = tmp();
  write(root, 'specs/reviews/evaluator-report.md', '# Eval\n\nVERDICT: PASS\n');
  write(root, 'specs/reviews/code-review-verdict.json', JSON.stringify({
    gate: 'code-review', pass: true, summary: { block: 0, warn: 1, info: 0 }, findings: [],
  }));
  const { card, md } = qualityCard.buildCard({ root });
  qualityCard.writeCard(root, { card, md });
  assert.equal(card.pass, true);
  assert.ok(fs.existsSync(path.join(root, 'specs/reviews/quality-card.md')));
  assert.ok(fs.existsSync(path.join(root, '.claude/state/gate-receipt.json')));
  assert.match(md, /Overall: PASS/);
});

test('quality-card FAILs when code-review has pass:false', () => {
  const root = tmp();
  write(root, 'specs/reviews/evaluator-report.md', 'VERDICT: PASS\n');
  write(root, 'specs/reviews/code-review-verdict.json', JSON.stringify({
    gate: 'code-review', pass: false, summary: { block: 2, warn: 0, info: 0 }, findings: [],
  }));
  const { card } = qualityCard.buildCard({ root });
  assert.equal(card.pass, false);
});

test('quality-card FAILs when core artifacts missing', () => {
  const root = tmp();
  const { card } = qualityCard.buildCard({ root });
  assert.equal(card.pass, false);
  const missing = card.checks.filter((c) => c.status === 'missing' && !c.optional);
  assert.ok(missing.some((c) => c.key === 'evaluator'));
  assert.ok(missing.some((c) => c.key === 'code_review'));
});

test('pr-walkthrough groups files logically not alphabetically', () => {
  const root = tmp();
  write(root, 'specs/reviews/code-review-verdict.json', JSON.stringify({
    pass: true,
    summary: { block: 0, warn: 1, info: 0 },
    findings: [{
      id: 'CR-001', level: 'WARN', confidence: 'high', axis: 'maintainability',
      file: 'src/services/orders.py', what: 'god function risk',
    }],
  }));
  write(root, 'specs/brownfield/code-graph.json', JSON.stringify({
    files: [
      { path: 'src/api/routes.py', symbols: [] },
      { path: 'src/services/orders.py', symbols: [] },
    ],
    edges: [{ source: 'src/api/routes.py', target: 'src/services/orders.py', kind: 'import' }],
  }));
  const files = [
    'tests/test_orders.py',
    'src/services/orders.py',
    'src/api/routes.py',
    'docs/README.md',
  ];
  const { data, md } = walkthrough.buildWalkthrough({
    root,
    files,
    exec: () => { throw new Error('should not git'); },
  });
  assert.equal(data.file_count, 4);
  assert.ok(data.groups.length >= 3);
  // entry before test
  const layers = data.groups.map((g) => g.layer);
  assert.ok(layers.indexOf('entry') < layers.indexOf('test'));
  assert.ok(layers.indexOf('service') < layers.indexOf('test'));
  assert.match(md, /Logical change groups/);
  assert.match(md, /5-minute human review script/);
  assert.ok(data.high_signal.some((f) => f.level === 'WARN'));
});

test('classifyFile assigns entry/domain/test', () => {
  assert.equal(walkthrough.classifyFile('src/api/routes.ts'), 'entry');
  assert.equal(walkthrough.classifyFile('src/domain/order.py'), 'domain');
  assert.equal(walkthrough.classifyFile('test/foo.test.js'), 'test');
  assert.equal(walkthrough.classifyFile('docs/guide.md'), 'docs');
});

test('pr-body refuses when quality-card fails with --require-gate', () => {
  const root = tmp();
  // no evaluator → fail
  const { pass } = prBody.composeBody({ root, title: 'x' });
  assert.equal(pass, false);
  const code = prBody.main(['--root', root, '--require-gate', '--title', 'x']);
  // main writes to stdout; exit 1
  assert.equal(code, 1);
});

test('pr-body allows draft with --no-require-gate', () => {
  const root = tmp();
  const code = prBody.main(['--root', root, '--no-require-gate', '--title', 'draft']);
  assert.equal(code, 0);
  assert.ok(fs.existsSync(path.join(root, 'specs/reviews/quality-card.md')));
  assert.ok(fs.existsSync(path.join(root, 'specs/reviews/walkthrough.md')));
});

test('human-codebase writes docs/CODEBASE.md from graph', () => {
  const root = tmp();
  write(root, 'CONTEXT.md', '# Context\n\nThis is a payments system for enterprise billing.\n');
  write(root, 'specs/brownfield/code-graph.json', JSON.stringify({
    files: [
      { path: 'src/api/main.py', symbols: [{ name: 'app', kind: 'module', line: 1 }] },
      { path: 'src/services/pay.py', symbols: [{ name: 'charge', kind: 'function', line: 10 }] },
    ],
    edges: [],
    metrics: { hubs: [{ id: 'src/services/pay.py', fan_in: 8, fan_out: 2 }], files: 2, edges: 0 },
  }));
  fs.mkdirSync(path.join(root, 'specs/brownfield/wiki/concepts'), { recursive: true });
  write(root, 'specs/brownfield/wiki/concepts/INDEX.md', '# Concepts\n\n- [src/api](src__api.md)\n');
  const { md, meta } = humanCodebase.buildHomepage({ root });
  humanCodebase.writeHomepage(root, 'docs/CODEBASE.md', { md, meta });
  assert.ok(fs.existsSync(path.join(root, 'docs/CODEBASE.md')));
  const text = fs.readFileSync(path.join(root, 'docs/CODEBASE.md'), 'utf8');
  assert.match(text, /payments system/i);
  assert.match(text, /human homepage/i);
  assert.match(text, /src\/services\/pay\.py/);
});

test('observability-gate BLOCKs empty catch and bare except pass', () => {
  const root = tmp();
  write(root, 'src/bad.js', 'function f() {\n  try { x(); } catch (e) {}\n}\n');
  write(root, 'src/bad.py', 'def f():\n    try:\n        x()\n    except Exception:\n        pass\n');
  const v = obsGate.checkFiles(root, ['src/bad.js', 'src/bad.py']);
  assert.equal(v.pass, false);
  assert.ok(v.summary.block >= 1);
  assert.ok(v.findings.some((f) => f.id === 'OBS-EMPTY-CATCH' || f.id === 'OBS-BARE-EXCEPT-PASS'));
});

test('observability-gate passes clean structured logging', () => {
  const root = tmp();
  write(root, 'src/ok.py',
    'import logging\nlogger = logging.getLogger(__name__)\n'
    + 'def handle(req):\n    logger.info("ok", extra={"request_id": req.id})\n    return 1\n');
  const v = obsGate.checkFiles(root, ['src/ok.py']);
  assert.equal(v.pass, true);
});

test('perf-smell-gate flags query inside loop', () => {
  const root = tmp();
  write(root, 'src/n1.py',
    'async def load(items, db):\n'
    + '    out = []\n'
    + '    for item in items:\n'
    + '        row = await db.execute("select 1")\n'
    + '        out.append(row)\n'
    + '    return out\n');
  const v = perfGate.checkFiles(root, ['src/n1.py']);
  assert.equal(v.pass, false);
  assert.ok(v.findings.some((f) => f.id === 'PERF-N1-LOOP-QUERY'));
});

test('gate skill wires quality-card and observability steps', () => {
  const skill = fs.readFileSync(path.join(__dirname, '../.claude/skills/gate/SKILL.md'), 'utf8');
  // Step 4 receipts are still invoked directly by the skill (kernel-owned).
  assert.match(skill, /quality-card\.js/);
  assert.match(skill, /pr-walkthrough\.js/);
  assert.match(skill, /human-codebase\.js/);
  assert.match(skill, /Step 4/);

  // The static production-readiness ratchets moved into the pack-contributed check
  // registry, so assert membership there rather than a name in the prose.
  const { loadRegistry } = require('../.claude/scripts/run-gate-checks.js');
  const scripts = loadRegistry(path.join(__dirname, '..')).map((c) => c.script);
  assert.ok(scripts.includes('observability-gate.js'), '/gate must run the observability ratchet');
  assert.ok(scripts.includes('perf-smell-gate.js'), '/gate must run the perf-smell ratchet');
});

test('build Phase 11 requires pr-body.js', () => {
  const phase = fs.readFileSync(
    path.join(__dirname, '../.claude/skills/build/references/section-04-pipeline-phases.md'),
    'utf8',
  );
  assert.match(phase, /pr-body\.js/);
  assert.match(phase, /--require-gate/);
  const auto = fs.readFileSync(
    path.join(__dirname, '../.claude/skills/build/references/autonomous-lane.md'),
    'utf8',
  );
  assert.match(auto, /pr-body\.js/);
});

test('the human-trust scripts ship to a scaffolded project', () => {
  // Each must reach a real install. ask-codebase belongs to the brownfield pack, so
  // it ships in the brownfield/full profiles rather than core — asserted where it
  // actually lands rather than assuming everything is core.
  for (const name of ['quality-card', 'pr-walkthrough', 'pr-body', 'human-codebase',
    'observability-gate', 'perf-smell-gate', 'readiness-digest']) {
    assert.ok(shipsIn(name, 'script').includes('core'), `${name} must ship in the core profile`);
  }
  assert.ok(shipsIn('ask-codebase', 'script').includes('brownfield'),
    'ask-codebase must ship wherever the brownfield pack does');
});
