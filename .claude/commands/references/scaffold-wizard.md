# `/scaffold` Step 1.E — wizard fallback

Load this file **only** when the user picked option C on the confirmation card.
Ask one at a time with `AskUserQuestion`. Pre-pend the inferred answer in each
question's description (e.g. "Inferred: A — change if needed").

1. "What are you building?" — skip; already captured in Step 1.A.
2. "What's your tech stack?"
   - A) Python (FastAPI) + React (Vite) + PostgreSQL
   - B) Python (FastAPI) + Next.js + PostgreSQL
   - C) Node (Express) + React (Vite) + PostgreSQL
   - D) Custom (I'll specify)
3. "What type of project is this?" (calibration):
   - A) Consumer-facing app (high design bar)
   - B) Internal tool / dashboard (functional focus)
   - C) API-only / backend service (no UI scoring)
   - D) Minimal — CLI / library / single-script (recommends `/build --lite`)

If the user picks D, install the `core` scaffold by default, recommend
`/build --lite`, and skip `calibration-profile.json`. `core` still includes the
minimal brownfield route because generated code becomes existing code after
Sprint 1; the user can request `--full` only when they want the entire optional
harness copied.

4. "How will the evaluator reach the running app?":
   - A) Docker Compose (default)
   - B) Local dev servers
   - C) Stub / mock server
5. "Install complementary official Claude Code plugins?"
   (`playwright` is installed unconditionally — the evaluator's Layer 2 browser
   checks and the design-critic vision loop depend on its MCP browser tools.
   This question covers only the optional extras.)
   - `superpowers` — Structured developer workflows used by the harness pipeline
   - `code-review` — Automated PR review with confidence scoring
   - `commit-commands` — `/commit`, `/commit-push-pr` git workflows
   - `security-guidance` — Real-time security pattern checking on edits
   - `pr-review-toolkit` — Specialized PR review agents (comments, tests, errors, types)
   - `frontend-design` — Aesthetic direction skill (does NOT replace `design-critic`)
   - `context7` — Up-to-date library/docs lookup MCP
   - `code-simplifier` — `/simplify` skill used during `/refactor`
   - A) Yes, install all eight (recommended)
   - B) Let me pick which ones
   - C) No, skip official plugins
6. "Enable optional external tracker orchestration?"
   - A) No, keep this project local-only
   - B) Publish generated story groups to Linear/Jira only
   - C) Publish + sync proof/status
   - D) Publish + external orchestrator dispatch
7. "Configure agent-framework skill packs?" (multi-select; default: None) — opt-in packs recorded in `project-manifest.json`.
   - A) Python AI Agents (LangGraph / LangChain / DeepAgents) — bundled directly in this harness, copied automatically, no manual install needed
   - B) LangChain / LangGraph / DeepAgents (external community pack) — `cwijayasundara/agent_cli_langchain` (9 skills, installed manually from a normal terminal because Claude Code auto-mode blocks external `npx skills add` installs)
   - C) Google ADK — `google/agents-cli` (7 skills, same manual-install caveat as B)
   - D) None
8. "Enable a domain-vertical plugin?" (single-select; default: None) — reads `.claude/config/scaffold-packs.json`'s `verticalPacks` array; recorded in `project-manifest.json`, installed manually via `claude plugin marketplace add` / `claude plugin install`.
   - A) Private Equity — `private-equity@claude-for-financial-services`
   - B) None
9. "Enforce bounded-context boundaries between domain modules?" (single-select; default: No) — a *vertical* import rule, distinct from the default-on horizontal layer/import-direction gate (`architecture.layers` in Step 2). Enforced by `.claude/hooks/lib/contexts.js` (gap G8) only when configured.
   - A) Yes — I'll list the context root directories
   - B) No, skip bounded-context enforcement (default)

   If A, ask a follow-up free-text question: "Which directories are the
   bounded-context roots? (comma-separated, e.g. `src/billing, src/user`)".
   Record as `architecture.contexts.roots`. Default `allow` to `[]` and `public`
   to `["index","public","__init__"]` unless the user names different
   entry-point conventions.

Then proceed to Step 2 in the command file.
