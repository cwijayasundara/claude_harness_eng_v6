# Productive Agentic Engineering

### Human judgment, machine loops, and commercial software that ships without “agent psychosis”

**Version:** 1.2 · **Date:** 2026-07-15  
**Preferred format:** open [`docs/agentic-engineering-whitepaper.html`](./agentic-engineering-whitepaper.html) in a browser (navigable, offline).  
**Audience:** Engineering leaders, staff/principal engineers, and teams rolling out Claude Code, Codex, Grok CLI, or similar agentic coding tools in production environments  
**Companion materials:** [`docs/harness-guide.html`](./harness-guide.html) · [`docs/zl-continuum-rubric.md`](./zl-continuum-rubric.md) · [`docs/proposals/bun-adversarial-mechanical-loops.md`](./proposals/bun-adversarial-mechanical-loops.md) · [`docs/fusion-ab-runbook.md`](./fusion-ab-runbook.md) · [Harness Engineering (Latent Space)](https://www.latent.space/p/harness-eng)  
**Harness companion version:** Claude Harness Engine **v5 / 2.5.0** (product line v5; Bun-inspired dual review + mechanical loops shipped as minors 2.2–2.4; cost-per-outcome benchmark + `fusion` cheap-worker preset + A/B harness shipped as 2.5)

---

## Abstract

Coding agents are now fast enough that **overuse**, not underuse, is the default failure mode. Engineers hand the agent every click—including “check the ADO board”—while models still lack durable **domain judgment** in private equity, banking, insurance, and other regulated verticals. Stage rhetoric splits into extremes (“code is free, zero human review” vs “read every line”), but productive teams do neither as a personality cult.

This white paper consolidates:

1. The **Z/L Continuum** (Zechner ↔ Lopopolo): place *each task*, not each person.  
2. Empirical evidence that AI assistance can **impair skill formation** (especially debugging and code reading) when used as pure delegation.  
3. Evidence of **cognitive offloading** and reduced engagement under unguided GenAI use.  
4. Field patterns from **harness engineering**: contracts, generators vs evaluators, ratchets, and human gates where silent wrongness is expensive.  
5. Lessons from **large multi-agent mechanical work** (e.g. Bun’s Claude-assisted Zig→Rust port): prep maps, canaries, dual adversarial review, tool-error work queues, and **process edits** when agents misbehave—not only code patches.  
6. A practical operating model for **commercial / production software**: keep humans on requirements and design; let agents generate under verification; always do *band-appropriate* review (never blank-on-the-diff).

**Thesis:** Productivity in agentic engineering is not “use the agent more.” It is **routing**—which work goes to agents, which stays human, how hard verification must be, and where domain experts must veto plausible-sounding fiction. When agents scale, the product is the **loop**, not the prompt.

---

## 1. The problem we actually have

### 1.1 Agent as default interface

Once a team is given a strong coding agent plus a harness (lanes, hooks, state, evaluators), a predictable behavioral shift appears:

| Intended use | Observed misuse |
|--------------|-----------------|
| Implement a story under a contract | “Ask the agent to do the sprint plan *and* the tickets *and* the standup notes” |
| Run tests / fix red CI | “Agent, open ADO and tell me if the board is green” |
| Draft a technical spike | “Agent, invent the PE waterfall / insurance reserve rules from memory” |
| High-confidence pure-tech refactor | Same ceremony as a multi-epic domain product |

The agent is a **powerful hammer**. Without explicit norms, everything becomes a nail. That is not a model failure; it is an **attention and policy** failure.

### 1.2 Two conferences, opposite standing ovations

At AI Engineer Europe, OpenAI’s Ryan Lopopolo argued (in spirit) that **code is cheap / a liability to hoard**, that extreme harness + token volume can push human-authored LOC and human review toward zero on some frontiers. Mario Zechner closed the same conference arguing the opposite social contract: **slow down and read critical code**. Both got applause. Both can be right **for different tasks**.

Alex Volkov named the space between them the **Z/L Continuum** (Zechner ↔ Lopopolo): you are not permanently “Team Z” or “Team L.” **Every task** gets a place on the continuum; **placing it correctly is the skill**.

Related cultural signals (2025–2026):

- Public debate over shipping unread agent code (“agent psychosis,” community pushback on vibe-only shipping).  
- Corrections from “let the agent cook” maximalism toward reintroducing human reading on non-trivial work.  
- Frontier labs reporting **very high shares of AI-authored merged code** (e.g. Anthropic’s public note that Claude authored **>80%** of lines merged into their production codebase by mid-2026)—while still emphasizing **direction, review, and verification** as the human job, not abdication.

### 1.3 Domain gravity: why PE / BFS / insurance bite harder than pure tech

Frontier models are excellent at **generic software patterns**: CRUD APIs, React/Vite UI, document parsing pipelines, infra glue, test scaffolding. They are weak at **domain-grounded product definition**:

| Layer | Pure technical (e.g. document intelligence) | Domain-heavy (PE, BFS, insurance) |
|-------|-----------------------------------------------|-----------------------------------|
| Vocabulary | Shared across Stack Overflow | Vertical jargon, conflicting house styles |
| “Correct” | Tests + schemas often decide | Regulation, product policy, fund docs, actuarial intent |
| BRD / epic / story quality | Model can invent plausible structure | Model invents **plausible but wrong** processes (NAV, covenants, claims, KYC) |
| Silent failure | Often fails tests or demos | Passes demos while encoding wrong business law |
| Who must own truth | Staff engineer + QA | Domain SMEs + compliance + engineering |

**Experience pattern (repeated in the field):** agentic tools work well when the *specification is technical and verifiable*. They become expensive when the *specification is domain-heavy* and the team treats the model as a junior product owner.

Document intelligence, ETL, internal admin UIs, test harnesses, and well-bounded API wrappers sit further **L** (automation-friendly). IC memo semantics, insurance product rules, and banking booking models sit further **Z** until a human has frozen vocabulary and acceptance.

---

## 2. What the research actually says

This section is not anti-AI. It is anti-**magical oversight**.

### 2.1 Skill formation: AI can make you faster and dumber at the same time

Anthropic’s RCT (*How AI Impacts Skill Formation*, Shen & Tamkin, arXiv:2601.20245; public write-up Jan 2026) studied developers learning an unfamiliar async library (Trio) with vs without AI assistance.

**Headline results:**

- AI group scored **~17 percentage points lower** on a post-task quiz (≈50% vs ≈67%; large effect, *p* ≈ 0.01).  
- Gaps were worst on **debugging** and understanding—exactly the skills needed to supervise AI-written code.  
- Speed gains were small and **not statistically significant** in that learning setting (time spent *prompting* often ate the win).  
- **How** people used AI mattered more than whether they used it.

| Low-mastery patterns | High-mastery patterns |
|----------------------|------------------------|
| Full **AI delegation** | **Conceptual inquiry** (ask why, then code) |
| Progressive reliance → full handoff | **Hybrid code + explanation** |
| Iterative AI debugging without understanding | **Generate, then force comprehension** |

Implication for production teams: if juniors only *delegate*, you grow a workforce that cannot run the oversight function the enterprise still needs. Agentic coding products (Claude Code, Codex, etc.) likely amplify this more than a sidebar chat—Anthropic notes that explicitly.

**Workplace translation**

| Role of AI | Effect on skill | When to encourage |
|------------|-----------------|-------------------|
| “Write it all; I’ll click merge” | Skill atrophy | Almost never for shared core |
| “Explain this library, then I’ll implement” | Skill preserved | Onboarding, new domains |
| “Generate, then quiz me / walk me through risks” | Skill + speed | Default for M-band work |
| “Implement against *my* contract; I own acceptance” | Oversight capacity | Commercial shipping |

### 2.2 Cognitive offloading and engagement

Broader psychology literature (e.g. Scientific Reports 2025 work on GenAI collaboration enhancing performance while reducing intrinsic motivation / control dynamics; surveys linking frequent AI use to offloading and weaker critical engagement) points the same direction:

- Unguided GenAI use improves **immediate task output**.  
- It often reduces **felt ownership, effort, and later solo transfer**.  
- Structured prompting / forced engagement reduces offloading and improves reasoning quality versus free-form “just do it.”

**Engineering translation:** “Agent, fix everything” is unguided offloading. “Agent, implement stories S-12..S-14 against this contract; do not invent domain rules” is structured engagement.

### 2.3 Frontier labs still need humans—as routers and verifiers

Anthropic’s public RSI-adjacent narrative (*When AI builds itself*) reports extreme internal AI authorship rates and rising LOC per engineer, framed as humans **directing and reviewing** rather than typing. That is not “humans left the loop.” It is **humans moved up the stack**—exactly what commercial teams must design for on purpose, or they will do it accidentally and poorly.

OpenAI-adjacent “extreme harness engineering” discourse (Lopopolo / Latent Space harness conversations) pushes the same structural point: at high token volume, **the harness (tests, graders, environments, policies)** becomes the product more than individual keystrokes.

---

## 3. The Z/L Continuum as an operating system

### 3.1 Definitions

| Pole | Stance | Failure mode |
|------|--------|--------------|
| **L — Lopopolo** | Code is cheap; agents generate; verification is the product | *Agent psychosis*: unread diffs, illegible repos, Christmas-tree uptime, silent domain lies |
| **Z — Zechner** | Read critical lines; slow down where wrongness is expensive | *Artisanal drag*: seniors retype leaf work agents + tests already prove |

**You are not a pole.** You place **this PR / this story / this decision**.

### 3.2 Sixty-second placement (field rubric)

Score each axis **0 (L-friendly) → 2 (Z-required)**. Sum places the band.

| Axis | 0 | 1 | 2 |
|------|---|---|---|
| **Blast radius** | Leaf, internal, reversible | Cross-module, easy rollback | Auth, money, PII, migrations, public API, irreversible data |
| **Observability of done** | Tests/evals catch failure | Partial tests | Silent wrongness possible |
| **Longevity** | Spike / throwaway | Multi-sprint product | Multi-year shared core |
| **Coverage of symbols** | Covered / new tested unit | Mixed / pinnable | Uncovered god-file |
| **Ownership** | Solo + you own pager | Clear owner | Multi-team shared surface |
| **Domain novelty** *(extension)* | Generic tech, model-fluent | Partial vertical glossary | PE/BFS/insurance rules not frozen by SMEs |

| Sum | Band | Human read | Agent autonomy |
|-----|------|------------|----------------|
| 0–2 | **L** | Walkthrough skim | High (micro-contract + targeted tests) |
| 3–5 | **M** | Contracts + high-churn hunks | Medium (story + gate) |
| 6–12 | **Z** | Risk surface line-read + independent review | Draft under contracts; humans own truth |

**Hard overrides → at least M, usually Z:** auth/secrets/payments, schema migrations, new public API, uncovered production edit, ambiguous requirements after short clarify, **any unfrozen domain rule that can cost money or license**.

Full team checklist: [`docs/zl-continuum-rubric.md`](./zl-continuum-rubric.md).

### 3.3 The one-line doctrine

> **Place the task. Match the loop. Read what the loop cannot prove.**

---

## 4. Domain-heavy work: where agents fail “politely”

### 4.1 Plausible wrongness

Models are fluent. Fluency is the hazard. In PE they will invent:

- Waterfall tiers that “look right” but match no LPA  
- IC processes that mirror blog posts, not your fund  
- Portfolio KPI taxonomies that ignore how ops actually closes books  

In banking/insurance they will invent:

- Ledger postings that violate product accounting  
- Claims states that skip regulatory notice periods  
- KYC steps that sound complete and are not  

Green tests on the wrong product = **faster path to production liability**.

### 4.2 Separate three kinds of knowledge

| Knowledge | Who owns it | Agent role |
|-----------|-------------|------------|
| **Domain policy** (what the business *is*) | SME / product / legal | Draft only after human freeze; never invent |
| **Ubiquitous language** (what words mean here) | SME + engineering | Seed glossary; enforce vocabulary checks |
| **Technical realization** (how we build it) | Engineering + agents | Primary generation under contracts |

If you skip the first two, BRD → epic → story generation becomes **fiction generation**.

### 4.3 Practical mitigations (that actually work)

1. **Human-owned BRD gate** for vertical products. Agents interview and draft; humans **accept or reject**. Do not auto-accept.  
2. **Frozen glossary / CONTEXT.md** before `/spec`. Terms like *MOIC*, *NAV*, *cedant*, *IBNR* mean *your* definitions.  
3. **Vertical packs** (skills + glossary seeders) when available—PE packs, FSI skills—then **project-specific** overlays.  
4. **Acceptance tests written in business language** against ports/adapters *before* implementation (see harness discipline: writing acceptance tests first).  
5. **Domain reviewer on planning artifacts**, not only on code PR. Catching a wrong epic is 50× cheaper than catching a wrong ledger.  
6. Prefer pure-tech agent autonomy for **document intelligence, parsers, UI chrome, infra, test scaffolding**; keep domain rules on the **Z** side until encoded as explicit fixtures and golden cases.

### 4.4 When pure technical *is* the sweet spot

Document intelligence, OCR/classification pipelines, RAG over *your* corpus with eval sets, internal tools with no regulatory semantics, greenfield CRUD with clear schemas—these are **high agent leverage** because:

- “Done” is observable (F1, latency, contract tests).  
- Wrongness is less likely to be *business-law* wrong.  
- Models have dense pretraining on similar code.

Use that asymmetry: **spend human domain time where models are weak; spend agent tokens where models are strong.**

---

## 5. Harness engineering: the missing middle between Z and L

### 5.1 What a harness is

A harness is not “more prompts.” It is the **control plane** around agents:

- **Lanes** that match risk (`/vibe` vs `/change` vs `/feature` vs `/build` → `/auto`)  
- **Contracts** (sprint contracts, API schemas, acceptance criteria)  
- **Generator ≠ evaluator** (reduce self-grading bias)  
- **Ratchets** (quality does not go backwards without explicit waiver)  
- **Deterministic sensors** (lint, tests, vocabulary checks, security path triggers)  
- **Human gates** on planning where ceremony is load-bearing  
- **State + session chaining** so long work survives context windows  

Latent Space’s harness engineering conversations and commercial scaffolds (including this repo’s Claude Harness Engine) share the same idea: **when generation is cheap, verification and routing become the product.**

### 5.2 Why harnesses still get abused

A harness makes agents *more* capable. Without norms, engineers route **non-coding work** into the coding agent (dashboards, email, ticket grooming) because the chat window is sticky. Fix with **explicit scope policy** (Section 7), not by removing the harness.

### 5.3 Map Z/L bands to harness lanes (example)

| Band | Typical lane | Human must |
|------|--------------|------------|
| L | `/vibe` or disposable artifact lanes | Confirm scope + green targeted proof |
| M | `/change`, `/refactor`, single-story `/feature` | Own AC; read walkthrough + critical hunks |
| Z | `/spec`→`/design`→`/auto` or full `/build` + `/gate` | Own BRD/design; line-read risk surface; whole-branch review |

**Never:** “Models got better, so we skip the gate.” Ceremony may trim; **evaluator + deterministic gates must not.**

### 5.4 Large agentic loops: what Bun taught the field (2026)

Jarred Sumner’s write-up of [rewriting Bun in Rust with Claude Code](https://bun.com/blog/bun-in-rust) is a control-plane case study, not a “prompt harder” story. The durable practices:

| Practice | Why it matters | Product translation (this harness, 2.2–2.4) |
|----------|----------------|-----------------------------------------------|
| **Prep map before bulk codegen** | Shared pattern→pattern map beats N agents inventing N ports | `/refactor --mechanical` + `specs/migrate/MAPPING.md` |
| **Canary before fan-out** | 3 files fail cheaply; 1,400 files fail expensively | G32 + implement/feature canary story |
| **1 implementer · ≥2 adversarial reviewers** | Writer bias; “compiles clean” is not correct | Tiered dual `code-reviewer` (`review-tier.js`, union merge) |
| **Tool errors as a work queue** | Shard `cargo check` / tsc walls; no suite thrash mid-shard | `diagnostics-shard.js` + `fix-from-diagnostics` / `/fix-diagnostics` |
| **Fix the process, not only the tree** | Stash races, stub-to-green, suite thrash → rule edits | `.claude/state/process-rules.md` + workflow exemplar |
| **Language-independent oracle** | Port cannot redefine green | Sprint contracts, AT-first, G31 no test deletion |
| **Semantic divergence** | Same shape ≠ same semantics (`debug_assert!`, Drop vs defer) | `semantic-divergence.md` lens on mechanical ports |

**What not to copy as product default:** 64 concurrent agents for days, always-on dual review for one-line fixes, core fuzz farms, or cgroup isolation—those are rewrite/ops budgets. Keep dual review **tiered** and merge **human-owned**.

Detail: [`docs/proposals/bun-adversarial-mechanical-loops.md`](./proposals/bun-adversarial-mechanical-loops.md).

### 5.5 Cost is an outcome metric, not a token metric (harness 2.5)

A per-token-cheaper model can be *dearer per shipped outcome* if it spends the saving back in extra evaluator / self-heal cycles. Cognition’s “Making Fable cheaper than Opus” makes the point; the harness answers it by **measuring** model choice rather than guessing:

| Instrument | What it does | Where |
|-----------|--------------|-------|
| **Cost-per-passed-story benchmark** | Σ per-spawn receipts ÷ evaluator-passed stories — cost per *outcome*, not tokens burned | `cost-per-outcome.js` |
| **`fusion` model-tier preset** | “Cheap worker under a smart lead”: Sonnet 5 generator lead, **Haiku 4.5** per-story `implementer` worker, Opus judgment — the only preset where the teammate is cheaper than the lead | `model-tier.js` |
| **A/B harness + verdict rule** | Runs `balanced` vs `fusion` on the same PRD in isolated arms; the cheaper arm wins *only if* its pass-rate holds equal-or-better — cheaper-but-worse is “no clear winner” | `ab-run.js` / `ab-report.js` · [runbook](./fusion-ab-runbook.md) |
| **Lead-turn efficiency signal** | Turns-per-dispatch — surfaces a lead that thrashes instead of delegating, which erases any cheap-worker saving | loop-health |

The same 2.5 wave hardened two other instruments in the same spirit—a sensor or budget lever that never bites is theater:

- **Biting meta-sensor** — loop-health flags commit gates that have *never fired* or *never blocked*, so dead sensors get retired or fixed instead of scoring points for nothing.
- **Token governor enforced by default** — broad repo reads without a recent context pack are blocked (not merely warned), forcing living-DeepWiki navigation; the security reviewer is diff-scoped so a review no longer greps the whole codebase.

If `fusion` wins on a portfolio, the next step is a **complexity router**: send small/medium stories to the cheap worker, keep auth / schema-migration / low-plan-confidence / ambiguous-AC stories on the stronger one. Same doctrine as Z/L—place the *task*, now including which model tier proves it cheapest per outcome.

---

## 6. The productive sweet spot (your experience, formalized)

Field leaders repeatedly rediscover the same economical human involvement pattern:

```
┌─────────────────┐     ┌─────────────────┐     ┌──────────────────────┐
│ 1. Requirements │     │ 2. Design       │     │ 3. Generation        │
│ HUMAN-OWNED     │ ──► │ HUMAN-LED       │ ──► │ AGENT-LED            │
│ review & freeze │     │ architecture,   │     │ under contracts      │
│ domain truth    │     │ seams, APIs     │     │ + harness ratchets   │
└─────────────────┘     └─────────────────┘     └──────────┬───────────┘
                                                           │
                                                           ▼
                                                ┌──────────────────────┐
                                                │ 4. Verification      │
                                                │ MACHINE + HUMAN      │
                                                │ tests/evals + band-  │
                                                │ appropriate review   │
                                                └──────────────────────┘
```

### 6.1 What “high-level review” means (not blank, not every semicolon)

| Band | Review depth |
|------|----------------|
| L | Skim agent walkthrough; confirm verification commands green |
| M | Read public contracts, migrations, auth edges, high-churn hunks; sample implementation |
| Z | Line-read production risk surface; challenge architecture; independent whole-branch review; domain SME on behavior |

**Anti-patterns**

- Approve 2k-line agent PR on green CI only (**rubber stamp**).  
- Senior retypes leaf copy the agent already proved (**identity Z**).  
- “We’re a vibe team” for auth + money (**identity L**).  
- Discover mid-PR that domain rules were invented → keep shipping to avoid embarrassment (**no backpaddle**).

### 6.2 Backpaddle rule

Mis-placing **too far Z** wastes calendar time (recoverable).  
Mis-placing **too far L** wrecks the codebase or the business (slippery).

As soon as evidence appears (security path, missing tests, invented domain rule, uncovered god-file):

1. Freeze merges on the branch.  
2. Re-score Z/L.  
3. Escalate lane and verification.  
4. Do not “finish the vibe.”

---

## 7. Organizational playbook

### 7.1 Scope policy: what agents are *for*

Publish a one-pager. Example:

**Agents (Claude Code / Codex / Grok CLI) are for**

- Implementing stories against written acceptance criteria  
- Generating tests, fixtures, adapters, refactors with pure structure commits  
- Debugging with reproduction → isolation → fix under repo tools  
- Brownfield mapping, context packs, mechanical migrations with gates  

**Agents are not for (by default)**

- Being the system of record for work tracking (ADO/Jira/Linear)—use the tracker UI or thin MCP with human intent  
- Inventing regulatory or fund-document truth  
- Approving their own production readiness  
- Replacing on-call judgment during incidents without human ownership  
- Endless chat about dashboards you can open in 3 seconds  

**Rule of thumb:** if the task is *navigation of a human UI you already have*, do it yourself. If the task is *synthesis across many files under a contract*, use the agent.

### 7.2 Role redesign

| Old role emphasis | New role emphasis |
|-------------------|-------------------|
| Typing implementation | **Spec quality, design, placement, review** |
| Knowing every API by heart | Knowing **where wrongness is expensive** |
| Hero debugging | Building **evals, fixtures, sensors** that catch classes of bugs |
| “I merged 10k LOC” | “I routed 10k LOC through the right band and verified the risk surface” |

Juniors need **protected learning reps** (conceptual inquiry mode, own a subsystem end-to-end weekly) so the org does not burn its future oversight capacity for a quarter of velocity.

### 7.3 Metrics that do not lie

Prefer:

- Escape defects by severity and band mis-placement rate  
- % PRs with Z/L score in description  
- Time-to-green *after* human AC freeze (not “time until agent typed something”)  
- **Cost-per-passed-story** (Σ receipts ÷ evaluator-passed stories) — cost per outcome, not tokens burned  
- Domain glossary coverage / vocabulary-check fail rates  
- Review depth compliance on Z-band PRs  
- Incident rate attributable to unread agent code  

Avoid as sole north stars:

- LOC generated  
- % AI-authored lines  
- Tokens burned  

Those measure **generation**, not **value under control**.

### 7.4 Tool-agnostic habits (Claude Code, Codex, Grok CLI, …)

| Habit | Why |
|-------|-----|
| Start from a written micro-contract or story | Prevents free-form invention |
| Prefer repo-native tools (tests, linters, typecheck) over chat claims | Claims are free; green is evidence |
| Separate explore agents (read-only) from write agents | Stops drive-by rewrites |
| Keep CLAUDE.md / AGENTS.md stable mid-run | Prompt-cache + consistent policy |
| Use worktrees / branches per agent stream | Parallelism without thrash |
| Demand a walkthrough artifact for M/Z | Makes human review 5 minutes, not 50 |
| When stuck twice on same error, stop and root-cause | Avoids flailing token loops |

### 7.5 Training curriculum (half-day for every engineer)

1. Z/L placement drill (10 real past PRs).  
2. Live bad BRD from a model → human rewrite.  
3. Skill-formation patterns: force one “conceptual inquiry” task without code gen.  
4. Harness lane picker using the field guide.  
5. Review a deliberately poisoned agent PR (subtle domain bug + green tests).  

---

## 8. End-to-end patterns by product type

### 8.1 Pure technical product (document intelligence, internal platform)

- Lean **L/M**. Heavy agent generation.  
- Invest in eval sets, golden files, latency SLOs.  
- Human gates on architecture and data boundaries, not every file.  
- High autonomy `/auto` is often justified once contracts exist.

### 8.2 Domain-heavy product (PE tools, BFS workflows, insurance)

- Lean **Z** until language and policy freeze.  
- BRD + glossary are **human gates**, non-negotiable.  
- Stories must cite domain sources (policy docs, LPAs, product manuals)—not “model memory.”  
- Acceptance tests in business language first.  
- Agents implement; SMEs co-review behavior, not just engineers co-review style.  
- Prefer smaller epics; re-ground after each vertical slice.

### 8.3 Mixed (common commercial reality)

- Split workstreams: **domain kernel** (Z) vs **tech shell** (L/M).  
- Do not let one agent session own both without separate contracts.  
- Example: “extract fields from PDF” (L) vs “map fields to statutory report lines” (Z).

---

## 9. Failure gallery (name them in retros)

| Name | Description | Fix |
|------|-------------|-----|
| **Agent psychosis** | Trust the model’s confidence over evidence | Band + gate + require proof |
| **Dashboard cosplay** | Agent used as remote control for ADO/Jira/email | Scope policy; use native UIs |
| **Fiction BRD** | Domain product defined by LLM autocomplete | SME freeze + glossary |
| **Green wrong** | Tests encode the wrong product | Round-trip real validators; business AC |
| **Rubber stamp** | LGTM on CI only for M/Z | Walkthrough + risk read |
| **Identity L/Z** | Personality instead of placement | Re-score every task |
| **Skill bankruptcy** | Juniors only delegate | Protected learning modes |
| **FOMAT** | Ship unread because “OpenAI did 1M LOC” | Their harness ≠ yours |
| **No backpaddle** | Mid-flight risk discovered, process unchanged | Freeze, re-band, escalate |
| **Stub-to-green** | Compiles by `todo!` / empty bodies; suite “passes” | Stub-smell + dual review; fix real code |
| **Suite thrash mid-shard** | Full monorepo test between every type-error fix | Diagnostics work queue; suite only when tool-clean |
| **Identity concurrency** | 64 agents because Bun did | Budget caps + tiered review; scale only with oracles |
| **Cheap-worker fallacy** | Swap to a per-token-cheaper model; it burns the saving back in extra evaluator / self-heal cycles | A/B on cost-per-passed-story; adopt only if score holds |

---

## 10. Recommendations (executive summary)

1. **Adopt Z/L placement as team policy**, not vibes. Paste the score on every PR.  
2. **Keep humans on requirements and design** for domain systems; freeze vocabulary before stories.  
3. **Let agents own generation under contracts** with generator/evaluator separation and non-optional machine gates.  
4. **Review at the band depth**—never blank, rarely every leaf line. Independent whole-branch review remains load-bearing for non-trivial work; use **dual adversarial review** when diffs are large or security-sensitive.  
5. **Ban agent-as-default for pure UI navigation tasks** (ADO boards, email, wiki clicks) unless integration is deliberate and cheaper.  
6. **Protect skill formation**: require comprehension modes for juniors on new subsystems; measure debugging competence, not just ship rate.  
7. **Invest in harness quality** (evals, sensors, lanes) proportional to token spend—the bottleneck is verification, not typing.  
8. **Treat pure-tech and domain-heavy portfolios differently** in autonomy settings; do not copy-paste “full auto” from a doc-intel success into an insurance core system.  
9. **For bulk mechanical agent work:** prep map → canary → dual review → diagnostics queue; when agents misbehave, **edit process rules and workflows**, not only product code.

---

## 11. Closing

The question “How much better do models have to get before you’ll stop reading code?” is the wrong unit of analysis. The right unit is **the task**.

- Some tasks already deserve near-Lopopolo autonomy **if** your harness can prove them.  
- Some tasks will deserve Zechner-grade reading **even after** models improve—because wrongness is legal, financial, or existential, and “proof” is incomplete.  
- Domain-heavy commercial software sits systematically further Z on **planning** than pure technical software, even when implementation is agent-led.

**The actual skill of agentic engineering is routing:** place the work, attach the right loop, spend scarce human attention where silent failure is expensive, and refuse the comfort of fluent lies.

That is how teams stay productive with Claude Code, Codex, Grok CLI, and whatever comes next—without confusing **velocity of tokens** for **control of the product**.

---

## References & further reading

### Continuum & industry discourse

- Alex Volkov, *The Zechner–Lopopolo Continuum* (essay + talk): [thursdai.news/zl](https://thursdai.news/zl) · [talk](https://www.youtube.com/watch?v=ZpK5PWX2YRM)  
- Ryan Lopopolo / extreme harness engineering — Latent Space: [Harness Engineering](https://www.latent.space/p/harness-eng)  
- Anthropic Institute, *When AI builds itself* (RSI context; Claude authorship rates): [anthropic.com/institute/recursive-self-improvement](https://www.anthropic.com/institute/recursive-self-improvement)

### Empirical research

- Shen & Tamkin, *How AI Impacts Skill Formation* (arXiv:2601.20245): [arxiv.org/abs/2601.20245](https://arxiv.org/abs/2601.20245) · [Anthropic research summary](https://www.anthropic.com/research/AI-assistance-coding-skills)  
- Liu et al., human–GenAI collaboration performance vs motivation dynamics — *Scientific Reports* (2025): [doi:10.1038/s41598-025-98385-2](https://www.nature.com/articles/s41598-025-98385-2)  
- Related: cognitive offloading / critical thinking surveys (e.g. Gerlich 2025 *Societies*; Microsoft Research critical thinking survey 2025) — treat as supporting context, not sole causal proof

### Large multi-agent case studies

- Jarred Sumner / Bun, *Rewriting Bun in Rust* (Claude Code multi-agent port): [bun.com/blog/bun-in-rust](https://bun.com/blog/bun-in-rust)

### In this repository

- Field guide: [`docs/harness-guide.html`](./harness-guide.html)  
- One-page routing rubric: [`docs/zl-continuum-rubric.md`](./zl-continuum-rubric.md)  
- Bun-inspired dual review & mechanical loops: [`docs/proposals/bun-adversarial-mechanical-loops.md`](./proposals/bun-adversarial-mechanical-loops.md)  
- Out-of-core (fuzz, cgroups): [`docs/proposals/bun-phase-c-out-of-core.md`](./proposals/bun-phase-c-out-of-core.md)  
- Control-system registry: [`HARNESS.md`](../HARNESS.md)  
- Vertical glossary / ubiquitous language direction: [`docs/architecture/vertical-glossary-seeding-generalization.md`](./architecture/vertical-glossary-seeding-generalization.md)

---

## Appendix A — PR description template

```markdown
### Z/L placement
- Score: __ / 12  → band: L / M / Z
- Axes at 2: (list or "none")
- Domain frozen? yes/no (glossary + SME owner)
- Lane: /vibe | /change | /refactor | /feature | /auto | other
- Verification: (commands + pass/fail)
- Human read plan: walkthrough only | contracts+hunks | every risk line + SME
- Backpaddle triggers: (what would force re-band?)
```

## Appendix B — “Should I open the agent?” decision tree

```
Is this primarily navigating a human UI I already have (ADO, email, wiki)?
  YES → Do it yourself (or dedicated integration), don't cosplay with the coding agent.
  NO  ↓

Is the truth of the answer domain policy not yet frozen by an SME?
  YES → Human/SME first; agent may draft under explicit "DRAFT-NOT-POLICY" label only.
  NO  ↓

Can "done" be proved by tests, evals, or schemas you trust?
  YES → Agent-led generation OK; place L/M/Z for review depth.
  NO  → Human-led design/exploration; agent assists with research, not silent merge.

Blast radius auth/money/PII/migration/public API?
  YES → Band Z minimum; full gate; dual review; no vibe.
  NO  → Score remaining axes; match harness lane.

Is this a bulk mechanical transform (port / mass rewrite)?
  YES → Mapping + canary + dual review + diagnostics queue; do not full-auto without an oracle suite.
  NO  → Continue with band lane above.
```

## Appendix C — Interaction modes that preserve skill (from Shen & Tamkin)

Use these names in mentoring:

1. **Conceptual inquiry** — ask why/how; write code yourself.  
2. **Hybrid code-explanation** — generate *with* required explanation; read it.  
3. **Generation-then-comprehension** — generate, then force Q&A until you can debug without the model.  

Discourage as default shipping modes:

4. **AI delegation**  
5. **Progressive reliance**  
6. **Iterative AI debugging** without understanding  

---

*This document is a disposable research/operating narrative for engineering leadership (v1.2 · 2026-07-15 · harness companion 2.5.0). It is not a product runtime artifact and does not go through the generator/evaluator shipping loop. Update it when placement policy, research baselines, or harness control practices change.*
