'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const { buildMaps } = require('../.claude/scripts/nav-brownfield-maps');
const { buildGraphIndex, lookupSymbol } = require('../.claude/scripts/nav-graph-index');
const { runBench } = require('../.claude/scripts/nav-bench');
const { buildContextPack } = require('../.claude/scripts/context-pack');
const { adviseTokenUsage } = require('../.claude/hooks/token-advisor');

const ROOT = path.join(__dirname, '..');

function tempProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nav-rem-'));
  fs.mkdirSync(path.join(dir, 'specs', 'brownfield', 'wiki', 'pages'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.claude', 'state'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src', 'auth'), { recursive: true });
  return dir;
}

function writeGraph(dir) {
  const graph = {
    meta: { producer: 'vendored-ast', generated_at: '2026-07-11T00:00:00Z' },
    nodes: [
      { id: 'js:src/auth/session.js', kind: 'file', path: 'src/auth/session.js', language: 'javascript' },
      { id: 'js:src/auth/session.test.js', kind: 'file', path: 'src/auth/session.test.js', language: 'javascript' },
    ],
    files: [
      {
        path: 'src/auth/session.js',
        symbols: [{ name: 'validateSession', kind: 'function', start: 1, end: 10, signature: 'function validateSession()' }],
      },
      {
        path: 'src/auth/session.test.js',
        symbols: [{ name: 'test_validate', kind: 'function', start: 1, end: 5 }],
      },
    ],
    edges: [
      { source: 'js:src/auth/session.test.js', target: 'js:src/auth/session.js', kind: 'calls' },
    ],
    metrics: {
      hubs: [{ id: 'js:src/auth/session.js', fan_in: 8, fan_out: 1, instability: 0.1 }],
      cycles: [],
      unstable_hubs: [],
    },
  };
  fs.writeFileSync(path.join(dir, 'specs', 'brownfield', 'code-graph.json'), JSON.stringify(graph, null, 2));
  fs.writeFileSync(path.join(dir, 'src', 'auth', 'session.js'), 'function validateSession() { return true; }\n');
  fs.writeFileSync(path.join(dir, 'src', 'auth', 'session.test.js'), 'test("x", () => {});\n');
  fs.writeFileSync(path.join(dir, 'specs', 'brownfield', 'wiki', 'WIKI.md'), '# Wiki\n\nSession validation.\n');
}

test('nav-brownfield-maps writes five lean maps', () => {
  const dir = tempProject();
  try {
    writeGraph(dir);
    const r = buildMaps({ projectDir: dir, goal: 'harden session validation' });
    assert.ok(r.ok, JSON.stringify(r));
    for (const name of r.written) {
      const p = path.join(dir, 'specs', 'brownfield', name);
      assert.ok(fs.existsSync(p), name);
      const text = fs.readFileSync(p, 'utf8');
      assert.match(text, /Deterministic/i);
    }
    assert.match(fs.readFileSync(path.join(dir, 'specs', 'brownfield', 'change-strategy.md'), 'utf8'), /nav-query\.js pack|context-pack/);
    assert.match(fs.readFileSync(path.join(dir, 'specs', 'brownfield', 'risk-map.md'), 'utf8'), /auth/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('nav-graph-index supports O(1) symbol lookup', () => {
  const dir = tempProject();
  try {
    writeGraph(dir);
    const built = buildGraphIndex({ projectDir: dir });
    assert.ok(built.ok);
    const hits = lookupSymbol(dir, 'validateSession');
    assert.strictEqual(hits.length, 1);
    assert.strictEqual(hits[0].path, 'src/auth/session.js');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('nav-bench reports recall on fixture golden set', () => {
  const dir = tempProject();
  try {
    writeGraph(dir);
    const golden = {
      queries: [
        { id: 's1', question: 'validateSession', expect_paths: ['src/auth/session.js'] },
        { id: 's2', question: 'session auth', expect_paths: ['src/auth/session.js'] },
      ],
    };
    const gPath = path.join(dir, 'golden.json');
    fs.writeFileSync(gPath, JSON.stringify(golden));
    const summary = runBench({ projectDir: dir, goldenPath: gPath, budgetTokens: 2000 });
    assert.ok(summary.ok);
    assert.strictEqual(summary.queries, 2);
    assert.ok(summary.recall_rate >= 0.5, JSON.stringify(summary));
    assert.ok(summary.avg_pack_tokens < summary.avg_naive_tokens_est);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('token advisor warns on unconstrained rg without context pack', () => {
  const dir = tempProject();
  try {
    writeGraph(dir);
    fs.writeFileSync(path.join(dir, 'project-manifest.json'), JSON.stringify({
      token_governor: { enabled: true, mode: 'advisory', compress_tool_output: true },
    }));
    const result = adviseTokenUsage({
      projectDir: dir,
      input: { tool_name: 'Bash', tool_input: { command: 'rg validateSession' } },
    });
    assert.strictEqual(result.decision, 'warn');
    assert.strictEqual(result.warning.kind, 'unconstrained_search');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('token advisor stays quiet for path-scoped rg', () => {
  const dir = tempProject();
  try {
    writeGraph(dir);
    fs.writeFileSync(path.join(dir, 'project-manifest.json'), JSON.stringify({
      token_governor: { enabled: true, mode: 'advisory', compress_tool_output: true },
    }));
    const result = adviseTokenUsage({
      projectDir: dir,
      input: { tool_name: 'Bash', tool_input: { command: 'rg validateSession src/auth' } },
    });
    assert.strictEqual(result.decision, 'ok');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Iron Law appears in change/feature/implement/generator skills', () => {
  const files = [
    '.claude/skills/change/SKILL.md',
    '.claude/skills/feature/SKILL.md',
    '.claude/skills/implement/SKILL.md',
    '.claude/skills/vibe/SKILL.md',
    '.claude/skills/refactor/SKILL.md',
    '.claude/agents/generator.md',
    'CLAUDE.md',
  ];
  for (const rel of files) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.match(text, /context-pack\.js|nav-query\.js pack|\/context/, rel);
  }
});

test('brownfield skill documents lean maps script', () => {
  const text = fs.readFileSync(path.join(ROOT, '.claude/skills/brownfield/SKILL.md'), 'utf8');
  assert.match(text, /nav-brownfield-maps\.js/);
  assert.match(text, /lean mode/i);
});
