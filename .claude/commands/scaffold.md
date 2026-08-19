---
name: scaffold
description: Initialize a new project with the Claude Harness Engine v5 scaffold.
---

# /scaffold — Project Initialization

SSDD Norms gate: infer + confirm a profile, then `scaffold-apply.js` writes the
tree. Do not generate files by hand. Doctrine:
`../skills/plan-review-loop/references/ssdd.md` (load only if you need the map).

When the user runs this command, follow these steps exactly:

## Invocation modes

`/scaffold` takes optional arguments: `/scaffold [--yes | -y | --non-interactive] [--core | --brownfield | --full] [--telemetry] [--drift-workflow] [<description>]`.

- **Interactive (default — no `--yes`):** the full Infer + Confirm flow below. The normal human path.
- **Non-interactive (`--yes` / `-y` / `--non-interactive`):** for unattended / CI / e2e use where no human is present to answer (e.g. `claude -p`). Never call `AskUserQuestion` in this mode. `--yes` with no `<description>` is an error: print one line asking for a description and stop — do not invent a project. Otherwise do exactly this and nothing else:
  1. Take `<description>` as the Q1 answer and run the **Step 1.B** inference to build the profile. Inference is the *only* judgement you make here — do **not** hand-write project files.
  2. `Write` the inferred profile as JSON to `./.scaffold-profile.json` using the schema documented at the top of `.claude/scripts/scaffold-apply.js` (`name`, `description`, `stack.backend`/`frontend`/`database`, `projectType` A–D, `verificationMode` A–C, `modelTier`, `scaffoldProfile` core/brownfield/full, `telemetry`, `tracker` A–D, `frameworkPacks`, `lsp`).
  3. Run the deterministic generator — it performs every copy / mkdir / template-write of Steps 2–9, so nothing can be skipped or hallucinated:
     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/scripts/scaffold-apply.js" --profile ./.scaffold-profile.json [--scaffold-profile core|brownfield|full] [--telemetry] [--drift-workflow]
     ```
     If it exits non-zero, print its stderr and **STOP — do not fabricate success.** If `${CLAUDE_PLUGIN_ROOT}` is unset, ask for the harness `.claude` path and pass it as `--plugin-source`.
  4. Delete `./.scaffold-profile.json`, then print the Step 10 report describing what the script's stdout says it actually created. **Never print a success summary for files the script did not write.**

  In this mode `references/scaffold-generation.md` is the contract for *what the script writes* — you do not execute those steps by hand.

## Step 1: Gather Project Info — Infer + Confirm

> **MANDATORY (interactive mode): Q1 + confirmation card always shown.** Even if the session has a "don't pause for clarifications" / "make the reasonable call and continue" directive, you MUST ask the free-text Q1 below AND show the confirmation card. The user invoked `/scaffold` to configure a project — that is an explicit request for input gathering, not an ambiguous instruction to clarify. **The sole exception is non-interactive mode (`--yes`), where the description arrives as an argument and the inferred profile is accepted without prompts (see Invocation modes above).**
>
> Silently defaulting locks in choices the user can't easily reverse (tracker mode, framework packs, design calibration) — which is why defaulting is allowed *only* when the caller explicitly opts in with `--yes`.

### Step 1.A — Ask the description (Q1, free text)

Ask exactly this question with a normal prompt (no `AskUserQuestion`):

> "What are you building? In 1–3 sentences, include: language/framework, project shape (web app / script / library / brownfield existing code), the primary user surface (CLI / web UI / API / nothing yet), and any team integrations that matter (Linear, Jira, etc.)."

Wait for the answer. It goes verbatim into CLAUDE.md and drives the inference in 1.B. **Non-interactive mode (`--yes`): do not ask — use the `<description>` argument verbatim as this answer.**

### Step 1.B — Infer a draft profile from Q1

Apply these rules. Be explicit and conservative — when the description is ambiguous, pick the safer middle option (the user will see and can change everything in 1.C).

**Stack:**
- "FastAPI" + ("React" or "Vite") → preset A
- "FastAPI" + ("Next" or "Next.js") → preset B
- "Express" + "React" → preset C
- "Python" + script/agent/CLI/library indicators → custom Python (3.12 · uv · ruff · mypy · pytest), no frontend, no DB
- "Node" / "TypeScript" + script/CLI indicators → custom Node, no frontend, no DB
- Otherwise → preset A (most common)

**Project type (drives calibration):**
- script · CLI · library · agent · tool · utility → D Minimal (`/build --lite` recommended, no `calibration-profile.json`)
- marketplace · consumer · SaaS · B2C · landing page → A Consumer-facing
- dashboard · admin · internal tool · back-office · B2B internal → B Internal tool
- API-only · backend service · microservice · no UI → C API-only (no UI scoring)
- Otherwise → B Internal tool

**Verification mode:**
- Project type = D Minimal OR C API-only → C Stub
- Mentions Docker / Compose / a full-stack preset → A Docker
- Mentions local dev / no Docker / uvicorn / npm run dev → B Local
- Otherwise → A Docker

**Scaffold profile:** Default to `core` for every project. `core` is the lean product-development spine: `/build`, `/auto`, `/gate`, `/feature`, `/brownfield`, `/code-map`, `/change`, `/refactor`, `/vibe`, and tracker publishing. This keeps Sprint 2+ existing-code work available without copying optional ops/extras. If the user passes `--brownfield`, set `scaffoldProfile: "brownfield"` as a backward-compatible alias for the same lean product spine. If the user passes `--full`, set `scaffoldProfile: "full"` to copy the entire optional harness surface. If the user passes `--core`, set `scaffoldProfile: "core"`.

**Telemetry:** Default OFF. If the user passes `--telemetry`, set `telemetry: true`; otherwise leave it false/absent. The `record-run` hook still records local memory without OTEL/Pushgateway env.

**Drift workflow:** Default OFF. If the user passes `--drift-workflow`, set `quality.drift.workflow: true`. This copies `.claude/templates/github-workflows/harness-drift.yml` into `.github/workflows/harness-drift.yml` so GitHub Actions can run the slow-cadence drift, flake, harness-coverage, approved-fixtures, contract-drift, and optional SLO checks. Keep it separate from `--telemetry`: telemetry exports data; the drift workflow schedules quality checks.

**Plugins:** The deterministic generator trims target `enabledPlugins` to Playwright + Superpowers for `core` and `brownfield`. Use `full` only when the project should receive the whole optional plugin surface.

**Tracker:** Default to A Local-only unless Q1 explicitly names a tracker:
- Mentions "Linear" → C Publish + sync
- Mentions "Jira" → B Publish-only (Jira sync isn't fully implemented yet)

**Tech-stack pack — keyword match in Q1:**
- "LangChain" / "LangGraph" / "DeepAgents" / "LangSmith" / Python agent framework → A Python AI Agents (local bundled pack — default when the user doesn't ask for the external community pack specifically; it needs no manual install step, see option B below for the tradeoffs of the alternative)
- "ADK" / "Agent Development Kit" / "Gemini Enterprise" / "Vertex AI Agents" → C Google ADK
- Both sets of terms → both packs
- Neither → D None

**Domain vertical — keyword match in Q1:**
- "private equity" / "PE fund" / "deal sourcing" / "portfolio company" / GP/LP fund-management context → Private Equity
- No match → None

Graphify (the former Q6) is no longer asked here. It only matters for brownfield discovery — surface it inside `/brownfield`, not at scaffold time.

### Step 1.C — Show the confirmation card

**Non-interactive mode (`--yes`): skip this card entirely — proceed as if option A ("Scaffold with these choices") was chosen, straight to Step 2.**

Call `AskUserQuestion` ONCE with the inferred profile rendered as the `preview` of option A. Single-select, three options:

- **A) Scaffold with these choices** — accept the inferred profile as-is.
- **B) Change tracker mode only** — quick edit for the field hardest to infer.
- **C) Use the full configuration wizard** — for unusual stacks or full control.

The `preview` for option A must be a markdown block in this exact shape (substitute inferred values):

```
## Inferred profile

  Description     {first 120 chars of Q1}

  Stack           {inferred stack summary, e.g. "Python 3.12 · uv · ruff · mypy · pytest"}
  Project type    {A / B / C / D — display name}
  Verification    {A / B / C — display name}
  Scaffold        {core / brownfield / full}
  Telemetry       {off by default; on only with --telemetry}
  Plugins         Playwright + Superpowers in lean profiles; full optional set only in full
  Tracker         {A / B / C / D — display name}
  Tech-stack pack {A / B / C / D — display name(s)}
  Domain vertical {vertical display name, or "None"}

  (Graphify is no longer asked at scaffold time; surface it via /brownfield.)
