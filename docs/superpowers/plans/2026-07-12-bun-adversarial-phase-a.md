# Bun Adversarial / Mechanical Loops — Phase A Implementation Plan

> **For agentic workers:** Implement task-by-task. Prefer TDD: failing test → code → pass → commit.

**Goal:** Ship Phase A of [docs/proposals/bun-adversarial-mechanical-loops.md](../../proposals/bun-adversarial-mechanical-loops.md): dual adversarial review (tiered), anti-stub Iron Law + stub-smell gate, multi-agent git safety, process-rules path.

**Versioning:** **Not a v6 product reboot.** Ship as **`2.2.0`** minor under `claude_harness_eng_v5`. Defaults stay backward-compatible (`review.adversarial: auto`); existing `code-review-verdict.json` consumers unchanged. Major (3.0.0) only if defaults flip to always-adversarial or public verdict contracts break. Product rename to “v6” only for a deliberate SKU/plugin-namespace reboot.

**Architecture:** Additive scripts + hooks + skill/agent prose. Pure logic in `hooks/lib/*`; git plumbing / CLI in `scripts/*`. Wiring tests for prompt-only paths.

**Tech stack:** Node.js `node:test` + `node:assert`.

## Global constraints

- Surgical skill edits; no drive-by reformat.
- Register new sensors/guides in `harness-manifest.json` + `HARNESS.md`.
- Add every new script to `CORE_SCRIPTS` in `scaffold-copy.js`.
- Decisions locked: D1 `union`, D2 same auto thresholds on `/change`, D3 separate `process-rules.md`, D6 reviewer always + commit gate on standard+.

---

### Task order

1. Anti-stub guide + stub-smell gate  
2. Git safety lib + pre-bash  
3. merge-review-verdicts + adversarial skill wiring  
4. process-rules injection  
5. Registry, changelog, package `2.2.0`, design-doc status  

(See proposal §9 wiring map for full file list.)
