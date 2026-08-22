#!/usr/bin/env node

'use strict';

// PreToolUse gate: an agent may only write inside its own contract.
//
// The agent prompts already declare ownership in prose ("report-only", "never
// implements", "does not rewrite frozen sprint contracts") while the `tools:`
// grant hands several of them Write and Edit. Prose is not a control. This gate
// is the enforcement half of `.claude/agents/<name>.contract.json`; the static
// half (contract vs frontmatter drift) is validate-agent-contracts.js.
//
// IDENTITY. The acting agent comes from `agent_type` on the payload, captured
// verbatim from live runs (test/subagent-payload-shape.test.js). `agent_id`
// distinguishes a subagent call from a main-loop call. The main loop is never
// scoped: the human is driving, and a gate that blocks the operator is a bug.
//
// FAILS OPEN, deliberately. An unknown agent, an unreadable contract, a path
// outside the project, malformed input — all pass. Over-blocking stalls the
// build loop (a dispatch gate that refused every teammate is a defect this
// harness has already shipped once); over-allowing only costs a review finding.
// Escape for a whole session: HARNESS_AGENT_SCOPE=off.

const fs = require('fs');
const path = require('path');
const { loadContracts, writeDecision } = require('./lib/agent-contract');

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/** The file a write-shaped tool call targets, or null. */
function targetPath(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return null;
  const p = toolInput.file_path || toolInput.notebook_path || toolInput.path;
  return typeof p === 'string' && p !== '' ? p : null;
}

/**
 * The project-relative path of a write, or null when it is not the gate's
 * business (outside the project — scratch dirs, /tmp, another checkout).
 */
function projectRelative(projectDir, filePath) {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(projectDir, filePath);
  const rel = path.relative(projectDir, abs).split(path.sep).join('/');
  return rel === '' || rel.startsWith('..') ? null : rel;
}

function decide(input, projectDir) {
  if ((input.hook_event_name || '') !== 'PreToolUse') return null;
  if (!WRITE_TOOLS.has(input.tool_name || '')) return null;
  if (!input.agent_id) return null; // the main loop is never scoped

  const agent = input.agent_type;
  if (typeof agent !== 'string' || agent === '') return null;

  const contract = loadContracts(path.join(projectDir, '.claude', 'agents')).get(agent);
  if (!contract) return null; // an agent this project does not govern

  const filePath = targetPath(input.tool_input);
  if (!filePath) return null;

  const rel = projectRelative(projectDir, filePath);
  if (rel === null) return null;

  const decision = writeDecision(contract, rel);
  return decision.allow ? null : decision.reason;
}

function main() {
  if ((process.env.HARNESS_AGENT_SCOPE || '').toLowerCase() === 'off') process.exit(0);

  let input;
  try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch (_) { process.exit(0); }

  let reason = null;
  try { reason = decide(input, process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd()); } catch (_) { process.exit(0); }

  if (reason) {
    process.stderr.write(`BLOCKED: ${reason}\n`);
    process.exit(2);
  }
  process.exit(0);
}

if (require.main === module) main();

module.exports = { decide, projectRelative, targetPath };
