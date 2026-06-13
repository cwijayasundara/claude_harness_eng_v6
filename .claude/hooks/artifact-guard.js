#!/usr/bin/env node

'use strict';

// UserPromptSubmit — keeps the heavyweight SDLC pipeline out of workspaces that
// exist only to produce disposable artifacts (UI mockups, ARB/architecture
// narratives, research write-ups). In such a workspace, invoking /build, /auto,
// /implement, /change, or /refactor would spin up the generator/evaluator GAN
// loop, ratchet gates, and security review on work that is never going to ship.
// When the prompt is one of those commands AND the workspace is marked
// artifact-only, the hook blocks (exit 2) and points at the lightweight lanes.
//
// A workspace is "artifact-only" when a `.artifact-workspace` marker file sits
// at the project root, or the project path contains a mockups/ arb-docs/ or
// research/ segment. The marker is opt-in: unmarked workspaces are never
// affected, so builders switching hats in a normal repo see nothing.
//
// Escape hatch: HARNESS_ARTIFACT_GUARD=off. Never blocks in the harness repo
// itself (it dogfoods every command). A crash here must never brick a prompt.

const fs = require('fs');
const path = require('path');
const { resolveProjectDir, readHookInput, reportFailure } = require('./lib/common');
const { isHarnessRepo } = require('./lib/trust-boundary');

// SDLC commands that drive the generator/evaluator/security machinery. Planning
// and discovery lanes (/brd, /spec, /brownfield, /clarify) are artifact-safe and
// deliberately omitted; /design is omitted because --doc-only is itself a lane.
const SDLC_COMMAND = /^\s*\/(?:[\w.-]+:)?(build|auto|implement|change|refactor|scaffold)\b/i;

const MARKER = '.artifact-workspace';
const ARTIFACT_SEGMENTS = new Set(['mockups', 'arb-docs', 'research']);

function commandIn(prompt) {
  const m = (prompt || '').match(SDLC_COMMAND);
  return m ? m[1].toLowerCase() : null;
}

function isArtifactWorkspace(projectDir) {
  if (fs.existsSync(path.join(projectDir, MARKER))) return true;
  return projectDir.split(path.sep).some((seg) => ARTIFACT_SEGMENTS.has(seg));
}

function block(command) {
  const msg =
    `BLOCKED: \`/${command}\` runs the SDLC pipeline (generator/evaluator, ratchet gates, security review), ` +
    `but this is an artifact-only workspace.\n` +
    `UI mockups, ARB/architecture documents, and research are disposable artifacts — they do not go through the pipeline.\n` +
    `Use the lightweight lane instead:\n` +
    `  - UI mockup            -> frontend-design skill\n` +
    `  - Architecture/ARB doc -> /design --doc-only\n` +
    `  - Research/analysis    -> deep-research skill\n` +
    `If this workspace really is shipping product code, remove the ${MARKER} marker (or set HARNESS_ARTIFACT_GUARD=off).\n`;
  process.stderr.write(msg); // exit-2 feedback channel for Claude Code
  process.exit(2);
}

function main() {
  if ((process.env.HARNESS_ARTIFACT_GUARD || '').toLowerCase() === 'off') return;

  const input = readHookInput();
  const command = commandIn(input.prompt);
  if (!command) return;

  const projectDir = resolveProjectDir(__dirname);
  if (isHarnessRepo(projectDir)) return; // the harness dogfoods every command
  if (!isArtifactWorkspace(projectDir)) return;

  block(command);
}

try {
  main();
} catch (err) {
  reportFailure('artifact-guard', err);
  // Fail open: a broken guard must not block legitimate work.
}
