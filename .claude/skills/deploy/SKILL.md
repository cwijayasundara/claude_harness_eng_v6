---
name: deploy
description: Generate Docker Compose stack, Dockerfiles, environment config, and init.sh bootstrap script.
argument-hint: "[--up]"
context: fork
agent: planner
---

# Deploy Skill — Docker Compose Stack and Bootstrap

## Usage

```
/deploy
/deploy --up
```

- `/deploy` — generate all deployment files without starting services.
- `/deploy --up` — generate files and immediately run `bash init.sh` to start the stack.

---

## Prerequisites

The following must exist before running this skill:

- `backend/` and/or `frontend/` — source code with known runtimes and entry points.
- `specs/design/deployment.md` — deployment architecture decisions (DB engine, port assignments, service names).
- `project-manifest.json` — for service names, port config, and environment variable inventory.

If any of these are missing, stop and report what is absent.

---

## Steps

### Step 1 — Read Project Manifest

Read `project-manifest.json`. Extract:
- Service names and their roles (backend API, frontend SPA, worker, etc.)
- Port assignments for each service.
- Database engine and version.
- Any declared environment variable names.

### Step 2 — Read Deployment Architecture

Read `specs/design/deployment.md`. Extract:
- Service dependencies and startup order.
- Health check endpoints for each service.
- Volume requirements (DB data, uploads, etc.).
- Any explicit constraints (network mode, resource limits).

### Step 3 — Generate `docker-compose.yml`

Generate `docker-compose.yml` at the project root from the deployment template.

Requirements:
- Every service that another service depends on must use `depends_on` with a `condition: service_healthy` entry.
- Define named volumes for all persistent data (DB data directory, upload storage).
- No hardcoded passwords — all secrets come from environment variables.
- Each service must have a `healthcheck` block with a realistic `test`, `interval`, `timeout`, and `retries`.
- Use specific image tags (e.g., `postgres:16-alpine`), never `latest`.

### Step 4 — Generate Dockerfiles

**`backend/Dockerfile`**
- Multi-stage build: `builder` stage installs dependencies, `runtime` stage copies only the built artefact.
- Run as non-root user.
- `EXPOSE` the port declared in the manifest.
- `HEALTHCHECK` instruction matching the health check endpoint.

**`frontend/Dockerfile`** (if frontend exists)
- Build stage: install deps, run build.
- Serve stage: NGINX or equivalent static server.
- `EXPOSE` the frontend port.

### Step 5 — Generate `.env.example`

Generate `.env.example` at the project root.

Every environment variable referenced in `docker-compose.yml` or either Dockerfile must have an entry. Each entry must include a comment explaining what it is and what format it expects:

```
# Database connection string
DATABASE_URL=postgresql://user:pass@db:5432/appdb

# JWT signing secret — generate with: openssl rand -hex 32
JWT_SECRET=change-me-in-production
```

No variable may appear in compose or Dockerfiles without a corresponding `.env.example` entry.

### Step 6 — Generate `init.sh`

Generate `init.sh` at the project root from the init template.

The script must:
1. Check that Docker and Docker Compose are available.
2. Copy `.env.example` to `.env` if `.env` does not already exist.
3. Run `docker compose build`.
4. Run `docker compose up -d`.
5. Poll each service health check URL until it responds or a timeout is reached (30s per service).
6. Print a summary: which services are up, which URLs are accessible.

Make `init.sh` executable (`chmod +x init.sh`).

### Step 7 — If `--up` Flag

Run:

```
bash init.sh
```

Report the output. If any service fails its health check, print the service logs and stop.

---

## Verification

After file generation (regardless of `--up`):

```
docker compose config
```

This validates the compose file syntax and interpolated values. Fix any errors before reporting completion.

---

## Output

| Path | Purpose |
|------|---------|
| `docker-compose.yml` | Full service stack definition |
| `backend/Dockerfile` | Backend container build |
| `frontend/Dockerfile` | Frontend container build (if applicable) |
| `.env.example` | All required environment variables documented |
| `init.sh` | Bootstrap script: build, start, health check |

---

## Gotchas

- **Missing `depends_on` with health conditions.** Services that start before their dependencies are ready cause intermittent failures. Always use `condition: service_healthy`.
- **No bind mount volumes.** Named volumes persist across `docker compose down`. Bind mounts to host paths break in CI and on other machines.
- **Hardcoded passwords.** Never put credentials directly in `docker-compose.yml`. All secrets go in `.env`.
- **Missing `.env.example` entries.** New variables added to compose but not documented leave other developers with silent failures.
- **`latest` image tags.** Tags like `postgres:latest` break reproducibility. Pin to a specific version.
- **Root user in containers.** Run application processes as a non-root user to limit blast radius on compromise.
