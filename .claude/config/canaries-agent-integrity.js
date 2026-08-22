'use strict';

// Canaries for the agent-integrity control family — the gates that constrain
// what an AGENT may do, rather than what the code may look like.
//
// Split out of sensor-canaries.js when that registry reached the 300-line file
// cap: a canary registry is one responsibility, but three families of them are
// three, and growing one list forever is how a file becomes unreadable. The
// aggregator in sensor-canaries.js spreads this list in; nothing else changes.

const fs = require('fs');
const os = require('os');
const path = require('path');

const LIB = path.join(__dirname, '..', 'hooks', 'lib');

const AGENT_CANARIES = [
  {
    probe: 'agent-write-scope',
    sensors: ['agent-write-scope'],
    why: 'a reviewer writing production code must be refused; writing its own review surface must not be',
    run() {
      const A = require(path.join(LIB, 'agent-contract'));
      const reviewer = {
        agent: 'code-reviewer', may_spawn: false, artifact_roots: ['specs/reviews/'], why: 'canary',
      };
      return {
        bit: A.writeDecision(reviewer, 'backend/app/auth.py').allow === false,
        quiet: A.writeDecision(reviewer, 'specs/reviews/code-review.md').allow === true,
      };
    },
  },
  {
    probe: 'agent-contract-drift',
    sensors: ['agent-contract-drift'],
    why: 'a read-only contract beside a Write grant must be flagged; an honest pair must not',
    run() {
      const A = require(path.join(LIB, 'agent-contract'));
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canary-contract-'));
      const write = (name, tools, contract) => {
        fs.writeFileSync(path.join(dir, `${name}.md`),
          `---\nname: ${name}\ndescription: t\ntools:\n${tools.map((t) => `  - ${t}`).join('\n')}\n---\n`);
        fs.writeFileSync(path.join(dir, `${name}.contract.json`), JSON.stringify(contract));
      };
      try {
        write('liar', ['Read', 'Write'], { agent: 'liar', may_spawn: false, artifact_roots: [], why: 'x' });
        const bit = A.validateContracts(dir).length > 0;
        fs.rmSync(path.join(dir, 'liar.md'));
        fs.rmSync(path.join(dir, 'liar.contract.json'));
        write('honest', ['Read'], { agent: 'honest', may_spawn: false, artifact_roots: [], why: 'x' });
        return { bit, quiet: A.validateContracts(dir).length === 0 };
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    probe: 'dead-path',
    sensors: ['dead-path'],
    why: 'a definition that lost its last caller must be flagged; one that went with its caller must not',
    run() {
      const D = require(path.join(LIB, 'dead-path'));
      const orphan = {
        symbol: 'formatLegacyRow', definedIn: 'src/helpers.js', refsBefore: 2, refsAfter: 0,
      };
      return {
        bit: D.classifyOrphans([orphan]).length === 1,
        quiet: D.classifyOrphans([{ ...orphan, definedIn: null }]).length === 0,
      };
    },
  },
];

module.exports = { AGENT_CANARIES };
