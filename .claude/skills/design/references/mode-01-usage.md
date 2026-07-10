## Usage

```
/design               # full pipeline mode (default)
/design --doc-only    # lightweight architecture narrative, no pipeline
/design --doc-only [path]   # write the doc to [path] instead of the default
/design --delta --stories specs/stories/sprint-N/ --amendment-id sprint-N   # sprint delta
/design --delta --story specs/stories/E{n}-S{n}.md --amendment-id story-E{n}-S{n}   # single-story delta
/design --baseline-recovery   # one-time: derive a living design from an existing codebase
```

The default reads from `specs/stories/` and produces architecture documents, machine-readable schemas, and HTML mockups concurrently — it is an SDLC gate.

`--doc-only` is a different lane entirely: it authors a single architecture / ARB narrative document and does **nothing else**. See **Doc-Only Mode** below. Use it for Architecture Review Board write-ups, design proposals, and discussion documents that are not (yet) driving a build.

`--delta` and `--baseline-recovery` are a third lane: amending or bootstrapping the **living** `specs/design/` baseline for a system already past sprint 1. See **Delta Mode** and **Baseline Recovery Mode** below. Unlike `--doc-only`, both write into `specs/design/` — they are SDLC gates, not disposable artifacts.

---
