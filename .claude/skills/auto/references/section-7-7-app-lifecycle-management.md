## SECTION 7: App Lifecycle Management

`/auto` is responsible for starting and stopping the application. The evaluator does NOT manage the app lifecycle.

Read `verification.mode` from `project-manifest.json`. Default: `docker`.

### Mode: docker (default)

**Startup:**
1. Run `bash init.sh` before first evaluator check
2. Run health-check retry loop (see evaluator agent for protocol)
3. If health check fails: FAIL the current group, log to failures.md

**Between Groups:**
```bash
docker compose up -d --build
```
Wait for health check before handing off to evaluator.

**Teardown:**
```bash
docker compose down -v
```

**Error Context:** `docker compose logs --tail=50 {service_name}`

### Mode: local

**Startup:**
1. Read `verification.local.start_commands` from manifest
2. Start each command as a background process, capture stdout/stderr to `.claude/state/process-{name}.log`
3. Run health-check retry loop against configured URLs

**Between Groups:** Kill and restart processes (re-run start commands).

**Teardown:** Kill all background processes started by the orchestrator.

**Error Context:** Read from `.claude/state/process-{name}.log`

### Mode: stub

**Startup:**
1. Read `verification.stub.schema_source` from manifest
2. Generator creates a lightweight mock server (FastAPI or Express) that serves schema-valid example responses for every endpoint in the schema
3. Start the mock server on a free port
4. Run health-check retry loop

**Between Groups:** Regenerate mock server if schema has been amended (check `specs/design/amendments/`).

**Teardown:** Kill mock server process.

**Error Context:** Stub mismatch reports — when a request doesn't match any endpoint in the schema, log the requested path and method.

**Stub mode limitations:** Layer 1 checks validate request/response shapes but cannot verify business logic. Layer 2 (Playwright) skipped unless a separate frontend URL is configured.

### Worktree Isolation (All Modes)

When using `--worktree` flag, each worktree gets its own app instance:
- Docker mode: different port mappings (configured via `project-manifest.json`)
- Local mode: different port arguments in start commands
- Stub mode: different mock server port (auto-selected)

---
