# LinkedIn Article — ready to paste

**Suggested title:**  
You’re Not Team “Vibe” or Team “Read Every Line.” You’re Routing.

**Subtitle (optional):**  
How to ship commercial software with coding agents—without agent psychosis, fiction BRDs, or rubber-stamp PRs.

**Cover image idea:** Dark slide with continuum bar (L green → M blue → Z red) and the line: *Place the task. Match the loop. Read what the loop cannot prove.*

**Hashtags (end of article or first comment):**  
`#AIEngineering` `#SoftwareEngineering` `#ClaudeCode` `#AgenticAI` `#EngineeringLeadership`

**First comment (after publish):**  
Full white paper (HTML + MD):  
https://github.com/cwijayasundara/claude_harness_eng_v5/blob/main/docs/agentic-engineering-whitepaper.html  

One-page Z/L rubric:  
https://github.com/cwijayasundara/claude_harness_eng_v5/blob/main/docs/zl-continuum-rubric.md  

Slide deck PDF source:  
https://github.com/cwijayasundara/claude_harness_eng_v5/blob/main/docs/linkedin/agentic-engineering-linkedin-deck.html  

---

## Body (paste below)

Coding agents didn’t create an underuse problem.

They created an **overuse** problem.

Hand a strong team Claude Code, Codex, or Grok CLI—plus a harness with lanes, hooks, and evaluators—and something predictable happens. The chat window becomes the default interface for *everything*. Implement the story. Plan the sprint. Open Azure DevOps and “tell me if the board is green.” Invent the private-equity waterfall from memory. Apply the same ceremony to a three-line copy fix and a multi-epic insurance product.

That isn’t a model failure. It’s an **attention and policy** failure. The agent is a powerful hammer. Without norms, everything becomes a nail.

I’ve been rolling coding agents and harnesses into engineering teams. The pattern is consistent: pure technical work (document intelligence, parsers, internal CRUD, test scaffolding) goes well. Domain-heavy work—private equity, banking, insurance—gets expensive the moment we let the model act like a junior product owner.

This is also the argument thrashing the industry right now. At AI Engineer Europe, one keynote energy said code is cheap and review can approach zero under extreme harnesses. Another said slow down and read critical lines. Both got standing ovations. Alex Volkov named the space between them the **Z/L Continuum** (Zechner ↔ Lopopolo).

You’re not permanently Team Z or Team L.  
**Every task** gets a place on the continuum.  
**Placing it correctly is the skill.**

### The thesis in one line

Productivity in agentic engineering is not “use the agent more.”

It is **routing**: which work goes to agents, which stays human, how hard verification must be, and where domain experts must veto plausible-sounding fiction.

> **Place the task. Match the loop. Read what the loop cannot prove.**

### Why domain systems break agents “politely”

Frontier models are excellent at generic software patterns: APIs, React UIs, ETL, infra glue. They are weak at **domain-grounded product definition**.

In PE they invent waterfall tiers that match no LPA, IC processes from blog posts, KPI taxonomies ops doesn’t close to. In banking and insurance they invent ledger postings, claims states, and KYC steps that *sound complete* and aren’t.

That’s the dangerous failure mode: **fluent wrongness**. Green tests on the wrong product are a faster path to production liability—not a productivity win.

So separate three kinds of knowledge:

1. **Domain policy** — what the business *is* → SME / product / legal owns it  
2. **Ubiquitous language** — what words mean *here* → freeze a glossary before stories  
3. **Technical realization** — how we build it → agents generate under contracts  

Skip the first two and BRD → epic → story generation is just **fiction generation**.

Document intelligence can sit further toward automation. Fund rules and statutory mappings sit further toward human ownership of planning—even when agents write most of the code.

### Research that should change how you mentor juniors

This isn’t only philosophy. Anthropic’s RCT (*How AI Impacts Skill Formation*, Shen & Tamkin, arXiv:2601.20245) had developers learn an unfamiliar library with or without AI assistance.

Headline: the AI group scored about **17 percentage points lower** on a post-task quiz. The worst gaps were on **debugging**—exactly the skill you need to supervise AI-written code. Speed gains were small and not statistically significant in that learning setting; people spent a surprising amount of time *prompting*.

How people used AI mattered more than whether they used it:

