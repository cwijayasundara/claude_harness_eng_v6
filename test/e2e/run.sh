#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Backward-compatible entry point. The real orchestration lives in run-pack.js:
# it runs every node --test layer with --test-force-exit, a wall-clock watchdog,
# per-layer logs, and a final JSON summary.
exec node "$SCRIPT_DIR/run-pack.js" cert "$@"
