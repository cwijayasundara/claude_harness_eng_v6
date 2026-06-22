#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "=== Harness E2E Pipeline Test ==="
echo "Root: $ROOT_DIR"
echo ""

# Check prerequisites
if ! command -v claude &> /dev/null; then
  echo "ERROR: claude CLI not found. Install Claude Code first."
  exit 1
fi

# Start telemetry stack if not running
if curl -s http://localhost:9090/-/healthy > /dev/null 2>&1; then
  echo "Prometheus: running"
else
  echo "Prometheus: starting..."
  docker compose -f "$ROOT_DIR/telemetry_docker_compose.yml" up -d 2>/dev/null || true
  echo "Waiting for services..."
  for i in $(seq 1 30); do
    curl -s http://localhost:9090/-/healthy > /dev/null 2>&1 && break
    sleep 2
  done
fi

if curl -s http://localhost:3001/api/health > /dev/null 2>&1; then
  echo "Grafana: running"
else
  echo "Grafana: waiting..."
  for i in $(seq 1 15); do
    curl -s http://localhost:3001/api/health > /dev/null 2>&1 && break
    sleep 2
  done
fi

echo ""
echo "Running E2E tests..."
echo ""

# Layers run independently: a failure is recorded but does not abort the
# remaining layers (Layer 2+ does not depend on Layer 1's temp scaffold).
FAILED_LAYERS=""

# Wall-clock watchdog: run a test layer with a hard cap (seconds). node:test can
# keep the process alive after every test passes — open HTTP sockets to the
# telemetry stack and the spawned `claude` tree leave referenced handles — which
# looks like a multi-hour hang. --test-force-exit handles the common teardown
# case; this watchdog is the backstop: if a layer exceeds its cap it is killed,
# turning an unbounded hang into a bounded, visible FAILURE (rc 137).
run_layer() {
  local cap="$1"; shift
  "$@" &
  local pid=$!
  ( sleep "$cap"; kill -9 "$pid" 2>/dev/null ) &
  local watcher=$!
  local rc=0
  wait "$pid" 2>/dev/null || rc=$?
  kill "$watcher" 2>/dev/null || true
  wait "$watcher" 2>/dev/null || true
  [ "$rc" -eq 137 ] && echo "  ⏱  layer killed after exceeding ${cap}s watchdog cap"
  return "$rc"
}

# Layer 1: Framework validation (hooks, rubrics, agents, settings, dashboard)
echo "── Layer 1: Framework Validation (~8 min) ──"
run_layer 720 node --test --test-force-exit --test-timeout=600000 "$SCRIPT_DIR/harness-framework.test.js" || FAILED_LAYERS="$FAILED_LAYERS framework"

echo ""

# Layer 2: Greenfield pipeline (scaffold → brd → spec → design → phase eval)
echo "── Layer 2: Greenfield Pipeline (~15 min) ──"
run_layer 1620 node --test --test-force-exit --test-timeout=1500000 "$SCRIPT_DIR/harness-pipeline.test.js" || FAILED_LAYERS="$FAILED_LAYERS pipeline"

echo ""

# Layer 2a: Real workflow certification (actual /brd → /spec → /design)
echo "── Layer 2a: Real Workflow Certification (~20 min) ──"
run_layer 1920 node --test --test-force-exit --test-timeout=1800000 "$SCRIPT_DIR/harness-real-workflow.test.js" || FAILED_LAYERS="$FAILED_LAYERS real-workflow"

echo ""

# Layer 2b: Adversarial fixture verification (greenfield prompts + brownfield repos)
echo "── Layer 2b: Adversarial Fixture Verification (~1 min) ──"
run_layer 240 node --test --test-force-exit --test-timeout=120000 "$SCRIPT_DIR/harness-adversarial-fixtures.test.js" || FAILED_LAYERS="$FAILED_LAYERS adversarial-fixtures"

echo ""

# Layer 2c: Live adversarial mutation (Claude edits brownfield fixtures)
echo "── Layer 2c: Live Adversarial Mutation (~20 min) ──"
run_layer 1320 node --test --test-force-exit --test-timeout=1200000 "$SCRIPT_DIR/harness-adversarial-live.test.js" || FAILED_LAYERS="$FAILED_LAYERS adversarial-live"

echo ""

# Layer 2d: Auto build + telemetry/Grafana verification (stages 4-6)
echo "── Layer 2d: Auto Build + Observability (~5 min) ──"
run_layer 1020 node --test --test-force-exit --test-timeout=900000 "$SCRIPT_DIR/harness-pipeline-build.test.js" || FAILED_LAYERS="$FAILED_LAYERS pipeline-build"

echo ""

# Layer 3: Brownfield + code-graph + code change + telemetry + Grafana
echo "── Layer 3: Brownfield + Telemetry (~10 min) ──"
run_layer 1320 node --test --test-force-exit --test-timeout=1200000 "$SCRIPT_DIR/harness-brownfield.test.js" || FAILED_LAYERS="$FAILED_LAYERS brownfield"

echo ""

# Layer 3a: Native command integration (/refactor→/simplify, /gate rename)
echo "── Layer 3a: Native Command Integration (~10 min) ──"
run_layer 1320 node --test --test-force-exit --test-timeout=1200000 "$SCRIPT_DIR/harness-native-commands.test.js" || FAILED_LAYERS="$FAILED_LAYERS native-commands"

echo ""
echo "Results saved to: $SCRIPT_DIR/results/"
echo "Generated app: $SCRIPT_DIR/output/"

if [ -n "$FAILED_LAYERS" ]; then
  echo "FAILED LAYERS:$FAILED_LAYERS"
  exit 1
fi
echo "ALL LAYERS PASSED"
