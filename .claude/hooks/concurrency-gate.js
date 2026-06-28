'use strict';

// PreToolUse(Task) + SubagentStop concurrency gate. Enforces a global ceiling on
// concurrent Task subagents: deny (exit 2) a spawn that would exceed the cap;
// decrement on SubagentStop. Fail-open on any error; TTL-pruning self-heals a
// leaked count (a subagent that never fired SubagentStop). Pure decideSpawn/
// decideStop are unit-tested.

const fs = require('fs');
const path = require('path');

const TTL_MS = 30 * 60 * 1000;
// DEFAULT_CAP = 18: the documented /auto peak is 3 group-orchestrators + 3×5 teammates = 18
// concurrent Task subagents. The gate counts orchestrators too (they are Task spawns), so 18
// accommodates the full peak without throttling. Configure down via
// project-manifest.json#execution.max_concurrent_agents or CLAUDE_MAX_CONCURRENT_AGENTS.
const DEFAULT_CAP = 18;

function normalizeState(raw) {
  if (raw && Array.isArray(raw.active)) {
    return { active: raw.active.filter((n) => Number.isFinite(n)) };
  }
  return { active: [] };
}

function resolveCap(manifest, env) {
  const m = manifest && manifest.execution && Number(manifest.execution.max_concurrent_agents);
  if (Number.isFinite(m) && m > 0) return m;
  const e = Number((env || {}).CLAUDE_MAX_CONCURRENT_AGENTS);
  if (Number.isFinite(e) && e > 0) return e;
  return DEFAULT_CAP;
}

function decideSpawn(state, { cap, now, ttlMs }) {
  const active = normalizeState(state).active.filter((ts) => ts > now - ttlMs);
  if (active.length >= cap) {
    return {
      allow: false,
      reason: `Concurrency cap reached (${active.length}/${cap} subagents in flight). Wait for in-flight subagents to finish, then retry the spawn.`,
      state: { active },
    };
  }
  return { allow: true, state: { active: [...active, now] } };
}

function decideStop(state, { now, ttlMs }) {
  const active = normalizeState(state).active.filter((ts) => ts > now - ttlMs).sort((a, b) => a - b);
  // Late-decrement edge: if a subagent outlived the TTL its timestamp was already pruned above,
  // so a late SubagentStop drops the oldest LIVE entry — deliberate best-effort loosening
  // (only ever over-allows, never blocks).
  active.shift();
  return { state: { active } };
}

// ---- hook wrapper ----

function statePath(projectDir) {
  return path.join(projectDir, '.claude', 'state', 'inflight-agents.json');
}

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; }
}

function writeState(p, state) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(state));
}

function main() {
  let input;
  try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch (_) { process.exit(0); }
  try {
    const event = (input.hook_event_name || '').toString();
    const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const sp = statePath(projectDir);
    const now = Date.now();

    if (event === 'PreToolUse' && (input.tool_name || '') === 'Task') {
      const cap = resolveCap(readJsonSafe(path.join(projectDir, 'project-manifest.json')), process.env);
      const r = decideSpawn(readJsonSafe(sp), { cap, now, ttlMs: TTL_MS });
      writeState(sp, r.state);
      if (!r.allow) { process.stderr.write(`${r.reason}\n`); process.exit(2); }
      process.exit(0);
    }
    if (event === 'SubagentStop') {
      const r = decideStop(readJsonSafe(sp), { now, ttlMs: TTL_MS });
      writeState(sp, r.state);
      process.exit(0);
    }
  } catch (_) { process.exit(0); }
  process.exit(0);
}

if (require.main === module) main();

module.exports = { decideSpawn, decideStop, resolveCap, normalizeState };
