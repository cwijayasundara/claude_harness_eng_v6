#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { readHookInputAsync, reportFailure, optionalRequire } = require('./lib/common');
// telemetry + planning packs. Recording must never break a session: absent = skip.
const telemetry = optionalRequire(path.join(__dirname, '..', 'scripts', 'telemetry-memory.js'));
const buildLane = optionalRequire(path.join(__dirname, '..', 'scripts', 'build-lane.js'));
const phaseCostPersist = optionalRequire(path.join(__dirname, 'lib', 'phase-cost-persist.js'));
const { inferSkills } = require('./lib/record-skills');
const { resolveAgentModel, extractUsageFields } = require('./lib/agent-model');
const { contextFields } = require('./lib/run-context');

// The real subagent-dispatch tool's tool_name is "Agent" in this environment (confirmed
// by direct hook-payload capture); "Task" is the name this harness originally shipped
// against and is kept for forward/backward compatibility across Claude Code versions.
const SUBAGENT_TOOL_NAMES = new Set(['Task', 'Agent']);

function resolveUser() {
  if (process.env.HARNESS_USER) return process.env.HARNESS_USER;
  try {
    // Strip quote glyphs from misconfigured user.name (e.g. set with smart
    // quotes) so they don't pollute the dashboard's $user label values.
    const name = execFileSync('git', ['config', 'user.name'], { encoding: 'utf8', timeout: 2000 })
      .replace(/["'“”‘’]/g, '').trim();
    if (name) return name;
  } catch (_) {}
  return os.userInfo().username || 'unknown';
}

function findProjectDir(startDir) {
  let cur = startDir;
  while (true) {
    if (fs.existsSync(path.join(cur, '.claude'))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

function readMarker(stateDir, name) {
  try {
    return fs.readFileSync(path.join(stateDir, name), 'utf8').trim() || null;
  } catch (_) {
    return null;
  }
}

function writeMarker(stateDir, name, value) {
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, name), `${value}\n`);
  } catch (_) {}
}

function harnessSha(projectDir) {
  try {
    const head = fs.readFileSync(path.join(projectDir, '.claude', 'HARNESS_SHA'), 'utf8').trim();
    if (head) return head;
  } catch (_) {}
  return process.env.CLAUDE_HARNESS_SHA || null;
}

function append(receiptPath, obj) {
  fs.appendFileSync(receiptPath, JSON.stringify(obj) + '\n');
}

function persistPhaseCost(projectDir, input, eventName) {
  if (!phaseCostPersist || typeof phaseCostPersist.writeSnapshot !== 'function') return;
  try {
    phaseCostPersist.writeSnapshot(projectDir, {
      transcriptPath: input && input.transcript_path ? input.transcript_path : null,
      sessionId: input && input.session_id ? input.session_id : null,
      event: eventName || (input && input.hook_event_name) || 'snapshot',
    });
  } catch (_) { /* never block a session on a usage log */ }
}

async function persistAndPush(receiptPath, stateDir, projectDir, record) {
  if (telemetry) telemetry.seedLedgerFromRuns(projectDir, stateDir);
  append(receiptPath, record);
  if (telemetry) telemetry.appendLedger(stateDir, record);
  if (telemetry) await telemetry.pushSnapshot({ projectDir, stateDir });
}

function stableLabelValue(value, fallback) {
  return value === null || value === undefined || value === '' ? fallback : value;
}

function inferCommand(prompt) {
  const text = String(prompt || '').trim();
  const match = text.match(/^\/([A-Za-z0-9_-]+)/);
  return match ? match[1].toLowerCase() : null;
}

// An autonomy declaration, not a substring: `--auto-merge` must never read as
// `--auto`. Promoting a gated run to headless by accident is the one direction
// this can be wrong in that matters.
const AUTONOMY_FLAG = /(?:^|\s)--(auto|autonomous)(?=\s|$)/;

/**
 * The AUTONOMY lane an invocation declares, or null if it declares none.
 *
 * This used to return the command name for anything that was not /build, so
 * `/spec` wrote "spec" into .claude/state/current-lane. Two controls read that
 * marker as a lane and were wrong because of it: the decisions gate
 * corroborates a claimed `--lane --auto` against it and rejected every
 * phase-by-phase run with "a gated run cannot waive itself", and
 * gate-receipt-sensor's appliesTo() never matched a command name, so on those
 * runs it was inert — the same class of bug its own header records.
 *
 * A command name is not a lane. Returning null leaves the marker alone, so the
 * lane a session declared at its start survives the phases that follow it,
 * which is what makes it a session property rather than a per-turn one. The
 * command is recorded separately, to `current-command`.
 */
function inferLane(prompt, command) {
  if (command === 'build') {
    // Without the planning pack there is no /build lane to resolve. Unknown is
    // the honest answer; "build" would just be the command name again.
    const parsed = buildLane ? buildLane.parseBuildInvocation(prompt) : null;
    return parsed && parsed.valid !== false ? parsed.lane : null;
  }
  // /auto IS the zero-gate build loop — the command is itself the declaration.
  if (command === 'auto') return 'auto';
  const declared = AUTONOMY_FLAG.exec(String(prompt || ''));
  return declared ? declared[1] : null;
}

function shouldSkipCommandTelemetry(command) {
  return command === 'scaffold';
}

(async () => {
  try {
    const input = await readHookInputAsync();
    const eventKind = (input.hook_event_name || '').toString();
    const toolName = input.tool_name || '';

    const scriptDir = path.dirname(path.resolve(__filename));
    const projectDir = findProjectDir(scriptDir) || process.cwd();
    const stateDir = path.join(projectDir, '.claude', 'state');
    const runsDir = path.join(projectDir, '.claude', 'runs');
    if (!fs.existsSync(runsDir)) fs.mkdirSync(runsDir, { recursive: true });

    const date = new Date().toISOString().slice(0, 10);
    const receiptPath = path.join(runsDir, `${date}.jsonl`);

    const user = resolveUser();
    const lane = readMarker(stateDir, 'current-lane');
    const mode = readMarker(stateDir, 'current-mode');
    const iteration = readMarker(stateDir, 'current-iteration');
    const groupId = readMarker(stateDir, 'current-group');
    const storyId = readMarker(stateDir, 'current-story');
    const skillInventory = (telemetry ? telemetry.readSkillCatalog(projectDir) : null) || [];
    const lifecycle = { schema_version: 1, ...contextFields(stateDir, input.session_id || null) };

    if (eventKind === 'UserPromptSubmit') {
      const command = inferCommand(input.prompt);
      if (shouldSkipCommandTelemetry(command)) process.exit(0);
      const inferredLane = inferLane(input.prompt, command);
      if (inferredLane) writeMarker(stateDir, 'current-lane', inferredLane);
      if (command) writeMarker(stateDir, 'current-command', command);
      const skills = inferSkills({ input, command, lane: inferredLane || lane, catalog: skillInventory });
      const promptRecord = {
        ...lifecycle,
        kind: 'prompt',
        ts: Date.now(),
        user,
        session_id: input.session_id || null,
        harness_sha: harnessSha(projectDir),
        lane: stableLabelValue(inferredLane || lane, 'unknown'),
        mode: stableLabelValue(mode, 'unknown'),
        iteration: stableLabelValue(iteration, '0'),
        group_id: stableLabelValue(groupId, 'none'),
        story_id: stableLabelValue(storyId, 'none'),
        agent: 'human',
        command: stableLabelValue(command, 'freeform'),
        skill_names: skills.map((skill) => skill.name),
        skills,
        skill_count: skillInventory.length,
        host: os.hostname(),
      };
      await persistAndPush(receiptPath, stateDir, projectDir, promptRecord);
      persistPhaseCost(projectDir, input, 'UserPromptSubmit');
      process.exit(0);
    }

    if (eventKind === 'PostToolUse' && SUBAGENT_TOOL_NAMES.has(toolName)) {
      const ti = input.tool_input || {};
      const tr = input.tool_response || {};
      const skills = inferSkills({ input, command: null, lane, catalog: skillInventory });
      // ti.subagent_type is the confirmed-real field (it's the Agent tool's own parameter
      // name, unchanged across the Task->Agent rename); ti.agent_type is a defensive
      // fallback only, not a confirmed field on this event.
      const agent = stableLabelValue(ti.subagent_type || ti.agent_type, 'unknown');
      const usage = extractUsageFields(input);
      const model = usage.model || resolveAgentModel(projectDir, agent) || null;
      const subagentRecord = {
        ...lifecycle,
        kind: 'subagent',
        ts: Date.now(),
        user,
        session_id: input.session_id || null,
        harness_sha: harnessSha(projectDir),
        lane: stableLabelValue(lane, 'unknown'),
        mode: stableLabelValue(mode, 'unknown'),
        iteration: stableLabelValue(iteration, '0'),
        group_id: stableLabelValue(groupId, 'none'),
        story_id: stableLabelValue(storyId, 'none'),
        agent,
        model,
        skill_names: skills.map((skill) => skill.name),
        skills,
        skill_count: skillInventory.length,
        host: os.hostname(),
        exit: tr.is_error ? 'error' : 'ok',
      };
      if (usage.input_tokens != null) subagentRecord.input_tokens = usage.input_tokens;
      if (usage.output_tokens != null) subagentRecord.output_tokens = usage.output_tokens;
      if (usage.cache_read_tokens != null) subagentRecord.cache_read_tokens = usage.cache_read_tokens;
      if (usage.cache_creation_tokens != null) subagentRecord.cache_creation_tokens = usage.cache_creation_tokens;
      await persistAndPush(receiptPath, stateDir, projectDir, subagentRecord);

      const reviewsDir = path.join(projectDir, 'specs', 'reviews');
      try {
        if (fs.existsSync(reviewsDir)) {
          const evalFiles = fs.readdirSync(reviewsDir)
            .filter(f => f.startsWith('phase-') && f.endsWith('-eval.json'));
          for (const evalFile of evalFiles) {
            const evalPath = path.join(reviewsDir, evalFile);
            const evalData = JSON.parse(fs.readFileSync(evalPath, 'utf8'));
            const lastHistory = (evalData.score_history || []).slice(-1)[0];
            if (!lastHistory) continue;
            const evalRecord = {
              ...lifecycle,
              kind: 'phase_eval',
              ts: Date.now(),
              user,
              session_id: input.session_id || null,
              phase: evalData.phase,
              iteration: String(evalData.iteration),
              scores: evalData.scores,
              weighted_average: evalData.weighted_average,
              verdict: evalData.verdict || 'unknown',
              lane: stableLabelValue(lane, 'unknown'),
              mode: stableLabelValue(mode, 'unknown'),
              group_id: stableLabelValue(groupId, 'none'),
              story_id: stableLabelValue(storyId, 'none'),
              host: os.hostname(),
            };
            await persistAndPush(receiptPath, stateDir, projectDir, evalRecord);
          }
        }
      } catch (_) {}

      process.exit(0);
    }

    if (eventKind === 'PostToolUse') {
      // Per-edit/Bash hot path: append-only, push deferred to prompt/Task/Stop.
      const tr = input.tool_response || {};
      const skills = inferSkills({ input, command: null, lane, catalog: skillInventory });
      const toolRecord = {
        ...lifecycle,
        kind: 'tool',
        ts: Date.now(),
        user,
        session_id: input.session_id || null,
        harness_sha: harnessSha(projectDir),
        lane: stableLabelValue(lane, 'unknown'),
        mode: stableLabelValue(mode, 'unknown'),
        iteration: stableLabelValue(iteration, '0'),
        group_id: stableLabelValue(groupId, 'none'),
        story_id: stableLabelValue(storyId, 'none'),
        tool: stableLabelValue(toolName, 'unknown'),
        exit: tr.is_error ? 'error' : 'ok',
        skill_names: skills.map((skill) => skill.name),
        skills,
        skill_count: skillInventory.length,
        host: os.hostname(),
      };
      if (telemetry) telemetry.seedLedgerFromRuns(projectDir, stateDir);
      append(receiptPath, toolRecord);
      if (telemetry) telemetry.appendLedger(stateDir, toolRecord);
      process.exit(0);
    }

    if (eventKind === 'Stop' || eventKind === 'SubagentStop') {
      const skills = inferSkills({ input, command: null, lane, catalog: skillInventory });
      // agent_type is the real SubagentStop field; the rest are kept for
      // forward/backward compatibility (confirmed by direct hook-payload capture).
      const agent = stableLabelValue(
        input.agent_type || input.subagent_type || input.subagent
          || (input.tool_input && input.tool_input.subagent_type),
        'unknown',
      );
      const usage = extractUsageFields(input);
      const model = usage.model || resolveAgentModel(projectDir, agent) || null;
      const turnRecord = {
        ...lifecycle,
        kind: eventKind === 'Stop' ? 'turn' : 'subagent_stop',
        ts: Date.now(),
        user,
        session_id: input.session_id || null,
        harness_sha: harnessSha(projectDir),
        lane: stableLabelValue(lane, 'unknown'),
        mode: stableLabelValue(mode, 'unknown'),
        iteration: stableLabelValue(iteration, '0'),
        group_id: stableLabelValue(groupId, 'none'),
        story_id: stableLabelValue(storyId, 'none'),
        agent,
        model,
        exit: input.is_error ? 'error' : 'ok',
        skill_names: skills.map((skill) => skill.name),
        skills,
        skill_count: skillInventory.length,
        host: os.hostname(),
      };
      if (usage.input_tokens != null) turnRecord.input_tokens = usage.input_tokens;
      if (usage.output_tokens != null) turnRecord.output_tokens = usage.output_tokens;
      if (usage.cache_read_tokens != null) turnRecord.cache_read_tokens = usage.cache_read_tokens;
      if (usage.cache_creation_tokens != null) turnRecord.cache_creation_tokens = usage.cache_creation_tokens;
      await persistAndPush(receiptPath, stateDir, projectDir, turnRecord);
      persistPhaseCost(projectDir, input, eventKind);
      process.exit(0);
    }
  } catch (err) {
    // A hook crash must never block work. Write to hook-errors.log so a broken
    // hook is discoverable instead of silently disabled (same pattern as
    // verify-on-save.js and pre-write-gate.js).
    reportFailure('record-run', err);
  }

  process.exit(0);
})();
