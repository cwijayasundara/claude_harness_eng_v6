# Tracker Orchestrator Add-On Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional Linear/Jira tracker orchestration add-on to the Claude Harness scaffold and create a standalone Docker-capable Symphony-style orchestrator that launches Claude Code in isolated scaffolded workspaces.

**Architecture:** The scaffold remains the source of planning and execution truth. The orchestrator is an external scheduler that polls tracker issues, creates a workspace, launches `claude --print` with a harness group prompt, reads a result file, then updates the tracker.

**Tech Stack:** Claude Code scaffold markdown skills/templates, Node.js 20 CommonJS orchestrator, Docker, Linear GraphQL adapter, Jira adapter stub.

---

### Task 1: Scaffold Tracker Add-On

**Files:**
- Create: `.claude/skills/tracker/SKILL.md`
- Create: `.claude/skills/tracker-publish/SKILL.md`
- Create: `.claude/templates/tracker-config.template.json`
- Create: `.claude/templates/tracker-workflow.template.md`
- Modify: `.claude/commands/scaffold.md`
- Modify: `README.md`

- [ ] Add tracker skills that describe the optional publish/sync/orchestrate flow.
- [ ] Add config and workflow templates consumed by the standalone orchestrator.
- [ ] Update scaffold instructions so tracker support is optional and disabled by default.
- [ ] Update template validation count from 8 to 10.

### Task 2: Standalone Orchestrator

**Files:**
- Create staged files under `.tmp/symphony_clone_seed/`
- Copy staged tree to `/Users/chamindawijayasundara/Documents/rnd_2026/claude_scaffold_research/symphony_clone`

- [ ] Add Node.js package metadata and scripts.
- [ ] Add config loader with environment overrides.
- [ ] Add Linear adapter and Jira explicit-not-implemented adapter.
- [ ] Add workspace manager that clones the target repo and creates a branch.
- [ ] Add Claude runner that launches `claude --print` with prompt on stdin.
- [ ] Add scheduler/orchestrator loop with bounded concurrency and result handling.
- [ ] Add Dockerfile and docker-compose example.

### Task 3: Verification

**Files:**
- Test: `.tmp/symphony_clone_seed/test/*.test.js`

- [ ] Run Node unit tests for config, scheduler eligibility, prompt building, and result reading.
- [ ] Run `node --check` over orchestrator source files.
- [ ] Copy the staged orchestrator into `symphony_clone`.
