# automated_e2e_test — self-healing lifecycle smoke

The fast (~15–20 min) end-to-end proof that the harness engine is wired together
**and can extend code it already generated**. It complements — does not replace —
the ~90-min certification suite in `test/e2e/`.

## What it does

A single live run against real `claude -p`:

```
1. /scaffold            harness into a fresh temp dir (automated_e2e_test/smoke-output/)
2. /build --lite        generate a tiny counter web app (server.js + page + tests)
3. verify v1 (browser)  Playwright: click #increment -> #count = 1
4. /change              add a #decrement button to the GENERATED code
5. verify v2 (browser)  Playwright: #decrement lowers count AND #increment still works
```

Each browser verification is wrapped in a **bounded self-healing fix loop**
(`MAX_FIX_ATTEMPTS = 3`): on failure it feeds the failing assertion + browser
console errors back through `/change` and retries. The browser is the
**independent oracle** — the generator never grades its own work, which is the
property that separates this from Devin-style self-judged verification.

## Why a web counter (not the todo CLI)

The CLI path is already certified by `test/e2e/harness-real-workflow.test.js`.
This harness deliberately covers the **uncovered** path: a browser-driven app +
a *modify-already-generated-code* cycle + a fix loop. Additive, not duplicative.

## Run it

```bash
cd automated_e2e_test
npm install
npm run install:browser   # one-time: playwright chromium
npm run smoke             # live; costs tokens; ~15-20 min
```

Artifacts land in `smoke-output/`; failure screenshots in `screenshots/`.

## Cheap gate (runs in `npm test`)

The static contract `../test/automated-e2e-contract.test.js` asserts this harness
wires the full lifecycle (scaffold → build → browser-verify → `/change` →
regression → fix loop) **without** paying for a live run — same convention as
`test/real-workflow-e2e-contract.test.js`.

## Plan-only lane (inspect `specs/` locally)

The cheap "is the plan good?" check — runs the **architect** half only and stops,
so you can eyeball the generated `specs/` before any code or PR:

```
/scaffold → /build --autonomous --plan-only prd.md   → specs/ (BRD, stories +
            dependency graph, design, test plan)        then STOP. No code, no PR.
```

```bash
cd automated_e2e_test
npm run plan             # live; ~plan phases only; cheaper than the full smoke
# then open plan-output/specs/ — especially stories/dependency-graph.md (clusters + Mermaid)
```

It prints a `specs/` inventory + cluster/edge/story counts (`helpers/specs-summary.js`)
and points you at the artifacts. Uses the sample PRD at `fixtures/sample-prd.md`
(swap in your own). This is the local validation step before a semi-auto
(`--autonomous`) or full-auto (`--auto`) run fans out per-cluster PRs.

## Reused, not reinvented

The live runner is the shared `test/e2e/helpers/claude-runner.js` (budgeted,
MCP-isolated `claude -p`). Only the browser oracle + app lifecycle
(`helpers/app-runtime.js`) and the orchestration are new.
