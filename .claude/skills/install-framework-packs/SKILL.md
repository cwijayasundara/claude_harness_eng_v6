---
name: install-framework-packs
description: "[Internal pipeline stage — run by /scaffold; invoke directly only as a power user.] Verify agent-framework skill packs declared in project-manifest.json#framework_skill_packs and print normal-terminal install commands for missing packs. Use after /scaffold reports PENDING MANUAL INSTALL, after manually adding a pack to the manifest, or to verify all configured packs are present."
argument-hint: "[--list]"
context: fork
---

# Install Framework Skill Packs

`/scaffold` records the user's chosen framework packs in `project-manifest.json` under `framework_skill_packs`, then prints normal-terminal install commands. The Claude Code auto-mode classifier blocks external GitHub installs as a safety gate (independent of `settings.json` allowlist), so this skill does not attempt to run `npx skills add` from inside Claude Code.

This skill is the one-command path to verify those installs. It is idempotent and safe to run repeatedly.

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

- `--list` — report current state. This is the default behavior.

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

### Step 4 — Report missing packs

Do not run `npx skills add` from this skill. For each pack in `MISSING` or `PARTIAL` state, mark it as `PENDING MANUAL INSTALL` and include it in the manual-install block in Step 6.

If all selected packs are already `INSTALLED`, print the summary and stop without a manual-install block.

### Step 5 — Print summary

Print a compact table:

```
Pack         Repo                                          Status        Skills
langchain    cwijayasundara/agent_cli_langchain            INSTALLED ✓   9 / 9
google-adk   google/agents-cli                             PENDING       0 / 7  (manual install required)
```

### Step 6 — Manual-install block (when any pack is missing)

For each missing or partial pack, print this verbatim — substituting `<repo>`, `<prefix>`, and project-root path:

```
═══════════════════════════════════════════════════════════════════════════════
  [!] Pack pending manual install: <repo>
═══════════════════════════════════════════════════════════════════════════════

  Open a normal terminal (NOT Claude Code) and run:

    cd <project-root>
    npx --yes skills add <repo> -a claude-code -s '*' -y

  Verify:

    ls .claude/skills/ | grep '^<prefix>'

  Then come back to Claude Code and run `/install-framework-packs` again
  to confirm the install.

═══════════════════════════════════════════════════════════════════════════════
```

If multiple packs are missing, print one box per pack. The boxes must be the LAST output before the skill exits — they should not be buried under other text.

### Step 7 — Update project state (optional)

Write a small status file at `.claude/state/framework-packs-install.json` recording the last-run timestamp and per-pack state so subsequent runs and Step 10 scaffold reports can read it:

```json
{
  "last_run": "2026-05-13T16:30:00Z",
  "packs": {
    "langchain": { "status": "INSTALLED", "skills": 9, "repo": "cwijayasundara/agent_cli_langchain" },
    "google-adk": { "status": "PENDING MANUAL INSTALL", "skills": 0, "repo": "google/agents-cli" }
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