```

For option B's `preview`, show the same block but emphasise the Tracker line ("← will change"). For option C, the preview can just say "Falls through to the full configuration wizard. Inferred values become the defaults."

### Step 1.D — Branch on the user's choice

1. **"Scaffold with these choices"** → record all inferred answers as final. Proceed to Step 2.

2. **"Change tracker mode only"** → call `AskUserQuestion` with a single question listing the 4 tracker options (wizard Q6 in `references/scaffold-wizard.md`). Record the answer, then proceed to Step 2. Do NOT loop back to the confirmation card.

3. **"Use the full configuration wizard"** → read `references/scaffold-wizard.md` and follow Step 1.E. Do not load that file otherwise.

If the user refuses to engage with the confirmation card ("just pick something", "use defaults"), treat that as informed consent for the inferred profile and proceed with option 1.

## Step 2: Generate — one script, not a hand-written tree

**Turn budget.** Every Bash/AskUserQuestion turn re-bills the cached prefix (`/clear` only drops the *previous* phase). After the profile is confirmed, do **exactly** this and stop:

1. `Write` `./.scaffold-profile.json` from the confirmed answers (schema at the top of `scaffold-apply.js`).
2. Resolve `PLUGIN_SOURCE` (`${CLAUDE_PLUGIN_ROOT}` if it has `.claude-plugin/plugin.json`, else ask).
3. Run apply — it owns the manifest (`quality.sensor_tier`, topology, `fastapi-code` / `react-code` auto-attach), module `CLAUDE.md`, `CODEBASE_MAP.md`, mutation starters, model-tier pins, git init, and docs copies:

```bash
node "$PLUGIN_SOURCE/scripts/scaffold-apply.js" \
  --profile ./.scaffold-profile.json \
  --plugin-source "$PLUGIN_SOURCE" \
  --target . \
  --scaffold-profile "${SCAFFOLD_PROFILE:-core}"
