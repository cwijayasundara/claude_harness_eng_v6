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
