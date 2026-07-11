'use strict';

// Prompt-cache prefix protection.
// Claude Code caches the request prefix (system + tools + CLAUDE.md + MCP
// tool surface). Editing these files mid-session busts the cache for every
// later turn. CLAUDE.md documents this; this module enforces it on Write/Edit
// and Bash write targets (including in the harness repo, where the machinery
// trust-boundary deliberately allows hook/settings edits).
// Escape hatch: HARNESS_PREFIX_EDIT=1 (or "off" / "allow") for intentional
// inter-session maintenance — never during a long /auto run.

const path = require('path');

const PREFIX_RES = [
  /^CLAUDE\.md$/i,
  /^\.mcp\.json$/,
  /^\.claude\/settings(\.auto|\.local)?\.json$/,
];

function prefixEditAllowed() {
  const v = (process.env.HARNESS_PREFIX_EDIT || '').toLowerCase();
  return v === '1' || v === 'off' || v === 'allow' || v === 'true';
}

// Returns the project-relative path when filePath is a prompt-cache prefix
// file, null otherwise. Paths outside the project are the scope check's job.
function prefixCacheViolation(projectDir, filePath) {
  if (prefixEditAllowed()) return null;
  const rel = path.relative(projectDir, filePath).split(path.sep).join('/');
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return PREFIX_RES.some((re) => re.test(rel)) ? rel : null;
}

function prefixCacheBlockMessage(rel) {
  return (
    `BLOCKED: ${rel} is a prompt-cache prefix file — editing it mid-session ` +
    `invalidates the cached prefix (CLAUDE.md + tools + MCP surface) for every later turn.\n` +
    `Fix: apply this change between sessions (new Claude Code process), or set ` +
    `HARNESS_PREFIX_EDIT=1 for intentional inter-session maintenance. ` +
    `Do not enable that flag during a long /auto run.\n`
  );
}

module.exports = {
  prefixCacheViolation,
  prefixCacheBlockMessage,
  prefixEditAllowed,
};