```

Add `--telemetry` / `--drift-workflow` only when those flags were passed. Non-zero exit: print stderr and **stop**.
4. Delete `./.scaffold-profile.json`.
5. Print apply's stdout as the report. Do **not** open, patch, or re-write files apply already wrote. Do **not** `sed` `init.sh` or invent `CODEBASE_MAP.md`.

What apply must produce (manifest shape, sensor tier `minimal` for `cli-or-library`, mutation, subdirectory CLAUDE.md) is documented in `references/scaffold-generation.md`. Read that file only if apply fails and you need the contract — not on the happy path.

### Optional Agent-Framework Skill Packs & Domain Vertical Plugins

If the profile selected an *external* pack (`langchain`, `google-adk`) or a domain vertical (from `.claude/config/scaffold-packs.json`), print the install commands apply cannot run in auto-mode (`npx --yes skills add cwijayasundara/agent_cli_langchain …`, `claude plugin marketplace add`, `claude plugin install`) and `node .claude/scripts/scaffold-vertical-status.js`. Local `python-ai-agents` / `fastapi-code` / `react-code` are already copied. `framework_skill_packs` / `domainVerticalPacks` land in the manifest via apply.

## Cache note

`/clear` between `/scaffold`, `/brd`, `/spec`, `/design` is required. Cache-read cost inside a phase is **turn count × prefix size**. This command stays short so the prefix stays cheap.
