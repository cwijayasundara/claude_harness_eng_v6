# DeepWiki (Project Zero)

Living navigation for the harness monorepo.

**Start here (humans):** [`docs/CODEBASE.md`](../docs/CODEBASE.md)

| Artifact | Path |
|----------|------|
| Human homepage | `docs/CODEBASE.md` |
| Code graph | `specs/brownfield/code-graph.json` |
| Symbol map | `specs/brownfield/symbol-map.md` |
| Deterministic wiki | `specs/brownfield/wiki/WIKI.md` |
| Concept clusters | `specs/brownfield/wiki/concepts/` |
| Quality receipt | `specs/reviews/quality-card.md` |
| PR walkthrough | `specs/reviews/walkthrough.md` |
| Control system | `HARNESS.md` + `harness-manifest.json` |

```bash
npm run human-codebase          # refresh docs/CODEBASE.md
npm run ask -- "your question"  # ask the codebase
npm run quality-card            # after /gate
node .claude/scripts/nav-query.js refresh
```
