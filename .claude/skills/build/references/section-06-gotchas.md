## Gotchas

- **Proceeding without approval:** in the default gated model, Phases 1-3 each require explicit human approval — silence is not consent; if the user has not clearly approved, ask again. In `--autonomous` mode there is exactly **one** gate (Phase 3.5) — never invent extra stops after it, and never skip it. In `--auto` mode there are **zero** human gates before the PR(s); the machine gates carry all the weight, so never weaken them to "make it run".
- **Raising a PR over a red build:** Phase 11 is reachable only when Phase 9.5 and `/gate` are green. Never open a PR on a failing or unverified build, even in `--autonomous` mode.
- **Skipping the design phase:** Phase 3 produces `component-map.md` and `api-contracts.md` which are required by `/auto` for sprint contracts and file ownership. Skipping design breaks the entire downstream pipeline.
- **Not initializing state files:** Phase 4 must create all three state files before `/auto` runs. Missing state files cause context recovery failures in session chaining.
- **Wrong mode passthrough:** Read the `--mode` flag from the user's invocation and pass it to `/auto` exactly. Do not default silently if the user specified a mode.
