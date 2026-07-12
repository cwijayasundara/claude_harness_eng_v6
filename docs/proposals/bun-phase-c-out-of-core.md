# Bun Phase C — explicitly out of harness-core

Companion to [bun-adversarial-mechanical-loops.md](./bun-adversarial-mechanical-loops.md) §7.

These Bun practices are **not** shipped in harness-core / harness-full as product defaults. They remain valid for verticals or ops environments that need them.

## Fuzz → auto-PR

Bun runs 24/7 coverage-guided fuzzing of parsers and auto-opens PRs for human review.

**Why not core:** domain-specific (parsers, codecs), expensive CI, and safety policy (auto-PR from fuzz findings needs human ownership of merge — which we already enforce elsewhere).

**If you need it:** add a project-local workflow or CI job that:

1. Runs the fuzzer  
2. Minimizes a repro  
3. Opens a draft PR with the failing input + stack (never merge)  
4. Routes through `/change --issue` or `/pr-respond` for the fix loop  

Do not add a default fuzz farm to `/scaffold`.

## cgroup / systemd-run isolation

Bun used cgroups to cap CPU/memory/PID for stress tests that exhaust sockets and disk.

**Why not core:** ops concern for stress harnesses, not application SDLC scaffolds; host permissions vary (macOS has no systemd-run).

**If you need it:** wrap stress jobs in your CI image with cgroup v2 limits; keep the harness’s `budget-state.js` wall-clock/agent caps as the product control plane.

## Always-on 64-way agent farms

Bun’s peak concurrency was a one-off rewrite budget, not a product default.

**Our stance:** pod/`--worktree` + budget caps; dual review is **tiered**, not always-on.
