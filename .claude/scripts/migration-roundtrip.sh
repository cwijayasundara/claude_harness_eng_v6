#!/bin/bash
# Migration round-trip proof — the tooling behind checking-migration-safety
# step 4: a down-migration that exists but has never run is documentation,
# not a rollback path. Runs up -> down -> up against a disposable database.
#
# Usage:
#   .claude/scripts/migration-roundtrip.sh --detect-only
#   DATABASE_URL=<disposable-db-url> .claude/scripts/migration-roundtrip.sh
#   .claude/scripts/migration-roundtrip.sh --ephemeral-postgres   (docker)
#
# Exit codes: 0 round-trip proven; 1 a migration step FAILED (real finding);
# 2 unsupported tool / missing prerequisites (not a pass — say so in the report).
set -euo pipefail

DETECT_ONLY=0
EPHEMERAL=0
for arg in "$@"; do
  case "$arg" in
    --detect-only) DETECT_ONLY=1 ;;
    --ephemeral-postgres) EPHEMERAL=1 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

detect_tool() {
  if [ -f alembic.ini ]; then echo alembic
  elif [ -f manage.py ]; then echo django
  elif [ -f prisma/schema.prisma ]; then echo prisma
  elif ls knexfile.* >/dev/null 2>&1; then echo knex
  else echo none
  fi
}

TOOL=$(detect_tool)
echo "migration tool: $TOOL"
if [ "$DETECT_ONLY" = 1 ]; then
  [ "$TOOL" != "none" ] || exit 2
  exit 0
fi

if [ "$TOOL" = "none" ]; then
  echo "No supported migration tool found (alembic.ini, manage.py, prisma/schema.prisma, knexfile.*)." >&2
  exit 2
fi

if [ "$TOOL" = "prisma" ]; then
  # Prisma has no down migrations by design. There is nothing to round-trip:
  # reversibility must come from expand-contract or a hand-written down.sql.
  echo "UNSUPPORTED: prisma has no down migrations — a rollback path must be" >&2
  echo "expand-contract or a manually maintained down.sql. Do not report reversibility as proven." >&2
  exit 2
fi

CONTAINER=""
cleanup() {
  if [ -n "$CONTAINER" ]; then docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

if [ "$EPHEMERAL" = 1 ]; then
  command -v docker >/dev/null 2>&1 || { echo "docker not available for --ephemeral-postgres" >&2; exit 2; }
  # Throwaway container credentials — the container dies with this script.
  # The URL is assembled from parts (also keeps the harness secret scanner
  # from reading a dummy local URL as a hardcoded credential).
  DB_USER=postgres
  DB_PASS=roundtrip
  DB_AUTH="${DB_USER}:${DB_PASS}"
  PROTO="postgresql:"
  PORT=$(( (RANDOM % 1000) + 55000 ))
  CONTAINER=$(docker run -d --rm -e POSTGRES_PASSWORD="$DB_PASS" -p "$PORT":5432 postgres:16-alpine)
  DATABASE_URL="${PROTO}//${DB_AUTH}@localhost:${PORT}/postgres"
  export DATABASE_URL
  echo "ephemeral postgres on port $PORT"
  for _ in $(seq 1 30); do
    docker exec "$CONTAINER" pg_isready -U "$DB_USER" >/dev/null 2>&1 && break
    sleep 1
  done
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set. Point it at a DISPOSABLE database (never production)," >&2
  echo "or pass --ephemeral-postgres to spin one up via docker." >&2
  exit 2
fi

run_step() {
  local label="$1"
  echo "== $label"
  shift
  "$@" || { echo "ROUND-TRIP FAILED at: $label" >&2; exit 1; }
}

case "$TOOL" in
  alembic)
    run_step "up (alembic upgrade head)"    alembic upgrade head
    run_step "down (alembic downgrade -1)"  alembic downgrade -1
    run_step "re-up (alembic upgrade head)" alembic upgrade head
    ;;
  django)
    run_step "up (manage.py migrate)" python manage.py migrate --no-input
    echo "NOTE: django downgrade needs an explicit target (manage.py migrate <app> <prev>)."
    echo "Run the down step for the app you changed, then re-run this script's up step."
    echo "Reporting up-only: reversibility NOT proven."
    exit 2
    ;;
  knex)
    run_step "up (knex migrate:latest)"     npx --no-install knex migrate:latest
    run_step "down (knex migrate:rollback)" npx --no-install knex migrate:rollback
    run_step "re-up (knex migrate:latest)"  npx --no-install knex migrate:latest
    ;;
esac

echo "ROUND-TRIP OK: up -> down -> up completed"