- **Bad shipping defaults:** full delegation, progressive handoff, “fix it for me” loops without understanding  
- **Skill-preserving modes:** conceptual inquiry; generate *with* explanation; generate then force comprehension  

If juniors only delegate, you buy a quarter of velocity with the org’s future oversight capacity.

Broader work on cognitive offloading points the same way: unguided GenAI boosts immediate output and often reduces ownership and transfer. Structured engagement—contracts, not vibes—helps.

Frontier labs themselves still describe the human job as **direct and review**, even when AI authors a large share of merged lines. Humans moved up the stack. Design that on purpose, or it happens accidentally and poorly.

### Harness engineering is the missing middle

When generation is cheap, **verification and routing become the product**.

A harness is not “more prompts.” It’s the control plane: risk-matched lanes, contracts, generator ≠ evaluator, ratchets, deterministic sensors, human gates where ceremony is load-bearing, state that survives context windows.

But a better harness makes overuse easier. Without a scope policy, people still use the coding agent as a remote control for dashboards and email. Don’t remove the harness—**publish what agents are for**.

**Agents are for:** implementing stories against acceptance criteria; tests and fixtures; reproduce → isolate → fix; brownfield maps; mechanical migrations under gates.

**Agents are not for (by default):** being the system of record for ADO/Jira; inventing regulatory truth; approving their own readiness; replacing on-call judgment; endless chat about UIs you can open in three seconds.

Rule of thumb: navigation of a human UI you already have → do it yourself. Synthesis across many files under a contract → use the agent.

### The productive sweet spot

The economical pattern keeps reappearing in real teams:

1. **Requirements** — human-owned; freeze domain truth  
2. **Design** — human-led; architecture, seams, APIs  
3. **Generation** — agent-led under contracts and ratchets  
4. **Verification** — machines prove what is cheap to prove; humans read at **band depth**

“High-level review” is not blank and not every semicolon:

- **L (low risk):** walkthrough skim + green targeted proof  
- **M:** contracts, auth/migration edges, high-churn hunks  
- **Z:** risk surface line-read, architecture challenge, independent whole-branch review, SME on behavior  

Mis-placing too far Z wastes calendar. Mis-placing too far L wrecks codebases and businesses. When evidence appears mid-flight—security path, invented domain rule, uncovered god-file—**backpaddle**: freeze, re-score, escalate. Don’t “finish the vibe.”

### Eight practices that actually work

1. Put a **Z/L score on every PR**—policy, not personality.  
2. **Humans own BRD and design** for vertical systems; freeze vocabulary before `/spec`-style decomposition.  
3. Agents generate under **contracts**; keep evaluator and deterministic gates non-optional.  
4. Review at **band depth**; never rubber-stamp M/Z on CI alone.  
5. **Ban agent-as-default** for pure UI navigation unless the integration is deliberate and cheaper.  
6. **Protect skill formation**—comprehension modes for juniors on new subsystems.  
7. Invest in **harness quality** proportional to token spend.  
8. **Don’t copy-paste full-auto** from a doc-intel win into an insurance core system.

### Name the failure modes in retros

Agent psychosis. Dashboard cosplay. Fiction BRD. Green wrong. Rubber stamp. Identity L/Z. Skill bankruptcy. FOMAT (“ship unread because OpenAI did a million lines”). No backpaddle.

If you can name them, you can fix them.

### Closing

“How much better do models have to get before you’ll stop reading code?” is the wrong unit of analysis.

The right unit is **the task**.

Some tasks already deserve near-full agent autonomy *if* your harness can prove them. Some will deserve careful human reading even after models improve—because wrongness is legal, financial, or existential, and proof is incomplete. Domain-heavy commercial software sits systematically further toward human ownership of **planning**, even when implementation is agent-led.

The actual skill of agentic engineering is routing: place the work, attach the right loop, spend scarce human attention where silent failure is expensive, and refuse the comfort of fluent lies.

That’s how you stay productive with Claude Code, Codex, Grok CLI, and whatever comes next—without confusing **velocity of tokens** for **control of the product**.

---

*Full white paper and Z/L one-pager are in the open harness repo (link in comments). Views mine; cite Volkov’s Z/L continuum, Shen & Tamkin on skill formation, and the broader harness-engineering conversation if you build on this.*
