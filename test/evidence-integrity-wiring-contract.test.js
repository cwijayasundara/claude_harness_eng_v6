'use strict';

// Wiring contract for the evidence-integrity sensor (gap G39) and the runtime
// evidence artifacts (gap G40). A gate that is built but not wired is inert, and
// a green unit suite hides that — so these assert the seams, not the logic.

const fs = require('fs');
const path = require('path');
const os = require('os');
const test = require('node:test');
const assert = require('node:assert');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const readJson = (p) => JSON.parse(read(p));

test('the CLI exists, reuses the tested lib, and is require-safe', () => {
  const cli = read('.claude/scripts/evidence-integrity-gate.js');
  assert.match(cli, /require\('\.\.\/hooks\/lib\/evidence-integrity'\)/, 'CLI must use the tested lib');
  assert.match(cli, /require\.main === module/, 'CLI must be require-safe');
});

test('package.json exposes the gate', () => {
  assert.strictEqual(
    readJson('package.json').scripts['evidence-integrity-gate'],
    'node .claude/scripts/evidence-integrity-gate.js'
  );
});

test('/gate runs the gate as a blocking registry check', () => {
  const { loadRegistry } = require('../.claude/scripts/run-gate-checks.js');
  const entry = loadRegistry(ROOT).find((c) => c.script === 'evidence-integrity-gate.js');
  assert.ok(entry, '/gate must run the gate via .claude/config/gate-checks.json');
  assert.strictEqual(entry.blocking, true, 'an unproven runtime pass must block, not warn');
  assert.strictEqual(entry.when, 'exists:sprint-contracts');
  assert.ok(!entry.lane_only, 'must be part of the default /gate set');
  assert.ok(entry.remediation && entry.remediation.length > 40, 'remediation must be agent-actionable');
});

test('the quality card aggregates the verdict', () => {
  assert.match(
    read('.claude/scripts/quality-card.js'),
    /evidence-integrity-verdict\.json/,
    'the single trust receipt must carry the evidence-integrity result'
  );
});

test('a failed evidence-integrity verdict fails the quality card (so no PR opens)', () => {
  const qc = require('../.claude/scripts/quality-card.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-evid-'));
  const reviews = path.join(dir, 'specs', 'reviews');
  fs.mkdirSync(reviews, { recursive: true });
  const w = (f, o) => fs.writeFileSync(path.join(reviews, f), typeof o === 'string' ? o : JSON.stringify(o));
  w('evaluator-report.md', 'VERDICT: PASS');
  w('code-review-verdict.json', { pass: true, summary: { block: 0, warn: 0 } });

  const clean = qc.buildCard({ root: dir });
  assert.strictEqual(clean.card.pass, true, 'baseline fixture must be green before the negative case');

  w('evidence-integrity-verdict.json', {
    gate: 'evidence-integrity',
    pass: false,
    findings: [{ kind: 'js-bypass', id: 'PW-1' }],
  });
  const blocked = qc.buildCard({ root: dir });
  assert.strictEqual(blocked.card.pass, false, 'an unproven runtime pass must not clear the gate receipt');
  const row = blocked.card.checks.find((c) => c.key === 'evidence_integrity');
  assert.strictEqual(row.pass, false);
});

test('the evaluator is instructed to emit the ledger and told the browser_evaluate invariant', () => {
  const agent = read('.claude/agents/evaluator.md');
  assert.match(agent, /evaluator-evidence\.json/, 'the ledger must be emitted by the evaluator');
  assert.match(agent, /browser_evaluate/, 'the invariant must name the tool it fences');
  assert.match(agent, /untested/, 'the third verdict state must be documented');
});

