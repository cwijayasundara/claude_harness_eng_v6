'use strict';

// Agent write-scope contracts (SwarmForge pickup #1).
//
// Every reviewer agent in this harness carries a prose "Does Not Own" section
// and a `tools:` grant that contradicts it: code-reviewer.md says report-only
// and is handed Write + Bash, so nothing but good intentions stops it editing
// the code it is judging. SwarmForge's `squad` branch pairs each role prompt
// with a machine-readable contract (artifact-roots, forbidden-roots, may-spawn)
// and a test that the prompt agrees with it. This is that, in our shapes.
//
// Two halves, both tested here:
//   * STATIC  — the contract set agrees with the agent frontmatter (drift).
//   * RUNTIME — a Write/Edit decision for a given agent_type + path.
//
// The runtime half decides from `agent_type`, which is carried verbatim on a
// real PreToolUse payload (captured 2026-08-22, see subagent-payload-shape.test.js).
// Deciding from anything else is how the last two hooks shipped inert.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const {
  loadContracts,
  validateContracts,
  writeDecision,
} = require('../.claude/hooks/lib/agent-contract.js');

const REPO = path.join(__dirname, '..');

function tempAgents(agents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-contract-'));
  for (const [name, spec] of Object.entries(agents)) {
    const tools = (spec.tools || []).map((t) => `  - ${t}`).join('\n');
    fs.writeFileSync(path.join(dir, `${name}.md`),
      `---\nname: ${name}\ndescription: t\ntools:\n${tools}\n---\n\nbody\n`);
    if (spec.contract) {
      fs.writeFileSync(path.join(dir, `${name}.contract.json`), JSON.stringify(spec.contract, null, 2));
    }
  }
  return dir;
}

// ---- static half: contract <-> frontmatter drift ----

test('every agent shipped in this repo has a contract, and it is well-formed', () => {
  const errors = validateContracts(path.join(REPO, '.claude', 'agents'));
  assert.deepEqual(errors, [], `agent contracts drifted:\n${errors.join('\n')}`);
});

test('an agent with no contract file is a violation, not a silent pass', () => {
  const dir = tempAgents({ orphan: { tools: ['Read'] } });
  const errors = validateContracts(dir);
  assert.ok(errors.some((e) => /orphan/.test(e) && /contract/.test(e)),
    `expected a missing-contract finding, got: ${JSON.stringify(errors)}`);
});

test('a contract claiming may_spawn:false while the grant carries Agent is drift', () => {
  const dir = tempAgents({
    talker: {
      tools: ['Read', 'Write', 'Agent'],
      contract: { agent: 'talker', may_spawn: false, artifact_roots: ['specs/reviews/'] },
    },
  });
  const errors = validateContracts(dir);
  assert.ok(errors.some((e) => /talker/.test(e) && /may_spawn/.test(e)),
    `expected a may_spawn drift finding, got: ${JSON.stringify(errors)}`);
});

test('a read-only contract while the grant carries Write is drift', () => {
  const dir = tempAgents({
    looker: {
      tools: ['Read', 'Write'],
      contract: { agent: 'looker', may_spawn: false, artifact_roots: [] },
    },
  });
  const errors = validateContracts(dir);
  assert.ok(errors.some((e) => /looker/.test(e) && /Write/.test(e)),
    `expected a read-only-vs-Write finding, got: ${JSON.stringify(errors)}`);
});

test('an allow-list overlapping the deny-list is drift — the decision would be ambiguous', () => {
  const dir = tempAgents({
    muddle: {
      tools: ['Read', 'Write'],
      contract: {
        agent: 'muddle',
        may_spawn: false,
        artifact_roots: ['specs/'],
        forbidden_artifact_roots: ['specs/'],
      },
    },
  });
  const errors = validateContracts(dir);
  assert.ok(errors.some((e) => /muddle/.test(e) && /overlap/i.test(e)),
    `expected an overlap finding, got: ${JSON.stringify(errors)}`);
});

