# harness-lite

The **artifact-only** loadout for the Claude Harness Engine. Load this instead of the full `claude_harness_eng_v5` plugin when the work is producing **disposable artifacts** rather than shipped code:

- UI mockups
- Architecture / ARB (Architecture Review Board) narrative documents
- Research / analysis reports

## Why a separate loadout

The full harness is built for autonomous, long-running application development: a generator/evaluator (GAN) loop, ratchet gates, security review, and quality-gate hooks that fire on every write and stop. That machinery is exactly right for code that ships — and pure overhead for a mockup, a design document, or a research write-up.

harness-lite ships **only** the artifact lanes and **none** of that machinery:

- No `/build`, `/auto`, `/implement`, `/change`, `/refactor`, `/scaffold`.
- No generator, evaluator, security-reviewer, or design-critic agents.
- No PreToolUse / PostToolUse / Stop hooks.

So in this loadout it is *structurally impossible* to trigger the heavyweight pipeline — there is nothing to trigger. (The full harness also guards against this from the other direction: an `artifact-guard` hook blocks SDLC commands in workspaces marked `.artifact-workspace`. harness-lite needs no such guard because the commands are simply absent.)

## Install / load

```
claude --plugin-dir ~/claude_harness_eng_v5/harness-lite/.claude
```

Load harness-lite **instead of**, not alongside, the full harness for artifact work — loading both would bring the SDLC machinery back.

### Optional companion skills

Two lanes delegate to external skills when present, and fall back to inline behavior when not:

- **`/mockup`** prefers the `frontend-design` plugin skill.
- **`/research`** prefers the `deep-research` skill.

Install those separately if you want their full capability; the lanes work without them.

## Lanes

| Command | Purpose |
|---|---|
| `/arch-doc` | Author an architecture / ARB narrative document |
| `/mockup` | Create a UI mockup / component (uses `frontend-design` if installed) |
| `/research` | Produce a research / analysis report (uses `deep-research` if installed) |

## When to switch back to the full harness

The moment an artifact becomes shipped product code — a mockup turning into a real component, a design doc driving an actual build — switch to the full `claude_harness_eng_v5` loadout and enter the SDLC pipeline (`/brd` → `/spec` → `/design` → `/auto`). harness-lite is for the artifact, not the product.
