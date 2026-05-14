#!/usr/bin/env bash
# Idempotent bootstrap for symphony_clone. Safe to re-run.
# Validates config, refreshes the GitHub token, rebuilds the image, and
# reports whether Claude inside the container is authenticated.
set -euo pipefail

cd "$(dirname "$0")/.."

red()    { printf "\033[31m%s\033[0m\n" "$*"; }
green()  { printf "\033[32m%s\033[0m\n" "$*"; }
yellow() { printf "\033[33m%s\033[0m\n" "$*"; }
bold()   { printf "\033[1m%s\033[0m\n" "$*"; }

bold "[1/5] Validate .env"
[ -f .env ] || { red "✗ .env not found (copy .env.example or fill in tracker/repo settings)"; exit 1; }

# Parse only the keys we need, ignoring shell-special values
required=(TRACKER_PROVIDER LINEAR_API_KEY LINEAR_PROJECT_SLUG TARGET_REPO_URL READY_STATE READY_LABEL)
missing=()
for v in "${required[@]}"; do
  value=$(grep -E "^${v}=" .env | head -1 | cut -d= -f2-)
  [ -n "$value" ] || missing+=("$v")
done
if [ ${#missing[@]} -gt 0 ]; then
  red "✗ .env missing required values: ${missing[*]}"
  exit 1
fi
green "✓ .env has required keys"

bold "[2/5] Ensure GITHUB_TOKEN is set"
github_token=$(grep -E '^GITHUB_TOKEN=' .env | head -1 | cut -d= -f2-)
if [ -z "$github_token" ]; then
  if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
    yellow "  GITHUB_TOKEN empty — pulling fresh token from gh keyring"
    new_token=$(gh auth token)
    if grep -qE '^GITHUB_TOKEN=' .env; then
      sed -i.bak "s|^GITHUB_TOKEN=.*|GITHUB_TOKEN=${new_token}|" .env && rm -f .env.bak
    else
      echo "GITHUB_TOKEN=${new_token}" >> .env
    fi
    green "✓ GITHUB_TOKEN written to .env from gh auth token"
  else
    yellow "⚠ GITHUB_TOKEN empty and gh CLI not authenticated."
    yellow "   PR push will fail. Run: gh auth login   (then re-run bootstrap)"
  fi
else
  green "✓ GITHUB_TOKEN already set in .env"
fi

bold "[3/5] Build image"
docker compose build >/dev/null
green "✓ Image built"

bold "[4/5] Start container (preserving volumes)"
docker compose up -d --force-recreate >/dev/null
# Wait for orchestrator_started
deadline=$((SECONDS + 30))
while [ $SECONDS -lt $deadline ]; do
  if docker compose logs --tail=20 symphony-clone 2>&1 | grep -q orchestrator_started; then
    green "✓ Orchestrator running"
    break
  fi
  sleep 1
done

bold "[5/5] Check Claude auth inside container"
auth_output=$(docker compose exec -T -u node symphony-clone bash -c \
  'timeout 8 claude --print "respond with the single word OK" --permission-mode bypassPermissions 2>&1' \
  | head -3) || true

if echo "$auth_output" | grep -q "Not logged in"; then
  yellow "✗ Claude is NOT authenticated inside the container."
  yellow ""
  yellow "  Run this in YOUR terminal (not via this script — it needs a TTY):"
  yellow ""
  bold   "    docker exec -u node -it symphony_clone-symphony-clone-1 claude /login"
  yellow ""
  yellow "  Pick option 1 (Claude account with subscription). Complete the OAuth flow"
  yellow "  in your browser, paste the auth code back into the terminal. Then re-run:"
  yellow ""
  bold   "    ./scripts/bootstrap.sh"
  yellow ""
  exit 2
fi

green "✓ Claude is authenticated"
echo
bold "Symphony is ready. The orchestrator polls Linear every $(grep -E '^POLL_INTERVAL_MS=' .env | cut -d= -f2- || echo 60000)ms."
bold "Move an eligible issue to '$(grep -E '^READY_STATE=' .env | cut -d= -f2-)' with label '$(grep -E '^READY_LABEL=' .env | cut -d= -f2-)' to trigger a run."
echo
echo "  Logs:        docker compose logs -f symphony-clone"
echo "  Linear ping: node scripts/diagnose-linear.js"
echo "  Stop:        docker compose down"
echo