test('a root that is not a repo-relative directory prefix is drift', () => {
  const dir = tempAgents({
    sloppy: {
      tools: ['Read', 'Write'],
      contract: { agent: 'sloppy', may_spawn: false, artifact_roots: ['/abs/path/', 'specs/reviews'] },
    },
  });
  const errors = validateContracts(dir);
  assert.ok(errors.some((e) => /sloppy/.test(e) && /absolute/i.test(e)), 'absolute root must be rejected');
  assert.ok(errors.some((e) => /sloppy/.test(e) && /trailing/i.test(e)), 'a root must end in /');
});

// ---- runtime half: the write decision ----

const REVIEWER = { agent: 'code-reviewer', may_spawn: false, artifact_roots: ['specs/reviews/'] };
const BUILDER = {
  agent: 'implementer',
  may_spawn: false,
  forbidden_artifact_roots: ['sprint-contracts/'],
};

test('an allow-list contract permits its own root and refuses everything else', () => {
  assert.equal(writeDecision(REVIEWER, 'specs/reviews/code-review.md').allow, true);
  const denied = writeDecision(REVIEWER, 'backend/app/auth.py');
  assert.equal(denied.allow, false);
  assert.match(denied.reason, /code-reviewer/);
  assert.match(denied.reason, /specs\/reviews\//, 'the message must name where it MAY write, not just that it failed');
});

test('the reviewer cannot edit the code it is judging — the case the prose never enforced', () => {
  for (const p of ['src/index.ts', 'test/auth.test.js', '.claude/hooks/pre-write-gate.js']) {
    assert.equal(writeDecision(REVIEWER, p).allow, false, `${p} must be refused`);
  }
});

test('a builder with no allow-list may write source but not the frozen contract', () => {
  assert.equal(writeDecision(BUILDER, 'backend/app/auth.py').allow, true);
  assert.equal(writeDecision(BUILDER, 'sprint-contracts/A.json').allow, false);
});

test('an unknown agent is not scoped — over-blocking stalls the build loop', () => {
  assert.equal(writeDecision(null, 'backend/app/auth.py').allow, true);
  assert.equal(writeDecision(undefined, 'anything').allow, true);
});

test('a root prefix must match a path SEGMENT, not a substring', () => {
  // "specs/reviews/" must not authorize "specs/reviews-draft/x.md".
  assert.equal(writeDecision(REVIEWER, 'specs/reviews-draft/x.md').allow, false);
  // and the deny-list must not catch a sibling directory either
  assert.equal(writeDecision(BUILDER, 'sprint-contracts-old/A.json').allow, true);
});

test('a traversal path cannot escape the allow-list', () => {
  assert.equal(writeDecision(REVIEWER, 'specs/reviews/../../backend/app.py').allow, false);
});

// ---- the shipped contracts encode the ownership the prompts claim ----

test('the shipped reviewer contracts are allow-listed to the review surface', () => {
  const contracts = loadContracts(path.join(REPO, '.claude', 'agents'));
  for (const name of ['code-reviewer', 'security-reviewer', 'modularity-reviewer']) {
    const c = contracts.get(name);
    assert.ok(c, `${name} must ship a contract`);
    assert.ok((c.artifact_roots || []).includes('specs/reviews/'),
      `${name} must be allow-listed to specs/reviews/`);
    assert.equal(writeDecision(c, 'backend/app/auth.py').allow, false,
      `${name} must not be able to write production code`);
  }
});

test('the read-only agents cannot write anywhere in the repo', () => {
  const contracts = loadContracts(path.join(REPO, '.claude', 'agents'));
  for (const name of ['advisor', 'codebase-explorer']) {
    const c = contracts.get(name);
    assert.ok(c, `${name} must ship a contract`);
    assert.equal(writeDecision(c, 'specs/reviews/x.md').allow, false);
    assert.equal(writeDecision(c, 'src/x.ts').allow, false);
  }
});

test('the generator and implementer cannot rewrite a frozen sprint contract', () => {
  const contracts = loadContracts(path.join(REPO, '.claude', 'agents'));
  for (const name of ['generator', 'implementer']) {
    const c = contracts.get(name);
    assert.ok(c, `${name} must ship a contract`);
    assert.equal(writeDecision(c, 'sprint-contracts/A.json').allow, false,
      `${name}.md says it does not rewrite frozen contracts — that must be enforced, not asserted`);
    assert.equal(writeDecision(c, 'backend/app/auth.py').allow, true,
      'a builder must still be able to build');
  }
});

// ── C1: the contracts must permit the writes the pipeline mandates ──────────
//
// The first version of these contracts encoded the post-freeze rule as
// unconditional, and five writes the skills explicitly instruct were refused:
// generator/evaluator/implementer -> sprint-contracts/, planner/evaluator ->
// features.json. Wiring the hook would have stalled /auto on the generator's
// first Write — the "dispatch gate that refused every teammate" pattern, again.
//
// generator.md:32 states the real rule, and it is CONDITIONAL: "When
// specs/reviews/contract-freeze.json exists, treat sprint-contracts/*.json as
// read-only". contract-freeze.js --check only DETECTS drift after the fact, so
// the preventive half is worth keeping — it just has to carry the condition.

const REAL = loadContracts(path.join(__dirname, '..', '.claude', 'agents'));
const frozen = { exists: (p) => p === 'specs/reviews/contract-freeze.json' };
const unfrozen = { exists: () => false };

test('the sprint-contract authors may write it BEFORE the freeze', () => {
  // .claude/skills/auto/references/section-3-3-...-steps-2-3.md:21 and :27
  for (const agent of ['generator', 'evaluator', 'implementer']) {
    const d = writeDecision(REAL.get(agent), 'sprint-contracts/group-A.json', unfrozen);
    assert.equal(d.allow, true,
      `${agent} is instructed to write the sprint contract during negotiation: ${d.reason || ''}`);
  }
});

test('and may NOT once the freeze receipt exists', () => {
  for (const agent of ['generator', 'evaluator', 'implementer']) {
    const d = writeDecision(REAL.get(agent), 'sprint-contracts/group-A.json', frozen);
    assert.equal(d.allow, false, `${agent} must not edit a FROZEN sprint contract`);
    assert.match(d.reason, /frozen|freeze/i, 'the refusal must say why it is closed now and was not before');
  }
});

test('planner and evaluator may write the root features.json', () => {
  // planner.md:108 "Produce root features.json"; evaluate/SKILL.md:297 and
  // gate/SKILL.md:55 both have the evaluator update it after every run.
  for (const agent of ['planner', 'evaluator']) {
    const d = writeDecision(REAL.get(agent), 'features.json', unfrozen);
    assert.equal(d.allow, true, `${agent} is instructed to write features.json: ${d.reason || ''}`);
  }
});

test('features.json is an exact allowance, not a prefix that opens the root', () => {
  const d = writeDecision(REAL.get('planner'), 'features.json.bak', unfrozen);
  assert.equal(d.allow, false, 'an exact-file allowance must not match by prefix');
  assert.equal(writeDecision(REAL.get('planner'), 'backend/app/auth.py', unfrozen).allow, false,
    'the planner still writes no source');
});

test('the reviewer surfaces are unchanged by the C1 fix', () => {
  assert.equal(writeDecision(REAL.get('evaluator'), 'specs/reviews/audit-A.json', frozen).allow, true);
  assert.equal(writeDecision(REAL.get('generator'), 'specs/reviews/audit-A.json', unfrozen).allow, false);
  assert.equal(writeDecision(REAL.get('code-reviewer'), 'backend/app/auth.py', unfrozen).allow, false);
  assert.equal(writeDecision(REAL.get('generator'), 'backend/app/auth.py', unfrozen).allow, true);
});

test('a missing exists probe defaults to FROZEN — absent evidence must not open a deny', () => {
  const d = writeDecision(REAL.get('generator'), 'sprint-contracts/group-A.json');
  assert.equal(d.allow, false,
    'with no way to check the receipt the safe answer is closed, not open');
});
