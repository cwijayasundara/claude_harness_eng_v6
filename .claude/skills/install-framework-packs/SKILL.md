---
name: install-framework-packs
description: Install or re-install agent-framework skill packs declared in project-manifest.json#framework_skill_packs. Use when /scaffold reported a pack install was blocked by the Claude Code auto-mode classifier, after manually adding a pack to the manifest, or to verify all configured packs are present. Idempotent — packs already in .claude/skills/ are skipped unless --force.
argument-hint: "[--list] [--force]"
context: fork
---

# Install Framework Skill Packs

`/scaffold` records the user's chosen framework packs in `project-manifest.json` under `framework_skill_packs`, then attempts to install them. The Claude Code auto-mode classifier blocks external GitHub installs as a safety gate (independent of `settings.json` allowlist), so the install often fails and the scaffold reports a manual follow-up.

This skill is the one-command path to finish those installs. It is idempotent and safe to run repeatedly.

---

## Pack registry

| Manifest key | Repository | Prefix | Expected skills |
|---|---|---|---:|
| `langchain` | `cwijayasundara/agent_cli_langchain` | `langchain-agents-` | 9 |
| `google-adk` | `google/agents-cli` | `google-agents-cli-` | 7 |

If `framework_skill_packs` contains a key not in this registry, report it as unknown and skip — do not invent install commands.

---

## Steps

### Step 1 — Parse arguments

- `--list` — report current state only; do not run any installs.
- `--force` — re-run install even when the prefix directory is already present.

### Step 2 — Read project-manifest.json

Locate the manifest at the project root. Extract the `framework_skill_packs` array.

- Missing field or empty array → print `No framework packs configured in project-manifest.json — nothing to install.` and stop.
- Field present with one or more entries → proceed.

### Step 3 — Build the per-pack status table

For each entry, check whether the prefix matches any directory under `.claude/skills/`:

```bash
COUNT=$(find .claude/skills -maxdepth 1 -type d -name '<prefix>*' | wc -l | tr -d ' ')
```

State for each pack:

- `COUNT >= expected` → `INSTALLED`
- `COUNT > 0 && COUNT < expected` → `PARTIAL` (install was interrupted; treat like missing)
- `COUNT == 0` → `MISSING`

If `--list` was passed, print the table and stop here.

### Step 4 — Install missing packs

For each pack in `MISSING` or `PARTIAL` state (or all packs if `--force`), run:

```bash
npx --yes skills add <repo> -a claude-code -s '*' -y
```

Capture the full stdout+stderr. Three outcomes:

| Outcome | Detection | Action |
|---|---|---|
| Success | exit 0 AND prefix directory now contains expected skill count | Mark as `INSTALLED ✓`; continue |
| Classifier denial | output contains `Denied by auto mode classifier` | Mark as `BLOCKED`; print manual-fallback block (Step 6); continue to next pack |
| Other failure | non-zero exit without classifier-denial message | Mark as `FAILED`; print error excerpt + remediation hint; continue to next pack |

Do NOT stop on the first failure — process all packs so the user sees the complete state.

### Step 5 — Print summary

Print a compact table:

```
Pack         Repo                                          Status        Skills
langchain    cwijayasundara/agent_cli_langchain            INSTALLED ✓   9 / 9
google-adk   google/agents-cli                             BLOCKED       0 / 7  (manual install required)
```

### Step 6 — Manual-fallback block (when any pack is BLOCKED or FAILED)

For each pack that did not install, print this verbatim — substituting `<repo>`, `<prefix>`, and project-root path:

```
═══════════════════════════════════════════════════════════════════════════════
  [!] Pack install blocked: <repo>
═══════════════════════════════════════════════════════════════════════════════

  Open a normal terminal (NOT Claude Code) and run:

    cd <project-root>
    npx --yes skills add <repo> -a claude-code -s '*' -y

  Verify:

    ls .claude/skills/ | grep '^<prefix>'

  Then come back to Claude Code and run `/install-framework-packs` again
  to confirm the install — this skill is idempotent.

═══════════════════════════════════════════════════════════════════════════════
```

If multiple packs are blocked, print one box per pack. The boxes must be the LAST output before the skill exits — they should not be buried under other text.

### Step 7 — Update project state (optional)

Write a small status file at `.claude/state/framework-packs-install.json` recording the last-run timestamp and per-pack state so subsequent runs and Step 10 scaffold reports can read it:

```json
{
  "last_run": "2026-05-13T16:30:00Z",
  "packs": {
    "langchain": { "status": "INSTALLED", "skills": 9, "repo": "cwijayasundara/agent_cli_langchain" },
    "google-adk": { "status": "BLOCKED", "skills": 0, "repo": "google/agents-cli" }
  }
}
```

This is informational only — the skill does not depend on it for correctness; the prefix-directory check is the source of truth.

---

## When NOT to use this skill

- The framework pack is published as a Claude Code marketplace plugin (use `enabledPlugins` in `settings.json` instead).
- You want to install a one-off, unregistered pack from a different repository (run `npx skills add <repo> -a claude-code -s '*' -y` directly instead).
- You're auditing what's installed — `--list` is fine; otherwise use `ls .claude/skills/` directly.

## Safety notes

- The `skills` CLI runs Snyk/Socket/Gen security risk assessments and prints them before installing. Two LangChain pack skills (`deepagents-code`, `deploy`) carry a "Med Risk" Snyk flag — surface this when reporting the install result.
- The classifier denial is doing real work: it stops the in-Claude-Code session from quietly running external code. Always route the manual install through the user's own terminal so they see the Snyk warnings and stay in the loop.
