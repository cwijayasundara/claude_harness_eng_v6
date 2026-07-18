# OpenWiki for Claude Harness Engine

This package runs [OpenWiki 0.2](https://github.com/langchain-ai/openwiki) against
the repository while keeping generated documentation in `open_wiki/wiki/` rather
than OpenWiki's default root-level `openwiki/` directory. Its default is OpenAI
with `gpt-5.6-terra`; Moonshot Kimi K3 remains available as an alternative.

## One-time setup

From the repository root:

```bash
npm install --prefix open_wiki
cp open_wiki/.env.example open_wiki/.env
# Add OPENAI_API_KEY=... to open_wiki/.env (this file is gitignored).
npm run wiki:check --prefix open_wiki
```

Node 22 or later is required. Do not commit an API key. The wrapper automatically
loads `open_wiki/.env`, while shell variables take precedence.

OpenWiki uses `better-sqlite3` for local checkpoints, so install dependencies
without `--ignore-scripts`. If its native binding is missing after an interrupted
or script-disabled install, repair it from the repository root:

```bash
npm rebuild better-sqlite3 --prefix open_wiki
```

## Generate and maintain the wiki

From the repository root:

```bash
# First full pass; this consumes model tokens.
npm run wiki:init --prefix open_wiki

# Later, refresh only documentation affected by repository changes.
npm run wiki:update --prefix open_wiki

# Regenerate the browser-ready context graph from the committed wiki.
npm run wiki:graph --prefix open_wiki

# Ask a one-off documentation question in OpenWiki's code mode.
npm run wiki:ask --prefix open_wiki -- "How does the brownfield route work?"
```

If your shell is already in `open_wiki/`, omit `--prefix open_wiki`:

```bash
npm run wiki:check
npm run wiki:init
npm run wiki:update
npm run wiki:graph
```

The content brief lives in `INSTRUCTIONS.md`. Edit it before the first run to
change the information architecture or emphasis. Generated pages are intentionally
tracked in `open_wiki/wiki/`, so they can be reviewed like any other docs change.

## Context graph

Every `wiki:init` and `wiki:update` run also writes
`open_wiki/wiki/context-graph.html`. Open that file in a modern browser for an
interactive graph of the documentation pages and the repository files/directories
they explicitly cite. It supports search, tag and node-kind filters, selectable
layouts, click-through details, and computed backlinks.

The graph follows the Google OKF reference visualizer's model—Markdown links are
documentation-to-documentation relationships and verified inline source paths are
documentation-to-source relationships—but is generated natively by this package.
The only browser-time dependency is Cytoscape.js, loaded from jsDelivr; use a
network-connected browser to view it. `wiki:graph` regenerates the artifact
without calling a model, which is useful after reviewing or manually correcting a
generated page.

## Configuration

Defaults are in `.env.example`:

| Setting | Default | Purpose |
| --- | --- | --- |
| `OPENWIKI_PROVIDER` | `openai` | `openai` (default) or `moonshot` |
| `OPENAI_API_KEY` | required for `openai` | OpenAI API credential |
| `OPENWIKI_MODEL_ID` | `gpt-5.6-terra` | OpenAI model ID |
| `MOONSHOT_API_KEY` | required for `moonshot` | Moonshot API credential |
| `MOONSHOT_BASE_URL` | `https://api.moonshot.ai/v1` | OpenAI-compatible Moonshot endpoint |
| `MOONSHOT_MODEL_ID` | `kimi-k3` | Model passed to Moonshot |
| `OPENWIKI_TELEMETRY_DISABLED` | `1` | Opt out of OpenWiki telemetry |

OpenWiki itself manages a small marked block in root `AGENTS.md` and `CLAUDE.md`
so future coding agents know to consult the wiki. The wrapper rewrites that block
to point to `open_wiki/wiki/`. It also replaces OpenWiki's default workflow with
`github-actions.yml`, which calls this wrapper and needs `MOONSHOT_API_KEY` saved
as a GitHub Actions repository secret.

## Important implementation detail

OpenWiki 0.2 currently hard-codes `openwiki/` as its code-mode output directory.
The wrapper temporarily stages `open_wiki/wiki/` at that location during a run and
moves it back atomically afterward. It refuses to run if an unrelated root
`openwiki/` directory is present, preventing accidental overwrites.
