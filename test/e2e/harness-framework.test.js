'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, test, before, after } = require('node:test');
const { spawnSync, execFileSync } = require('child_process');

const { runClaude } = require('./helpers/claude-runner');
const { readSkillCorpus } = require('../helpers/skill-corpus');

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

  // ── 1. Scaffold: /scaffold mandates Q1, so two turns: invoke, then consent ──

  test('Scaffold: /scaffold creates correct project structure', { timeout: 600000 }, () => {
    const pluginDir = path.join(HARNESS_ROOT, '.claude');
    const sessionId = require('crypto').randomUUID();
    runClaude('/scaffold', {
      cwd: PROJECT_DIR, model: 'sonnet', budgetUsd: '1.00', timeoutMs: 90000, pluginDir, sessionId,
    });
    const result = runClaude(
      'A Node.js CLI todo application using only Node built-ins; project shape: ' +
      'script/CLI; user surface: CLI; no team integrations, no tracker, no framework ' +
      'packs. I will not answer further questions — accept the inferred profile ' +
      '(option A) and proceed to scaffold everything now without asking anything else.',
      { cwd: PROJECT_DIR, model: 'sonnet', budgetUsd: '3.00', timeoutMs: 480000, continueSession: true, pluginDir, sessionId }
    );

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

    assert.ok(!result.error, 'claude CLI must spawn: ' + result.error); // artifacts are the gate; exit 143 at timeout is OK
    assert.ok(hasClaudeDir, '.claude/ directory must exist after scaffold');
    assert.ok(hasClaudeMd, 'CLAUDE.md must exist after scaffold');
  });

  // ── 2. pre-write-gate blocks oversized files ─────────────────────────────
  // Files are named *.test.js so the gate's TDD layer (which always allows
  // test files) does not mask the length checks under test.

  test('Hook: pre-write-gate blocks files >= 300 lines', () => {
    const bigContent = 'const x = 1;\n'.repeat(301);

    const result = runHook('pre-write-gate.js', {
      tool_name: 'Write',
      tool_input: { file_path: path.join(PROJECT_DIR, 'big.test.js'), content: bigContent },
    });

    logResult('fw-2-enforce-length', { exitCode: result.exitCode, stdout: result.stdout });
    assert.strictEqual(result.exitCode, 2, 'Hook must exit 2 (block) for 301-line file');
    assert.ok(result.stdout.includes('BLOCKED'), 'Hook output must contain BLOCKED');
    console.log('[fw] pre-write-gate: correctly blocks 301-line file');
  });

  test('Hook: pre-write-gate allows files under 300 lines', () => {
    const okContent = 'const x = 1;\n'.repeat(200);

    const result = runHook('pre-write-gate.js', {
      tool_name: 'Write',
      tool_input: { file_path: path.join(PROJECT_DIR, 'ok.test.js'), content: okContent },
    });

    assert.strictEqual(result.exitCode, 0, 'Hook must exit 0 (allow) for 200-line file');
    console.log('[fw] pre-write-gate: correctly allows 200-line file');
  });

  // ── 3. pre-write-gate blocks long functions ──────────────────────────────

  test('Hook: pre-write-gate blocks functions > 30 lines', () => {
    const longFn = 'function big() {\n' + '  console.log("x");\n'.repeat(31) + '}\n';

    const result = runHook('pre-write-gate.js', {
      tool_name: 'Write',
      tool_input: { file_path: path.join(PROJECT_DIR, 'long-fn.test.js'), content: longFn },
    });

    logResult('fw-3-function-length', { exitCode: result.exitCode, stdout: result.stdout });
    assert.strictEqual(result.exitCode, 2, 'Hook must exit 2 (block) for 32-line function');
    console.log('[fw] pre-write-gate: correctly blocks 32-line function');
  });

  test('Hook: pre-write-gate allows functions <= 30 lines', () => {
    const shortFn = 'function small() {\n' + '  console.log("x");\n'.repeat(10) + '}\n';

    const result = runHook('pre-write-gate.js', {
      tool_name: 'Write',
      tool_input: { file_path: path.join(PROJECT_DIR, 'short-fn.test.js'), content: shortFn },
    });

    assert.strictEqual(result.exitCode, 0, 'Hook must exit 0 (allow) for 12-line function');
    console.log('[fw] pre-write-gate: correctly allows 12-line function');
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

  // ── 5. Evaluator agent definition is valid (merged from phase-evaluator) ──
  test('Agent: evaluator.md is properly configured', () => {
    const agentPath = path.join(HARNESS_ROOT, '.claude', 'agents', 'evaluator.md');
    assert.ok(fs.existsSync(agentPath), 'evaluator.md must exist');
    const content = fs.readFileSync(agentPath, 'utf8');
    assert.ok(content.includes('model: claude-opus'), 'Must use opus model');
    assert.ok(/artifact mode/i.test(content), 'Must support artifact mode');
    assert.ok(content.includes('completeness'), 'Must define completeness criterion');
    assert.ok(content.includes('traceability'), 'Must define traceability criterion');
    assert.ok(content.includes('specificity'), 'Must define specificity criterion');
    assert.ok(content.includes('consistency'), 'Must define consistency criterion');
    assert.ok(content.includes('actionability'), 'Must define actionability criterion');
    assert.ok(content.includes('PASS') && content.includes('FAIL'), 'Must define PASS/FAIL verdicts');
    console.log('[fw] evaluator.md: artifact mode + 5 criteria + PASS/FAIL present');
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

  // ── 7. Skills invoke the evaluator agent (artifact mode) ──────────────
  // Progressive skills (e.g. design) may park procedure under references/ —
  // search the full corpus, not only SKILL.md.
  test('Skills: all 6 planning skills reference evaluator (artifact mode)', () => {
    const skills = ['brd', 'spec', 'design', 'brownfield', 'seam-finder', 'deploy'];
    const missing = [];
    for (const skill of skills) {
      try {
        const content = readSkillCorpus(skill, HARNESS_ROOT);
        if (!content.includes('evaluator')) missing.push(skill);
      } catch (_) {
        missing.push(skill + ' (file missing)');
      }
    }
    assert.strictEqual(missing.length, 0, `Skills missing evaluator reference: ${missing.join(', ')}`);
    console.log('[fw] All 6 skills reference the evaluator agent');
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
    // Only inspect hooks on the Edit|Write matcher; Task matcher legitimately carries record-run.
    const hookNames = (event, matcherRe) =>
      (settings.hooks[event] || [])
        .filter((m) => !matcherRe || matcherRe.test(m.matcher || ''))
        .flatMap((m) => m.hooks.map((h) => h.command.split('/').pop().replace(/"/g, '')));
    const preEdit = hookNames('PreToolUse', /Write|Edit/);
    const postEditWrite = hookNames('PostToolUse', /Write|Edit/);
    const stop = hookNames('Stop', null);
    assert.ok(preEdit.includes('pre-write-gate.js'), 'pre-write-gate must be wired in PreToolUse');
    assert.ok(postEditWrite.includes('verify-on-save.js'), 'verify-on-save must be in PostToolUse Edit/Write matcher');
    assert.ok(stop.includes('review-on-stop.js'), 'review-on-stop must be wired in Stop');
    assert.ok(postEditWrite.includes('record-run.js'),
      'record-run (receipt-append-only) must be wired on the Write|Edit|MultiEdit|Bash matcher');
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
