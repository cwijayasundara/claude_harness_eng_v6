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

# Layer 1: Framework validation (hooks, rubrics, agents, settings, dashboard)
echo "── Layer 1: Framework Validation (~2 min) ──"
node --test "$SCRIPT_DIR/harness-framework.test.js" --timeout 300000

echo ""

# Layer 2: Greenfield pipeline (brd → spec → design → auto build → telemetry)
echo "── Layer 2: Greenfield Pipeline (~8 min) ──"
node --test "$SCRIPT_DIR/harness-pipeline.test.js" --timeout 900000

echo ""

# Layer 3: Brownfield + code-graph + code change + telemetry + Grafana
echo "── Layer 3: Brownfield + Telemetry (~10 min) ──"
node --test "$SCRIPT_DIR/harness-brownfield.test.js" --timeout 1200000

echo ""
echo "Results saved to: $SCRIPT_DIR/results/"
echo "Generated app: $SCRIPT_DIR/output/"
