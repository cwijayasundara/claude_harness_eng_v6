# claude_harness_eng_v4

> GAN-inspired Claude Code plugin for autonomous long-running application development.

A scaffold that combines Karpathy ratcheting with a Generator–Evaluator architecture, agent teams, session chaining, and three-layer verification (API + Playwright + vision). Implements practices from [Anthropic](https://www.anthropic.com/engineering/harness-design-long-running-apps) and [OpenAI](https://openai.com/index/harness-engineering/) harness engineering research.

Version `1.1.4`. Repository: `https://github.com/cwijayasundara/claude_harness_eng_v4`.

## Install as a Claude local plugin

Pick one option. All three end with `/claude_harness_eng_v4:scaffold` available inside Claude Code.

### Option 1 — Per-session `--plugin-dir` (fastest)

```bash
git clone https://github.com/cwijayasundara/claude_harness_eng_v4.git ~/claude_harness_eng_v4

cd /path/to/your-project
claude --plugin-dir ~/claude_harness_eng_v4/.claude
```

### Option 2 — Local marketplace install (no flag needed afterwards)

```bash
mkdir -p ~/claude-harness-marketplace/{.claude-plugin,plugins}
cp -R ~/claude_harness_eng_v4/.claude ~/claude-harness-marketplace/plugins/claude_harness_eng_v4

cat > ~/claude-harness-marketplace/.claude-plugin/marketplace.json <<'EOF'
{
  "name": "local-harness",
  "owner": { "name": "Local" },
  "plugins": [
    {
      "name": "claude_harness_eng_v4",
      "source": "./plugins/claude_harness_eng_v4",
      "description": "Claude Harness Engine scaffold"
    }
  ]
}
EOF

claude plugin marketplace add ~/claude-harness-marketplace
claude plugin install claude_harness_eng_v4@local-harness --scope user
```

To refresh after editing the harness:

```bash
rm -rf ~/claude-harness-marketplace/plugins/claude_harness_eng_v4
cp -R ~/claude_harness_eng_v4/.claude ~/claude-harness-marketplace/plugins/claude_harness_eng_v4
claude plugin update claude_harness_eng_v4@local-harness --scope user
```

### Option 3 — Manual copy

```bash
SOURCE=~/claude_harness_eng_v4
cd /path/to/your-project
cp -R "$SOURCE/.claude" .
cp "$SOURCE/CLAUDE.md" "$SOURCE/design.md" .
claude
```

## First run

Inside Claude Code, from your target project directory:

```text
/claude_harness_eng_v4:scaffold
```

This copies `.claude/`, `CLAUDE.md`, `design.md`, `init.sh`, `project-manifest.json`, and seed state into the project. After scaffolding, commands work without the namespace prefix (`/brd`, `/spec`, `/design`, `/auto`).

## Picking a lane

Three pre-pipeline lanes match ceremony to scope. Pick before invoking `/brd`.

| Lane | Use when | Output |
|------|----------|--------|
| **`/lite`** | New project, small surface — CLI tool, single-script utility, small library. ≤ 5 stories, one language, no DB migrations, no auth. | One-page BRD-lite + 3–5 stories in a single group A + minimal `specs/design/`, then hand-off to `/auto --group A`. |
| **`/brownfield`** | Existing codebase you need to map before changing it. | `specs/brownfield/` with `codebase-map.md`, `architecture-map.md`, `code-graph.json`, `risk-map.md`, `change-strategy.md`. |
| **`/vibe`** | Tiny low-risk change — doc fix, copy tweak, one-file bug fix. ≤ 3 files and < 150 lines diff. | Micro-contract appended to `.claude/state/vibe-log.md`, then narrow edit + targeted verification. |
| Full pipeline | Anything else — multi-service apps, real DBs/auth, frontend + backend, public APIs. | `/brd` → `/spec` → `/design` → `/auto` (or `/build` to run the whole thing gated). |

`/lite` is the greenfield equivalent of `/vibe`: it skips the full Socratic BRD, the 6-layer story decomposition, and the GAN design-critic loop. Eligibility is strict — if scope grows past the cap (more stories, second service, DB migrations, auth), `/lite` stops and tells you to escalate to the full pipeline.

### `/lite` example

A "Python CLI that searches the web with DuckDuckGo and summarizes with an LLM" looks like this in `/lite`:

```text
/lite "Python CLI research assistant: DeepAgents + DuckDuckGo + OpenAI"

→ 5 questions (name, runtime, capability, external deps, interface)
→ specs/brd/brd.md         ~ 40 lines
→ specs/stories/E1-S1.md   search tool
→ specs/stories/E1-S2.md   agent + orchestrator
→ specs/stories/E1-S3.md   CLI entrypoint + flags
→ specs/stories/E1-S4.md   tests
→ specs/design/            folder-structure + component-map + api-contracts (CLI shape only)
→ /auto --group A          one ratchet pass, one commit
```

The same requirement on the full pipeline would generate ~16 stories across 8 dependency groups with a multi-page BRD and design-critic iterations — disproportionate for a ~200-LoC utility.

## Commands

| Command | Purpose |
|---------|---------|
| `scaffold` | Initialize a project with the harness |
| `brd` → `spec` → `design` → `auto` | Full SDLC pipeline (also via `build`) |
| `lite` | Compressed greenfield lane for small projects (CLI / library / single-script) |
| `vibe` | Controlled small-change lane with micro-contract |
| `brownfield` / `code-map` / `seam-finder` | Discover and map an existing repo before changing it |
| `implement` / `evaluate` / `review` / `test` | Per-phase invocations |
| `fix-issue` / `refactor` / `improve` | Targeted change lanes |
| `deploy` | Docker Compose + `init.sh` |
| `tracker` / `tracker-publish` | Optional Linear/Jira orchestration |

Prefix with `/claude_harness_eng_v4:` when loaded as a plugin from outside a scaffolded project. Inside a scaffolded project, the short form (`/brd` etc.) works.

## Plugin layout

```text
.claude/
  .claude-plugin/plugin.json   # manifest (metadata only — no explicit skill/agent/command paths)
  skills/   agents/   commands/   hooks/   templates/   state/
  settings.json                # project-scoped settings, copied into target repos
```

Claude Code auto-discovers `skills/`, `agents/`, and `commands/` by directory convention.

## Optional pieces

- **Superpowers integration** — auto-enabled by `/scaffold`; adds brainstorming, TDD, debugging, planning, and verification skills at key pipeline stages.
- **Complementary official plugins** — `code-review`, `commit-commands`, `security-guidance`, `pr-review-toolkit`, `frontend-design`, `context7`, `code-simplifier` are offered during scaffolding. `feature-dev` and `hookify` are excluded (conflict with the harness pipeline).
- **`symphony_clone/`** — standalone Linear → GitHub orchestrator. Runs separately, not copied into target repos. See `symphony_clone/README` for setup.

## Requirements

- Claude Code v2.1.32+
- Node.js 18+ (hooks)
- For generated projects: Python 3.12+ and/or Node.js 20+, plus Docker + Docker Compose if you choose Docker verification.

## Where to read more

- `design.md` — architecture, agent roles, hook order, sprint contract format
- `CLAUDE.md` — project-local guide copied into scaffolded repos
- `.claude/program.md` — human steering knobs for `/auto`
- `.claude/skills/<name>/SKILL.md` — full per-skill instructions

## Based on

- [Anthropic: Harness Design for Long-Running Application Development](https://www.anthropic.com/engineering/harness-design-long-running-apps)
- [Anthropic: Effective Harnesses for Long-Running Agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [OpenAI: Harness Engineering](https://openai.com/index/harness-engineering/)
- [Steve Krenzel: AI is Forcing Us to Write Good Code](https://bits.logic.inc/p/ai-is-forcing-us-to-write-good-code)

## License

MIT
