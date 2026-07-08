#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { appendLedger, pushSnapshot, readSkillCatalog, seedLedgerFromRuns } = require('../scripts/telemetry-memory');
const { parseBuildInvocation } = require('../scripts/build-lane');
const { readHookInput, reportFailure } = require('./lib/common');
const { inferSkills } = require('./lib/record-skills');

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

async function persistAndPush(receiptPath, stateDir, projectDir, record) {
  seedLedgerFromRuns(projectDir, stateDir);
  append(receiptPath, record);
  appendLedger(stateDir, record);
  await pushSnapshot({ projectDir, stateDir });
}

function stableLabelValue(value, fallback) {
  return value === null || value === undefined || value === '' ? fallback : value;
}

function inferCommand(prompt) {
  const text = String(prompt || '').trim();
  const match = text.match(/^\/([A-Za-z0-9_-]+)/);
  return match ? match[1].toLowerCase() : null;
}

function inferLane(prompt, command) {
  if (command !== 'build') return command || null;
  const parsed = parseBuildInvocation(prompt);
  return parsed.valid === false ? command : parsed.lane;
}

function shouldSkipCommandTelemetry(command) {
  return command === 'scaffold';
}

(async () => {
  try {
    const input = readHookInput();
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
    const skillInventory = readSkillCatalog(projectDir);

    if (eventKind === 'UserPromptSubmit') {
      const command = inferCommand(input.prompt);
      if (shouldSkipCommandTelemetry(command)) process.exit(0);
      const inferredLane = inferLane(input.prompt, command);
      if (inferredLane) writeMarker(stateDir, 'current-lane', inferredLane);
      const skills = inferSkills({ input, command, lane: inferredLane || lane, catalog: skillInventory });
      const promptRecord = {
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
        skill_inventory: skillInventory,
        host: os.hostname(),
      };
      await persistAndPush(receiptPath, stateDir, projectDir, promptRecord);
      process.exit(0);
    }

    if (eventKind === 'PostToolUse' && toolName === 'Task') {
      const ti = input.tool_input || {};
      const tr = input.tool_response || {};
      const skills = inferSkills({ input, command: null, lane, catalog: skillInventory });
      const subagentRecord = {
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
        agent: stableLabelValue(ti.subagent_type, 'unknown'),
        skill_names: skills.map((skill) => skill.name),
        skills,
        skill_inventory: skillInventory,
        host: os.hostname(),
        exit: tr.is_error ? 'error' : 'ok',
      };
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
        skill_inventory: skillInventory,
        host: os.hostname(),
      };
      seedLedgerFromRuns(projectDir, stateDir);
      append(receiptPath, toolRecord);
      appendLedger(stateDir, toolRecord);
      process.exit(0);
    }

    if (eventKind === 'Stop' || eventKind === 'SubagentStop') {
      const skills = inferSkills({ input, command: null, lane, catalog: skillInventory });
      const turnRecord = {
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
        agent: stableLabelValue(input.subagent_type || input.subagent || (input.tool_input && input.tool_input.subagent_type), 'unknown'),
        exit: input.is_error ? 'error' : 'ok',
        skill_names: skills.map((skill) => skill.name),
        skills,
        skill_inventory: skillInventory,
        host: os.hostname(),
      };
      await persistAndPush(receiptPath, stateDir, projectDir, turnRecord);
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