test('/evaluate documents the gate and folds it into the verdict', () => {
  const skill = read('.claude/skills/evaluate/SKILL.md');
  assert.match(skill, /evidence-integrity-gate\.js/, '/evaluate must run the gate');
  assert.match(skill, /failure_layer: "evidence"|"evidence"/, 'the failure layer must be declared');
  assert.match(skill, /evidence-integrity-verdict\.json#pass === true/, 'the verdict must gate the PASS');
});

test('/gate records the ordering constraint (the check reads the evaluator ledger)', () => {
  assert.match(read('.claude/skills/gate/SKILL.md'), /evidence-integrity/, '/gate must name the check');
});

test('the sensor is registered in harness-manifest.json with a justified net add', () => {
  const entry = readJson('harness-manifest.json').sensors.find((s) => s.id === 'evidence-integrity');
  assert.ok(entry, 'the control must be registered, not orphaned');
  assert.strictEqual(entry.gap_ref, 'G39');
  assert.strictEqual(entry.wired_at, '.claude/scripts/evidence-integrity-gate.js');
  assert.ok(entry.net_add_justification, 'the control budget ratchets: a net add needs a reason');
  assert.match(entry.description, /KNOWN LIMITATION/, 'the self-declared half must be disclosed');
});

test('G40: the generated Playwright config retains runtime evidence on failure', () => {
  const tpl = read('.claude/templates/playwright.config.template.ts');
  assert.match(tpl, /trace: 'retain-on-failure'/, 'on-first-retry captures nothing at retries:0');
  assert.match(tpl, /video: 'retain-on-failure'/);
  assert.match(tpl, /screenshot: 'only-on-failure'/);
  assert.match(tpl, /outputDir/, 'artifacts need a known location to cite');
});

test('G40: the evaluator cites artifact paths in its structured failure report', () => {
  assert.match(read('.claude/agents/evaluator.md'), /"artifacts": \[/, 'failures must carry artifact paths');
});

// The end-to-end round trip: a REAL schema-valid contract through the REAL /gate
// registry runner. A hand-built flat fixture would pass the unit tests while the
// gate read nothing (CLAUDE.md principle 5).
test('end to end: a js-bypass BLOCKs through the real gate runner with a real contract', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evid-e2e-'));
  fs.symlinkSync(path.join(ROOT, '.claude'), path.join(dir, '.claude'));
  fs.mkdirSync(path.join(dir, 'sprint-contracts'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'specs', 'reviews'), { recursive: true });

  const contract = {
    group: 'C',
    stories: ['E1-S1'],
    features: ['F001'],
    contract: { playwright_checks: [{ id: 'PW-1', description: 'login', steps: [{ action: 'click' }] }] },
  };
  const { validate } = require('../.claude/hooks/lib/contract-schema');
  const schema = readJson('.claude/skills/evaluate/references/contract-schema.json');
  assert.deepStrictEqual(validate(schema, contract), [], 'the fixture must be a real sprint contract');

  fs.writeFileSync(path.join(dir, 'sprint-contracts', 'C.json'), JSON.stringify(contract));
  fs.writeFileSync(
    path.join(dir, 'specs', 'reviews', 'evaluator-evidence.json'),
    JSON.stringify({
      group: 'C',
      checks: [
        {
          id: 'PW-1',
          layer: 'playwright',
          verdict: 'pass',
          interactions: ['mcp__plugin_playwright_playwright__browser_evaluate'],
        },
      ],
    })
  );

  const { execFileSync } = require('child_process');
  let code = 0;
  let out = '';
  try {
    out = execFileSync(
      process.execPath,
      [path.join(ROOT, '.claude/scripts/run-gate-checks.js'), '--root', dir, '--only', 'evidence-integrity'],
      { cwd: dir, encoding: 'utf8' }
    );
  } catch (e) {
    code = e.status;
    out = `${e.stdout || ''}${e.stderr || ''}`;
  }
  assert.strictEqual(code, 1, 'the runner must report a BLOCK');
  assert.match(out, /evidence-integrity/);
  const verdict = readJson(path.relative(ROOT, path.join(dir, 'specs/reviews/evidence-integrity-verdict.json')));
  assert.strictEqual(verdict.pass, false);
  assert.strictEqual(verdict.findings[0].kind, 'js-bypass');
});
