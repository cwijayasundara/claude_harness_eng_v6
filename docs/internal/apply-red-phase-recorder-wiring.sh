#!/usr/bin/env bash
# Wire the G41 red-phase recorder into .claude/settings.json.
#
# WHY THIS IS A SCRIPT AND NOT A NORMAL EDIT
# .claude/settings.json sits in the cached prompt prefix, so the pre-write-gate
# prefix-cache check refuses to touch it mid-session — an edit there invalidates
# the cache for every later turn of a running build. CLAUDE.md designates this
# INTER-SESSION work. Run this between sessions, not during a long /auto run.
#
# UNTIL THIS RUNS, G41/G42/G43 ARE INERT: nothing writes the red-phase ledger, so
# the session lock never arms and the commit/CI gate has no evidence to check.
#
# Usage:  bash docs/internal/apply-red-phase-recorder-wiring.sh
set -euo pipefail

cd "$(dirname "$0")/../.."
SETTINGS=".claude/settings.json"

if [ ! -f "$SETTINGS" ]; then
  echo "error: $SETTINGS not found — run from the repo root" >&2
  exit 1
fi

cp "$SETTINGS" "$SETTINGS.bak"
echo "backup: $SETTINGS.bak"

HARNESS_PREFIX_EDIT=1 node -e '
const fs = require("fs");
const file = ".claude/settings.json";
const s = JSON.parse(fs.readFileSync(file, "utf8"));
const entry = {
  type: "command",
  command: "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/red-phase-record.js\"",
  timeout: 5000,
};

s.hooks = s.hooks || {};
s.hooks.PostToolUse = s.hooks.PostToolUse || [];

// Deliberately a Bash-ONLY group. The existing "Write|Edit|MultiEdit|Bash" group
// also fires on every file write, and the recorder has nothing to do there — it
// would just spawn a node process per edit on the hot path.
const already = s.hooks.PostToolUse
  .flatMap((g) => g.hooks || [])
  .some((h) => String(h.command || "").includes("red-phase-record"));
const group = s.hooks.PostToolUse.find((g) => g.matcher === "Bash");
if (already) {
  console.log("already wired — nothing to do");
  process.exit(0);
} else if (!group) {
  s.hooks.PostToolUse.push({ matcher: "Bash", hooks: [entry] });
  console.log("added a new PostToolUse Bash-only group");
} else if (group.hooks.some((h) => String(h.command || "").includes("red-phase-record"))) {
  console.log("already wired — nothing to do");
  process.exit(0);
} else {
  group.hooks.push(entry);
  console.log(`appended to existing PostToolUse group (matcher: ${group.matcher})`);
}
fs.writeFileSync(file, `${JSON.stringify(s, null, 2)}\n`);
'

echo
echo "Verifying the settings file is still valid JSON and the hook resolves..."
node -e '
const s = require("./.claude/settings.json");
const found = (s.hooks.PostToolUse || []).flatMap((g) => g.hooks || [])
  .some((h) => String(h.command || "").includes("red-phase-record"));
if (!found) { console.error("FAILED: recorder not present after edit"); process.exit(1); }
require("fs").accessSync(".claude/hooks/red-phase-record.js");
console.log("OK: recorder wired and the hook file exists");
'

cat <<'NEXT'

NEXT STEPS
  1. Restart the Claude Code session so the new hook is loaded.
  2. Run a real red->green cycle and confirm the ledger fills:
       cat .claude/state/red-phase.jsonl
  3. Once the ledger is filling, turn the CI gate strict — edit
     .github/workflows/ci.yml and change:
         run: npm run test-integrity
     to:
         run: npm run test-integrity -- --strict
     Until then the CI step warns loudly and reports vacuous:true rather
     than claiming a pass it has not earned.
NEXT
