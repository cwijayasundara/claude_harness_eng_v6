'use strict';

// The id of the conversation currently running.
//
// Hook payloads carry `session_id`; a plain script invoked from Bash does not
// get one. The run receipts the hooks already append are the bridge: every row
// carries the session that produced it, so the newest row names the live
// session. This is what lets a phase tell "I am starting fresh" from "I am
// starting inside the conversation that just approved my predecessor".

const fs = require('fs');
const path = require('path');

/** The most recent line in `lines` that names a session, or null. */
function lastSessionIn(lines) {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const row = JSON.parse(lines[i]);
      if (row && row.session_id) return row.session_id;
    } catch (_) { /* partial or truncated line */ }
  }
  return null;
}

/**
 * @param {string} root project root
 * @returns {string|null} live session id, or null when it cannot be determined
 *
 * Null is a legitimate answer — no receipts yet, a project without the hooks
 * installed, an unreadable directory. Callers must treat it as "unknown" and
 * never as "different session": a control that fires on missing evidence blocks
 * the wrong thing.
 */
function liveSessionId(root) {
  const dir = path.join(root, '.claude', 'runs');
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort();
  } catch (_) {
    return null;
  }
  for (let i = files.length - 1; i >= 0; i -= 1) {
    let lines;
    try {
      lines = fs.readFileSync(path.join(dir, files[i]), 'utf8').split('\n').filter(Boolean);
    } catch (_) {
      continue;
    }
    const found = lastSessionIn(lines);
    if (found) return found;
  }
  return null;
}

module.exports = { liveSessionId, lastSessionIn };
