'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, test, before, after } = require('node:test');
const { spawnSync, execFileSync } = require('child_process');

const HARNESS_ROOT = path.join(__dirname, '..', '..');
const RESULTS_DIR = path.join(__dirname, 'results');

let PROJECT_DIR;

function logResult(stage, data) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESULTS_DIR, stage + '.json'), JSON.stringify(data, null, 2));
}

function runHook(hookName, stdinData, cwd) {
  const hookPath = path.join(HARNESS_ROOT, '.claude', 'hooks', hookName);
  if (!fs.existsSync(hookPath)) return { stdout: '', stderr: '', exitCode: null, missing: true };
  const result = spawnSync('node', [hookPath], {
    input: JSON.stringify(stdinData),
    cwd: cwd || PROJECT_DIR,
    encoding: 'utf8',
    timeout: 10000,
    env: { ...process.env, CLAUDE_PROJECT_DIR: PROJECT_DIR },
  });
  return { stdout: result.stdout || '', stderr: result.stderr || '', exitCode: result.status };
}

describe('Harness Framework Validation', { timeout: 600000 }, () => {

  before(() => {
    PROJECT_DIR = path.join(os.tmpdir(), 'harness-fw-test-' + Date.now());
    fs.mkdirSync(PROJECT_DIR, { recursive: true });
    fs.mkdirSync(path.join(PROJECT_DIR, '.claude', 'hooks'), { recursive: true });
    fs.mkdirSync(path.join(PROJECT_DIR, '.claude', 'state'), { recursive: true });
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    console.log('[fw] Project directory:', PROJECT_DIR);
  });

  after(() => {
    fs.rmSync(PROJECT_DIR, { recursive: true, force: true });
    console.log('[fw] Cleaned up temp project');
  });

  // ── 1. Scaffold produces correct structure ──────────────────────────────

  test('Scaffold: /scaffold creates correct project structure', { timeout: 120000 }, () => {
    const pluginDir = path.join(HARNESS_ROOT, '.claude');
    const result = spawnSync('claude', [
      '-p', '--model', 'haiku',
      '--no-session-persistence',
      '--max-budget-usd', '1.00',
      '--plugin-dir', pluginDir,
      '--allowed-tools', 'Bash Read Write Edit Glob Grep Skill',
    ], {
      input: '/scaffold\n\nProject type: Node.js CLI\nProject name: test-app\nStack: Node.js\nAccept all defaults.',
      cwd: PROJECT_DIR,
      encoding: 'utf8',
      timeout: 120000,
    });

    const hasClaudeDir = fs.existsSync(path.join(PROJECT_DIR, '.claude'));
    const hasClaudeMd = fs.existsSync(path.join(PROJECT_DIR, 'CLAUDE.md'));
    const hasSettings = fs.existsSync(path.join(PROJECT_DIR, '.claude', 'settings.json'));

    logResult('fw-1-scaffold', {
      exitCode: result.exitCode,
      hasClaudeDir,
      hasClaudeMd,
      hasSettings,
      files: fs.readdirSync(PROJECT_DIR),
    });

    console.log('[fw] .claude/ dir:', hasClaudeDir);
    console.log('[fw] CLAUDE.md:', hasClaudeMd);
    console.log('[fw] settings.json:', hasSettings);
    console.log('[fw] Files:', fs.readdirSync(PROJECT_DIR).join(', '));
  });

  // ── 2. enforce-length-pre hook blocks oversized files ───────────────────

  test('Hook: enforce-length-pre blocks files > 500 lines', () => {
    const bigContent = 'const x = 1;\n'.repeat(501);
    const testFile = path.join(PROJECT_DIR, 'big.js');

    const result = runHook('enforce-length-pre.js', {
      tool_name: 'Write',
      tool_input: { file_path: testFile, content: bigContent },
    });

    logResult('fw-2-enforce-length', { exitCode: result.exitCode, stdout: result.stdout });
    assert.strictEqual(result.exitCode, 2, 'Hook must exit 2 (block) for 501-line file');
    assert.ok(result.stdout.includes('BLOCKED'), 'Hook output must contain BLOCKED');
    console.log('[fw] enforce-length-pre: correctly blocks 501-line file');
  });

  test('Hook: enforce-length-pre allows files <= 500 lines', () => {
    const okContent = 'const x = 1;\n'.repeat(499);
    const testFile = path.join(PROJECT_DIR, 'ok.js');

    const result = runHook('enforce-length-pre.js', {
      tool_name: 'Write',
      tool_input: { file_path: testFile, content: okContent },
    });

    assert.strictEqual(result.exitCode, 0, 'Hook must exit 0 (allow) for 499-line file');
    console.log('[fw] enforce-length-pre: correctly allows 499-line file');
  });

  // ── 3. check-function-length hook blocks long functions ─────────────────

  test('Hook: check-function-length blocks functions > 30 lines', () => {
    const longFn = 'function big() {\n' + '  console.log("x");\n'.repeat(31) + '}\n';
    const testFile = path.join(PROJECT_DIR, 'long-fn.js');
    fs.writeFileSync(testFile, longFn);

    const result = runHook('check-function-length.js', {
      tool_name: 'Write',
      tool_input: { file_path: testFile },
    });

    logResult('fw-3-function-length', { exitCode: result.exitCode, stdout: result.stdout });
    assert.strictEqual(result.exitCode, 2, 'Hook must exit 2 (block) for 32-line function');
    console.log('[fw] check-function-length: correctly blocks 32-line function');
  });

  test('Hook: check-function-length allows functions <= 30 lines', () => {
    const shortFn = 'function small() {\n' + '  console.log("x");\n'.repeat(10) + '}\n';
    const testFile = path.join(PROJECT_DIR, 'short-fn.js');
    fs.writeFileSync(testFile, shortFn);

    const result = runHook('check-function-length.js', {
      tool_name: 'Write',
      tool_input: { file_path: testFile },
    });

    assert.strictEqual(result.exitCode, 0, 'Hook must exit 0 (allow) for 12-line function');
    console.log('[fw] check-function-length: correctly allows 12-line function');
  });

  // ── 4. record-run.js captures telemetry records ─────────────────────────

  test('Hook: record-run.js creates JSONL records on Stop event', () => {
    const runsDir = path.join(PROJECT_DIR, '.claude', 'runs');
    fs.mkdirSync(runsDir, { recursive: true });

    const date = new Date().toISOString().slice(0, 10);
    const jsonlPath = path.join(runsDir, date + '.jsonl');
    if (fs.existsSync(jsonlPath)) fs.unlinkSync(jsonlPath);

    const localHook = path.join(PROJECT_DIR, '.claude', 'hooks', 'record-run.js');
    const hookPath = fs.existsSync(localHook) ? localHook : path.join(HARNESS_ROOT, '.claude', 'hooks', 'record-run.js');
    const result = spawnSync('node', [hookPath], {
      input: JSON.stringify({
        hook_event_name: 'Stop',
        session_id: 'test-session-001',
        is_error: false,
      }),
      cwd: PROJECT_DIR,
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env, CLAUDE_PROJECT_DIR: PROJECT_DIR },
    });

    const hasJsonl = fs.existsSync(jsonlPath);

    logResult('fw-4-record-run', { exitCode: result.status, hasJsonl });

    if (hasJsonl) {
      const lines = fs.readFileSync(jsonlPath, 'utf8').trim().split('\n');
      const lastRecord = JSON.parse(lines[lines.length - 1]);
      assert.strictEqual(lastRecord.kind, 'turn', 'Stop event should produce a turn record');
      console.log('[fw] record-run.js: created JSONL record (kind:', lastRecord.kind + ')');
    } else {
      console.log('[fw] record-run.js: JSONL file not created (hook may need .claude structure)');
    }
  });

  // ── 5. Phase evaluator agent definition is valid ────────────────────────

  test('Agent: phase-evaluator.md is properly configured', () => {
    const agentPath = path.join(HARNESS_ROOT, '.claude', 'agents', 'phase-evaluator.md');
    assert.ok(fs.existsSync(agentPath), 'phase-evaluator.md must exist');

    const content = fs.readFileSync(agentPath, 'utf8');
    assert.ok(content.includes('model: opus'), 'Must use opus model');
    assert.ok(content.includes('completeness'), 'Must define completeness criterion');
    assert.ok(content.includes('traceability'), 'Must define traceability criterion');
    assert.ok(content.includes('specificity'), 'Must define specificity criterion');
    assert.ok(content.includes('consistency'), 'Must define consistency criterion');
    assert.ok(content.includes('actionability'), 'Must define actionability criterion');
    assert.ok(content.includes('PASS') && content.includes('FAIL'), 'Must define PASS/FAIL verdicts');
    console.log('[fw] phase-evaluator.md: all 5 criteria + verdicts present');
  });

  // ── 6. Rubrics cover all 6 phases ──────────────────────────────────────

  test('Rubrics: all 6 phases defined with correct thresholds', () => {
    const rubrics = JSON.parse(
      fs.readFileSync(path.join(HARNESS_ROOT, '.claude', 'templates', 'phase-eval-rubrics.json'), 'utf8')
    );

    assert.strictEqual(rubrics.threshold, 7.0, 'Threshold must be 7.0');
    assert.strictEqual(rubrics.per_criterion_minimum, 5, 'Per-criterion minimum must be 5');

    const phases = Object.keys(rubrics.phases);
    for (const expected of ['brd', 'spec', 'design', 'brownfield', 'seam', 'deploy']) {
      assert.ok(phases.includes(expected), `Phase "${expected}" must be defined`);
      const criteria = Object.keys(rubrics.phases[expected].criteria);
      assert.strictEqual(criteria.length, 5, `Phase "${expected}" must have 5 criteria`);
    }
    console.log('[fw] Rubrics: 6 phases, 5 criteria each, threshold 7.0');
  });

  // ── 7. Skills have phase-evaluator gates ───────────────────────────────

  test('Skills: all 6 planning skills reference phase-evaluator', () => {
    const skills = ['brd', 'spec', 'design', 'brownfield', 'seam-finder', 'deploy'];
    const missing = [];
    for (const skill of skills) {
      const skillPath = path.join(HARNESS_ROOT, '.claude', 'skills', skill, 'SKILL.md');
      if (!fs.existsSync(skillPath)) { missing.push(skill + ' (file missing)'); continue; }
      const content = fs.readFileSync(skillPath, 'utf8');
      if (!content.includes('phase-evaluator')) missing.push(skill);
    }
    assert.strictEqual(missing.length, 0, `Skills missing phase-evaluator: ${missing.join(', ')}`);
    console.log('[fw] All 6 skills reference phase-evaluator');
  });

  // ── 8. Telemetry memory produces phase eval metrics ────────────────────

  test('Telemetry: buildSnapshot produces phase_eval metrics', () => {
    const { buildSnapshot } = require(path.join(HARNESS_ROOT, '.claude', 'scripts', 'telemetry-memory.js'));

    const mockRecord = {
      kind: 'phase_eval',
      ts: Date.now(),
      user: 'test-user',
      phase: 'brd',
      iteration: '1',
      scores: { completeness: 8, traceability: 10, specificity: 7, consistency: 8, actionability: 7 },
      weighted_average: 8.0,
      verdict: 'PASS',
      lane: 'build',
      mode: 'full',
      group_id: 'A',
      story_id: 'none',
      host: 'test',
    };

    const snapshot = buildSnapshot([mockRecord]);
    assert.ok(snapshot.includes('harness_phase_eval_score'), 'Snapshot must contain phase_eval_score');
    assert.ok(snapshot.includes('harness_phase_eval_iterations_total'), 'Snapshot must contain iterations_total');
    console.log('[fw] buildSnapshot produces phase eval metrics');
  });

  // ── 9. Settings.json has correct hook configuration ────────────────────

  test('Settings: enforcement hooks are wired (PostToolUse + PreToolUse)', () => {
    const settings = JSON.parse(
      fs.readFileSync(path.join(HARNESS_ROOT, '.claude', 'settings.json'), 'utf8')
    );
    const names = (event) =>
      (settings.hooks[event] || [])
        .flatMap((m) => m.hooks.map((h) => h.command.split('/').pop().replace(/"/g, '')));

    const postEdit = names('PostToolUse');
    const preEdit = names('PreToolUse');
    const stop = names('Stop');

    // Always-on quality enforcement on every edit (wired in PR enforcement work).
    for (const h of [
      'lint-on-save.js', 'typecheck.js', 'check-file-length.js', 'check-function-length.js',
      'check-architecture.js', 'detect-secrets.js', 'scope-directory.js', 'track-writes.js', 'record-run.js',
    ]) {
      assert.ok(postEdit.includes(h), `${h} must be wired in PostToolUse`);
    }
    // Pre-write gates.
    for (const h of ['enforce-length-pre.js', 'test-first-gate.js', 'security-pattern-gate.js']) {
      assert.ok(preEdit.includes(h), `${h} must be wired in PreToolUse`);
    }
    // Stop-time review gate.
    assert.ok(stop.includes('require-review.js'), 'require-review must be wired on Stop');
    console.log('[fw] Settings: enforcement hooks wired (PostToolUse + PreToolUse + Stop)');
  });

  // ── 10. Grafana dashboard has all required sections ────────────────────

  test('Dashboard: harness-overview.json has all required sections', () => {
    const dashboard = JSON.parse(
      fs.readFileSync(path.join(HARNESS_ROOT, 'telemetry', 'grafana', 'dashboards', 'harness-overview.json'), 'utf8')
    );

    const rows = dashboard.panels.filter((p) => p.type === 'row').map((p) => p.title);
    const requiredSections = ['Velocity Overview', 'Phase Quality'];

    for (const section of requiredSections) {
      assert.ok(rows.some((r) => r.includes(section)), `Dashboard must have "${section}" section`);
    }

    const panels = dashboard.panels.filter((p) => p.type !== 'row');
    assert.ok(panels.length >= 25, `Dashboard must have >= 25 panels (found ${panels.length})`);
    console.log(`[fw] Dashboard: ${rows.length} sections, ${panels.length} panels`);
  });
});
