'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const { adviseTokenUsage } = require('../.claude/hooks/token-advisor');

const ROOT = path.join(__dirname, '..');

function tempProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-advisor-'));
  fs.mkdirSync(path.join(dir, '.claude', 'state'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'specs', 'brownfield'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'project-manifest.json'), JSON.stringify({
    token_governor: {
      enabled: true,
      mode: 'advisory',
      max_source_read_lines: 300,
      compress_tool_output: true,
      preserve_full_outputs: true,
    },
  }));
  return dir;
}

function writeGraph(dir, filePath) {
  fs.writeFileSync(path.join(dir, 'specs', 'brownfield', 'code-graph.json'), JSON.stringify({
    files: [
      { path: filePath, symbols: [{ name: 'validateSession', kind: 'function', start: 40, end: 80 }] },
    ],
    nodes: [],
    edges: [],
  }));
}

test('token advisor warns on broad source reads when symbol ranges exist', () => {
  const dir = tempProject();
  try {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'auth.js'), Array.from({ length: 360 }, (_, i) => `line ${i}`).join('\n'));
    writeGraph(dir, 'src/auth.js');

    const result = adviseTokenUsage({
      projectDir: dir,
      input: { tool_name: 'Read', tool_input: { file_path: path.join(dir, 'src', 'auth.js') } },
    });

    assert.strictEqual(result.decision, 'warn');
    assert.match(result.message, /broad source read/i);
    assert.match(result.message, /\/context/);
    assert.match(result.message, /src\/auth\.js/);
    const log = fs.readFileSync(path.join(dir, '.claude', 'state', 'token-advisor.jsonl'), 'utf8');
    assert.match(log, /broad_source_read/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('token advisor stays quiet for small source reads', () => {
  const dir = tempProject();
  try {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'small.js'), 'const ok = true;\n');
    writeGraph(dir, 'src/small.js');

    const result = adviseTokenUsage({
      projectDir: dir,
      input: { tool_name: 'Read', tool_input: { file_path: path.join(dir, 'src', 'small.js') } },
    });

    assert.strictEqual(result.decision, 'ok');
    assert.strictEqual(fs.existsSync(path.join(dir, '.claude', 'state', 'token-advisor.jsonl')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('token advisor suggests run-compact for likely verbose commands', () => {
  const dir = tempProject();
  try {
    const result = adviseTokenUsage({
      projectDir: dir,
      input: { tool_name: 'Bash', tool_input: { command: 'npm test' } },
    });

    assert.strictEqual(result.decision, 'warn');
    assert.match(result.message, /run-compact\.js --kind test -- npm test/);
    const log = fs.readFileSync(path.join(dir, '.claude', 'state', 'token-advisor.jsonl'), 'utf8');
    assert.match(log, /verbose_command/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('token advisor hook is wired for Read and Bash in settings', () => {
  const settings = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude', 'settings.json'), 'utf8'));
  const commands = (settings.hooks.PreToolUse || [])
    .filter((entry) => /Read/.test(entry.matcher || '') && /Bash/.test(entry.matcher || ''))
    .flatMap((entry) => (entry.hooks || []).map((h) => h.command || ''));

  assert.ok(commands.some((cmd) => cmd.includes('token-advisor.js')), 'token-advisor.js must be wired on Read|Bash');
});
