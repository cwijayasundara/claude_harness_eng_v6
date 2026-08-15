# OpenWiki for Claude Harness Engine

This package runs [OpenWiki 0.3](https://github.com/langchain-ai/openwiki) against
the repository while keeping generated documentation in `open_wiki/wiki/` rather
than OpenWiki's default root-level `openwiki/` directory. It uses OpenAI with
`gpt-5.6-terra` by default.

Pages are emitted as an
[Open Knowledge Format (OKF) v0.1](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
bundle: every concept document carries YAML front matter with a non-empty `type`,
Markdown links express relationships, and `index.md` is a reserved document
rather than a concept. Mermaid diagrams are embedded where they beat prose and
are validated after each run; a diagram that fails validation degrades to a
commented `text` fence and is repaired on the next `wiki:update`.

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

# Explore the wiki live in OpenWiki's native visualizer (local server).
npm run wiki:visualize --prefix open_wiki

# Ask a one-off documentation question in OpenWiki's code mode.
npm run wiki:ask --prefix open_wiki -- "How does the brownfield route work?"
```

`.openwikiignore` at the repository root keeps generated output and runtime
state out of doc runs. Paths listed there are hard-excluded from the agent's
reads, so widen it rather than relying on the brief alone when new generated
trees appear.

If your shell is already in `open_wiki/`, omit `--prefix open_wiki`:

```bash
npm run wiki:check
npm run wiki:init
npm run wiki:update
npm run wiki:graph
npm run wiki:visualize
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

### Versus OpenWiki's native visualizer

OpenWiki 0.3 ships its own visualizer (`npm run wiki:visualize`, exposed here
over `open_wiki/wiki/`). The two are complementary, not redundant, so both are
kept:

| | `wiki:graph` (this package) | `wiki:visualize` (OpenWiki) |
| --- | --- | --- |
| Output | Committed static `context-graph.html` | Local server on `127.0.0.1`, nothing committed |
| Nodes | Wiki pages **and repository source files** | Wiki pages only |
| Edges | Page→page links **and page→source citations** | Page→page links, with backlinks |
| Reading | Graph only | Graph beside a live Markdown reader |
| Index pages | Skipped (OKF reserved documents) | Shown as `Section` nodes |

The documentation-to-source dimension is the reason to keep `wiki:graph`: it is
what turns the verified citations the brief asks for into a reviewable map of
which wiki page explains which part of the repository. Use `wiki:visualize` to
read and navigate, `wiki:graph` for the committed, review-time artifact.

## Configuration

Defaults are in `.env.example`:

| Setting | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | required | OpenAI API credential |
| `OPENWIKI_MODEL_ID` | `gpt-5.6-terra` | OpenAI model ID |
| `OPENWIKI_TELEMETRY_DISABLED` | `1` | Opt out of OpenWiki telemetry |

OpenWiki itself manages a small marked block in root `AGENTS.md` and `CLAUDE.md`
so future coding agents know to consult the wiki. The wrapper rewrites that block
to point to `open_wiki/wiki/`. It also replaces OpenWiki's default workflow with
`github-actions.yml`, which calls this wrapper and needs `OPENAI_API_KEY` saved
as a GitHub Actions repository secret.

## Important implementation detail

OpenWiki 0.3 still hard-codes `openwiki/` as its code-mode output directory.
The wrapper temporarily stages `open_wiki/wiki/` at that location during a run and
moves it back atomically afterward. It refuses to run if an unrelated root
`openwiki/` directory is present, preventing accidental overwrites.
