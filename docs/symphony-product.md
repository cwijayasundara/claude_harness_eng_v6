# Symphony — separate product boundary

`symphony_clone/` is **not** part of harness-core / harness-lite / harness-full.

## What it is

A headless orchestrator that:

- Polls Linear / Jira / Azure DevOps for ready work
- Claims dependency groups
- Runs Claude Code non-interactively in isolated workspaces
- Opens PRs and posts proof back to the tracker

It **consumes** the Claude Harness Engine (via `claude -p` + harness skills) but has its own:

- Docker image / compose stack
- Env and secrets model
- Release cadence
- Failure/retry semantics

## Install / run

See `symphony_clone/README.md`. Do **not** expect `npm run package:skus` to include Symphony.

## Why it stays separate

| Concern | Harness SKUs | Symphony |
|---|---|---|
| Audience | Developers in Claude Code | Ops / platform running a poller |
| Secrets | Project `.env` for the app under build | Tracker + GitHub tokens for the factory |
| Blast radius | One repo session | Many workspaces / parallel agents |
| Versioning | Plugin / tarball (`v2.1.x`) | Container image + compose |

## Future

If extracted to its own repository, keep a versioned dependency on published harness SKUs (`claude-harness-core` tarball or marketplace package) rather than a monorepo path.
