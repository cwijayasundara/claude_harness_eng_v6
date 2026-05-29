#!/usr/bin/env node

'use strict';

// UserPromptSubmit — code-intent lane router (advisory, never blocks).
// When a free-text prompt (not a slash command) looks like a code change, nudge
// the user to run /lane-classify so quality gates and commit metrics segment
// correctly. Debounced so it never nags more than once per window.

const fs = require('fs');
const path = require('path');

const DEBOUNCE_MS = 4 * 60 * 60 * 1000; // at most one nudge per 4 hours
const CHANGE_VERBS = /\b(add|implement|build|create|fix|refactor|rename|migrate|change|update|modify|remove|delete|introduce|rewrite|optimi[sz]e)\b/i;
const CODE_HINTS = /(\bfunction\b|\bclass\b|\bendpoint\b|\bapi\b|\broute\b|\bcomponent\b|\bmodule\b|\btest\b|\bbug\b|\bfeature\b|\bhook\b|\bschema\b|\bmigration\b|\.py\b|\.tsx?\b|\.jsx?\b)/i;

function findProjectDir(startDir) {
  let cur = startDir;
  while (true) {
    if (fs.existsSync(path.join(cur, '.claude'))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

function recentlyNudged(marker) {
  try {
    const last = parseInt(fs.readFileSync(marker, 'utf8').trim(), 10);
    return Number.isFinite(last) && Date.now() - last < DEBOUNCE_MS;
  } catch (_) {
    return false;
  }
}

try {
  const input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'));
  if ((input.hook_event_name || '') !== 'UserPromptSubmit') process.exit(0);

  const prompt = (input.prompt || '').toString();
  const trimmed = prompt.trimStart();
  if (!trimmed || trimmed.startsWith('/')) process.exit(0); // slash command sets the lane
  if (!CHANGE_VERBS.test(prompt) || !CODE_HINTS.test(prompt)) process.exit(0); // not a code change

  const scriptDir = path.dirname(path.resolve(__filename));
  const projectDir = findProjectDir(scriptDir) || process.cwd();
  const stateDir = path.join(projectDir, '.claude', 'state');
  const marker = path.join(stateDir, 'lane-router-last.txt');

  if (recentlyNudged(marker)) process.exit(0);

  try {
    if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(marker, String(Date.now()));
  } catch (_) {
    /* best effort */
  }

  process.stdout.write(
    `[lane-router] This looks like a code change outside a harness command. ` +
      `Consider /lane-classify first to pick the right lane (vibe / fix-issue / improve / refactor / build) ` +
      `so quality gates and commit metrics segment correctly. Tiny low-risk edits can use /vibe.\n`
  );
} catch (_) {
  // Silent exit — stderr output triggers "hook error" in Claude Code
}

process.exit(0);
