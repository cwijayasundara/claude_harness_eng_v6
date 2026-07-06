# Tech-Stack Specialty Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a harness-owned, locally-bundled tech-stack specialty pack (`langgraph-code`, `langchain-code`, `deepagents-code`) grounded in real official documentation, register it in a new declarative `framework-skill-packs.json` registry alongside the two existing external packs, and give `scaffold-copy.js` a new copy path so `/scaffold` can bundle these skills directly into a project — no external repo install required.

**Architecture:** `.claude/config/framework-skill-packs.json` holds one entry per tech-stack pack, with a `source` field (`"local"` for this new bundled pack, `"github"` for the two existing external ones — migrated verbatim, unchanged behavior). `install-framework-packs/SKILL.md` reads this file instead of its hardcoded prose table. `scaffold-copy.js` gains `copyFrameworkPackSkills()`, called from `applyScaffold()` right after the existing `copyScaffoldTree()` call, which copies a `"source":"local"` pack's named skill directories into the target project — the same directory-copy mechanism `CORE_SKILLS` already uses, just conditional on the project's chosen `framework_skill_packs` instead of universal. The three new skills follow this repo's existing progressive-disclosure convention (`SKILL.md` + `references/*.md`, same shape as `.claude/skills/design/references/`), with content grounded in official LangGraph/LangChain/DeepAgents documentation fetched during Tasks 3-5, each reference file citing its source URL.

**Tech Stack:** Node.js (`node:test`, `fs`, `path`) for the registry/copy mechanism; Markdown (`SKILL.md` + `references/*.md`) for the new skill content.

## Global Constraints

- No new runtime dependencies.
- The two existing external pack entries (`langchain` → `cwijayasundara/agent_cli_langchain`, `google-adk` → `google/agents-cli`) must migrate into the new registry **verbatim** — same repo, prefix, expected-skill-count values as today's `install-framework-packs/SKILL.md` prose table — with **no change** to `install-framework-packs`' existing INSTALLED/PARTIAL/MISSING behavior for either.
- The new local pack's skill directories are copied by `scaffold-copy.js` **only** when a project's `project-manifest.json#framework_skill_packs` includes the local pack's key — never unconditionally, and never for the `"source":"github"` entries (those remain manual-install-only, unchanged).
- Every new `.claude/skills/*/SKILL.md` and `references/*.md` file must cite the real source URL(s) its content is grounded in — no invented facts, no uncited claims about LangGraph/LangChain/DeepAgents behavior.
- Content authored in Tasks 3-5 must be fetched fresh from the cited URLs during implementation (via `WebFetch` or equivalent), not reproduced from training-data memory — these are 2026-era, fast-moving products; verify current behavior at implementation time.

---

### Task 1: `framework-skill-packs.json` registry + `install-framework-packs` reads it

**Files:**
- Create: `.claude/config/framework-skill-packs.json`
- Modify: `.claude/skills/install-framework-packs/SKILL.md`
- Test: `test/framework-skill-packs.test.js`

**Interfaces:**
- Produces: registry shape `{ "packs": [{ "key": string, "source": "local"|"github", "repo"?: string, "prefix"?: string, "expected_skills"?: number, "skills"?: string[] }] }` — `"source":"github"` entries have `repo`/`prefix`/`expected_skills`; `"source":"local"` entries have `skills` (the list of `.claude/skills/<name>` directories to copy).

- [ ] **Step 1: Write the failing test**

Create `test/framework-skill-packs.test.js`:

```javascript
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const REGISTRY_PATH = path.join(__dirname, '..', '.claude', 'config', 'framework-skill-packs.json');

test('framework-skill-packs.json registers the local python-ai-agents pack and both existing external packs', () => {
  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  assert.ok(Array.isArray(registry.packs));

  const local = registry.packs.find((p) => p.key === 'python-ai-agents');
  assert.ok(local, 'expected a python-ai-agents entry');
  assert.strictEqual(local.source, 'local');
  assert.deepStrictEqual(local.skills.sort(), ['deepagents-code', 'langchain-code', 'langgraph-code'].sort());

  const langchain = registry.packs.find((p) => p.key === 'langchain');
  assert.ok(langchain, 'expected the existing langchain entry to survive migration');
  assert.strictEqual(langchain.source, 'github');
  assert.strictEqual(langchain.repo, 'cwijayasundara/agent_cli_langchain');
  assert.strictEqual(langchain.prefix, 'langchain-agents-');
  assert.strictEqual(langchain.expected_skills, 9);

  const googleAdk = registry.packs.find((p) => p.key === 'google-adk');
  assert.ok(googleAdk, 'expected the existing google-adk entry to survive migration');
  assert.strictEqual(googleAdk.source, 'github');
  assert.strictEqual(googleAdk.repo, 'google/agents-cli');
  assert.strictEqual(googleAdk.prefix, 'google-agents-cli-');
  assert.strictEqual(googleAdk.expected_skills, 7);
});

test('install-framework-packs/SKILL.md references the registry file instead of a hardcoded table', () => {
  const skill = fs.readFileSync(
    path.join(__dirname, '..', '.claude', 'skills', 'install-framework-packs', 'SKILL.md'), 'utf8'
  );
  assert.match(skill, /framework-skill-packs\.json/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/framework-skill-packs.test.js`
Expected: FAIL — `.claude/config/framework-skill-packs.json` does not exist yet

- [ ] **Step 3: Create the registry file**

Create `.claude/config/framework-skill-packs.json`:

```json
{
  "packs": [
    {
      "key": "python-ai-agents",
      "source": "local",
      "skills": ["langgraph-code", "langchain-code", "deepagents-code"]
    },
    {
      "key": "langchain",
      "source": "github",
      "repo": "cwijayasundara/agent_cli_langchain",
      "prefix": "langchain-agents-",
      "expected_skills": 9
    },
    {
      "key": "google-adk",
      "source": "github",
      "repo": "google/agents-cli",
      "prefix": "google-agents-cli-",
      "expected_skills": 7
    }
  ]
}
```

- [ ] **Step 4: Update `install-framework-packs/SKILL.md` to read the registry**

In `.claude/skills/install-framework-packs/SKILL.md`, replace the existing `## Pack registry` section (the markdown table listing `langchain`/`google-adk` with columns Manifest key/Repository/Prefix/Expected skills, and the note "If `framework_skill_packs` contains a key not in this registry, report it as unknown and skip — do not invent install commands.") with:

```markdown
## Pack registry

Read `.claude/config/framework-skill-packs.json` for the current registry. Each `"source":"github"` entry has `repo`, `prefix`, and `expected_skills` — use these exactly as today's hardcoded table did. `"source":"local"` entries (e.g. `python-ai-agents`) are bundled directly in this harness and copied by `/scaffold` itself — they need no install-status check here and never appear in this skill's MISSING/PARTIAL/PENDING reporting.

If `framework_skill_packs` contains a key not present in the registry, report it as unknown and skip — do not invent install commands.
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/framework-skill-packs.test.js`
Expected: PASS (2 tests)

- [ ] **Step 6: Run the existing install-framework-packs regression check**

Run: `npm test`
Expected: all tests pass — confirms this rewording didn't break any existing assertion about `install-framework-packs/SKILL.md`'s content (there is no such test today per this repo's `test/` directory, but the full suite is the safety net for any indirect reference).

- [ ] **Step 7: Commit**

```bash
git add .claude/config/framework-skill-packs.json .claude/skills/install-framework-packs/SKILL.md test/framework-skill-packs.test.js
git commit -m "feat: add framework-skill-packs registry, generalize install-framework-packs to read it"
```

---

### Task 2: `scaffold-copy.js` local-pack copy path

**Files:**
- Modify: `.claude/scripts/scaffold-copy.js`
- Modify: `.claude/scripts/scaffold-apply.js:239` (call the new function right after `copyScaffoldTree`)
- Test: `test/framework-skill-packs.test.js` (append)

**Interfaces:**
- Consumes: registry shape from Task 1 (`{ packs: [{ key, source, skills? }] }`).
- Produces: `copyFrameworkPackSkills(pluginSource: string, target: string, frameworkSkillPacks: string[]): void` — exported from `scaffold-copy.js` alongside the existing `copyScaffoldTree`, `pruneSettings`, `resolveScaffoldProfile`.

- [ ] **Step 1: Write the failing test**

Append to `test/framework-skill-packs.test.js`:

```javascript
const os = require('os');
const { copyFrameworkPackSkills } = require(
  path.join(__dirname, '..', '.claude', 'scripts', 'scaffold-copy.js')
);

function mkHarnessFixture() {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-src-'));
  fs.mkdirSync(path.join(src, '.claude', 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(src, '.claude', 'config', 'framework-skill-packs.json'),
    JSON.stringify({
      packs: [
        { key: 'python-ai-agents', source: 'local', skills: ['langgraph-code', 'langchain-code'] },
        { key: 'langchain', source: 'github', repo: 'cwijayasundara/agent_cli_langchain', prefix: 'langchain-agents-', expected_skills: 9 },
      ],
    }, null, 2)
  );
  for (const skillName of ['langgraph-code', 'langchain-code']) {
    const dir = path.join(src, '.claude', 'skills', skillName);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${skillName}\ndescription: test\n---\n`);
  }
  return src;
}

test('copyFrameworkPackSkills copies a local pack\'s skill directories when selected', () => {
  const src = mkHarnessFixture();
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'target-'));
  copyFrameworkPackSkills(src, target, ['python-ai-agents']);
  assert.strictEqual(fs.existsSync(path.join(target, '.claude', 'skills', 'langgraph-code', 'SKILL.md')), true);
  assert.strictEqual(fs.existsSync(path.join(target, '.claude', 'skills', 'langchain-code', 'SKILL.md')), true);
});

test('copyFrameworkPackSkills does nothing for a github-source pack (external, manual install)', () => {
  const src = mkHarnessFixture();
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'target-'));
  copyFrameworkPackSkills(src, target, ['langchain']);
  assert.strictEqual(fs.existsSync(path.join(target, '.claude', 'skills', 'langgraph-code')), false);
});

test('copyFrameworkPackSkills does nothing when frameworkSkillPacks is empty or undefined', () => {
  const src = mkHarnessFixture();
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'target-'));
  copyFrameworkPackSkills(src, target, []);
  copyFrameworkPackSkills(src, target, undefined);
  assert.strictEqual(fs.existsSync(path.join(target, '.claude', 'skills')), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/framework-skill-packs.test.js`
Expected: FAIL — `copyFrameworkPackSkills` is not exported from `scaffold-copy.js` yet

- [ ] **Step 3: Write the implementation**

In `.claude/scripts/scaffold-copy.js`, add this function directly above the existing `module.exports = { copyScaffoldTree, pruneSettings, resolveScaffoldProfile };` line:

```javascript
// Copy a locally-bundled framework-skill-pack's skills into <target>/.claude/skills,
// per project-manifest.json#framework_skill_packs (Expert-Generalist scaffold
// composition, docs/superpowers/specs/2026-07-06-expert-generalist-scaffold-composition-design.md).
// "source":"github" packs (langchain, google-adk) are untouched here — those stay
// manual-install-only via install-framework-packs, as today.
function copyFrameworkPackSkills(pluginSource, target, frameworkSkillPacks) {
  const registryPath = path.join(pluginSource, '.claude', 'config', 'framework-skill-packs.json');
  if (!fs.existsSync(registryPath) || !Array.isArray(frameworkSkillPacks) || frameworkSkillPacks.length === 0) return;
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  for (const key of frameworkSkillPacks) {
    const entry = registry.packs.find((p) => p.key === key);
    if (!entry || entry.source !== 'local') continue;
    copyNamedFiles(path.join(pluginSource, '.claude', 'skills'), path.join(target, '.claude', 'skills'), entry.skills);
  }
}
```

Then update the `module.exports` line to:

```javascript
module.exports = { copyScaffoldTree, pruneSettings, resolveScaffoldProfile, copyFrameworkPackSkills };
```

In `.claude/scripts/scaffold-apply.js`, add the import and the call. Change line 53 from:

```javascript
const { copyScaffoldTree, pruneSettings, resolveScaffoldProfile } = require('./scaffold-copy');
```

to:

```javascript
const { copyScaffoldTree, pruneSettings, resolveScaffoldProfile, copyFrameworkPackSkills } = require('./scaffold-copy');
```

Then, immediately after line 239's `copyScaffoldTree(pluginSource, target, scaffoldProfile);` (inside `applyScaffold`), add:

```javascript
  copyFrameworkPackSkills(pluginSource, target, profile.frameworkPacks);
```

**Note the field name:** the input `profile` object (parsed from the `--profile` JSON, built by the `/scaffold` conversation) uses camelCase `frameworkPacks` — this is the same field `scaffold-render.js:121` reads (`if (Array.isArray(profile.frameworkPacks) && profile.frameworkPacks.length) { manifest.framework_skill_packs = profile.frameworkPacks; }`) when it writes the OUTPUT `project-manifest.json`'s snake_case `framework_skill_packs` field. Do not write `profile.framework_skill_packs` here — that field does not exist on the input profile, only on the rendered manifest.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/framework-skill-packs.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Run the full suite to confirm `scaffold-apply.js`'s existing behavior is unchanged**

Run: `npm test`
Expected: all tests pass, including any existing `scaffold-apply`/e2e scaffold tests — `copyFrameworkPackSkills` is a no-op today since no real project's `profile.frameworkPacks` will name `python-ai-agents` until Task 3-5's skills exist and a project actually selects it.

- [ ] **Step 6: Commit**

```bash
git add .claude/scripts/scaffold-copy.js .claude/scripts/scaffold-apply.js test/framework-skill-packs.test.js
git commit -m "feat: copy locally-bundled framework-pack skills during scaffold apply"
```

---

### Task 3: `langgraph-code` skill

**Files:**
- Create: `.claude/skills/langgraph-code/SKILL.md`
- Create: `.claude/skills/langgraph-code/references/graph-api.md`
- Create: `.claude/skills/langgraph-code/references/persistence-and-checkpointing.md`
- Test: `test/framework-skill-packs.test.js` (append wiring assertions)

**Interfaces:**
- Produces: a skill directory matching the shape `copyFrameworkPackSkills` (Task 2) expects — `SKILL.md` with YAML frontmatter (`name`, `description`) plus a `references/` subdirectory.

**Sourcing for this task:** `https://langchain-ai.github.io/langgraph/llms.txt` indexes ~13 real pages under `docs.langchain.com/oss/python/langgraph/*` plus one API reference and one platform page. This task writes `SKILL.md` plus the two reference files most load-bearing for a senior engineer (graph construction, persistence/checkpointing/human-in-the-loop) using content already fetched and verified this session from `https://docs.langchain.com/oss/python/langgraph/graph-api` and `https://docs.langchain.com/oss/python/langgraph/persistence`. Three more pages remain unfetched (`streaming`, `add-memory`, `use-subgraphs`, `observability`, `common-errors`, `workflows-agents`) — Step 4 below fetches and folds the most important of these (`add-memory`, for short vs. long-term memory patterns) into the persistence reference file; the rest are named as follow-up candidates in the skill's own Gotchas section rather than invented.

- [ ] **Step 1: Write the failing wiring test**

Append to `test/framework-skill-packs.test.js`:

```javascript
test('langgraph-code skill exists with correct frontmatter and reference files', () => {
  const skillDir = path.join(__dirname, '..', '.claude', 'skills', 'langgraph-code');
  const skill = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: langgraph-code\n/);
  assert.match(skill, /LangGraph/);
  assert.strictEqual(fs.existsSync(path.join(skillDir, 'references', 'graph-api.md')), true);
  assert.strictEqual(fs.existsSync(path.join(skillDir, 'references', 'persistence-and-checkpointing.md')), true);
  const graphApi = fs.readFileSync(path.join(skillDir, 'references', 'graph-api.md'), 'utf8');
  assert.match(graphApi, /docs\.langchain\.com\/oss\/python\/langgraph\/graph-api/);
  const persistence = fs.readFileSync(path.join(skillDir, 'references', 'persistence-and-checkpointing.md'), 'utf8');
  assert.match(persistence, /docs\.langchain\.com\/oss\/python\/langgraph\/persistence/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/framework-skill-packs.test.js`
Expected: FAIL — `.claude/skills/langgraph-code/SKILL.md` does not exist

- [ ] **Step 3: Write `SKILL.md`**

Create `.claude/skills/langgraph-code/SKILL.md`:

```markdown
---
name: langgraph-code
description: Build stateful, multi-actor LangGraph agents in Python — StateGraph definition, conditional routing, checkpointing/persistence, and human-in-the-loop interrupts. Use when a task needs explicit multi-step control flow, crash/interrupt recovery, or approval gates — not for a single-turn prompt or a simple tool-calling loop (use langchain-code's create_agent for that). Triggers on "LangGraph", "state graph", "stateful agent", "multi-step agent workflow", "checkpointing", "resume from crash", "human in the loop agent".
---

# LangGraph

Source: https://langchain-ai.github.io/langgraph/llms.txt (this harness's index into the official docs — fetch and re-verify against it if this content seems stale; LangGraph moves fast).

## When to Reach for LangGraph

LangGraph models an agent as an explicit state machine — nodes and edges over a typed state object — rather than a linear chain of prompts. Reach for it when the task needs: multi-step control flow with branching, durable state that survives a crash or process restart, or a point where a human must approve/edit before the agent continues. For a simpler single-agent tool-calling loop with no explicit state machine, `langchain-code`'s `create_agent` is the right level of abstraction instead — read that skill first if you're unsure LangGraph's added control is actually needed.

## Core Workflow

1. Define state as a `TypedDict` (or dataclass/Pydantic model) — see `references/graph-api.md`.
2. Add nodes (plain functions that take state, return partial updates) and edges (static or conditional) — see `references/graph-api.md`.
3. Compile the graph — **must** call `.compile()` before it's runnable.
4. If the graph needs to survive a restart, resume mid-conversation, or pause for human approval: compile with a checkpointer and always pass a `thread_id` — see `references/persistence-and-checkpointing.md`. This is opt-in, not automatic — a graph compiled without a checkpointer has no persistence at all.

## Gotchas (do not skip)

- **Checkpointing is not automatic.** You must explicitly pass a `checkpointer` to `.compile()` and a `thread_id` in every invocation's config. A graph with neither has zero crash-resume capability.
- **`InMemorySaver` does not persist across process restarts** — development-only. Use `PostgresSaver` (or another durable backend) for anything that must survive a real crash.
- **Node re-execution on resume**: when resuming from a checkpoint, LangGraph re-runs the interrupted node from its start, not from where it left off mid-function. Design node bodies to be idempotent (safe to re-run) — do not put a side effect like "send an email" directly in a node body without a guard.
- **Don't mix static and conditional edges from the same node.** If a node has both a plain `add_edge` and a `add_conditional_edges` targeting it, both paths fire — pick one routing style per node.
- **State updates overwrite by default.** If a state field should accumulate (e.g. a running message list) rather than replace, it needs an explicit reducer via `Annotated[list[X], operator.add]` (or LangGraph's `add_messages` for chat history) — without one, each node's return value replaces the field wholesale.

## Not Yet Covered Here (fetch before relying on these topics)

This skill's reference files cover graph construction and persistence/checkpointing in depth. The following official pages exist in the llms.txt index but have not yet been fetched into a reference file — fetch the relevant one before advising on these topics, don't guess: streaming (`.../langgraph/streaming`), subgraph composition (`.../langgraph/use-subgraphs`), observability/tracing (`.../langgraph/observability`), common error troubleshooting (`.../langgraph/common-errors`), and the dedicated workflows-vs-agents framing (`.../langgraph/workflows-agents`).
```

- [ ] **Step 4: Write `references/graph-api.md`**

Create `.claude/skills/langgraph-code/references/graph-api.md`:

```markdown
# Graph API — StateGraph, Nodes, Edges, Conditional Routing

Source: https://docs.langchain.com/oss/python/langgraph/graph-api (fetched 2026-07-06 — re-verify if this content seems stale)

## Defining State

State is defined with `TypedDict` (recommended default), a `dataclass` (when you need field defaults), or a Pydantic `BaseModel`:

```python
from typing_extensions import TypedDict

class State(TypedDict):
    user_input: str
    results: str
```

Dataclass form, for default values:

```python
from dataclasses import dataclass

@dataclass
class State:
    user_input: str
    results: str = ""
```

## Nodes

A node is a plain function receiving the current state and returning a **partial update** (not the full state):

```python
def process_node(state: State):
    return {"results": f"Processed: {state['user_input']}"}
```

## Building and Connecting the Graph

```python
from langgraph.graph import StateGraph, START, END

builder = StateGraph(State)
builder.add_node("process", process_node)
builder.add_edge(START, "process")
builder.add_edge("process", END)
```

## Conditional Routing

Use `add_conditional_edges` when the next node depends on state. The router function returns either a node name directly, or a key that gets mapped to a node name via an optional dict:

```python
def router(state: State):
    return "node_b" if state["results"] else "node_c"

builder.add_conditional_edges("process", router)

# Or, mapping router return values explicitly to node names:
builder.add_conditional_edges("process", router, {True: "node_b", False: "node_c"})
```

**Do not attach both a static `add_edge` and a conditional `add_conditional_edges` from the same source node** — both paths will fire.

## Reducers — Controlling How State Updates Combine

Without a reducer, a node's returned value for a field **replaces** the existing value. To accumulate instead (e.g. an append-only message list), annotate the field with a reducer function:

```python
from typing import Annotated
from operator import add

class State(TypedDict):
    messages: Annotated[list[str], add]  # each node's return value is appended, not overwritten
```

LangGraph's own `add_messages` reducer (for chat history) additionally deserializes plain dicts into LangChain `Message` objects automatically, so downstream code can use dot-notation attribute access rather than dict keys.

## Compiling

**The graph will not run until compiled:**

```python
graph = builder.compile()
# With persistence (see references/persistence-and-checkpointing.md):
graph = builder.compile(checkpointer=checkpointer)
```

## Gotchas

- Must call `.compile()` — an uncompiled `StateGraph` builder object is not invokable.
- Resuming from a checkpoint re-executes the interrupted node from its start — write nodes to be idempotent.
- Don't combine static and conditional edges from one source node.
- Private/internal state channels remain visible during `.stream()` even though `.invoke()` hides them from the final result — use the `output_keys` parameter to restrict what a caller sees if this matters.
```

- [ ] **Step 5: Write `references/persistence-and-checkpointing.md`**

Create `.claude/skills/langgraph-code/references/persistence-and-checkpointing.md`:

```markdown
# Persistence, Checkpointing, and Human-in-the-Loop

Source: https://docs.langchain.com/oss/python/langgraph/persistence (fetched 2026-07-06 — re-verify if this content seems stale)

## What Checkpointers Do

A checkpointer persists a thread's graph state as checkpoints, enabling: conversation continuity across separate invocations, human-in-the-loop workflows (pause, inspect, resume), time travel (replay from an earlier checkpoint), and fault tolerance (resume after a crash).

## In-Memory (Development Only)

```python
from langgraph.checkpoint.memory import InMemorySaver

checkpointer = InMemorySaver()
graph = builder.compile(checkpointer=checkpointer)
```

**`InMemorySaver` does not persist between process restarts** — RAM-only, fine for local development and tests, never for anything that must survive a real crash.

## Durable, Database-Backed

```python
from langgraph.checkpoint.postgres import PostgresSaver

checkpointer = PostgresSaver.from_conn_string("postgresql://...")
checkpointer.setup()  # creates the required tables/indexes — run once
graph = builder.compile(checkpointer=checkpointer)
```

SQLite has an equivalent saver for lighter-weight durable deployments.

## `thread_id` Is Required for Persistence to Do Anything

```python
result = graph.invoke(
    {"messages": [{"role": "user", "content": "Hi, my name is Bob."}]},
    {"configurable": {"thread_id": "thread-1"}},
)
```

Every invocation must pass a `thread_id` in `config`. The same `thread_id` on a later call resumes from that thread's last checkpoint automatically — this is the entire mechanism, there is no separate "resume" API to call.

**Gotcha — `PostgresSaver` thread IDs are capped at 255 characters.** For long/generated identifiers, hash or truncate:

```python
import uuid
config = {"configurable": {"thread_id": str(uuid.uuid4())[:255]}}
```

## Crash Recovery

After a crash, simply re-invoke the graph with the same `thread_id` — it resumes from the last checkpoint automatically. There is no explicit "recover" call; recovery is just a normal invocation with a matching `thread_id`.

## Storage Gotchas

- **Unbounded checkpoint growth**: long-running threads accumulate checkpoints indefinitely, increasing storage and read latency over time. Plan a retention/pruning policy for production use — this is not handled automatically.
- **Subgraph checkpoint isolation**: a parent graph does not automatically see a child (sub)graph's state updates, because each subgraph gets its own checkpoint namespace. Use LangGraph's separate `Store` layer (not the per-thread checkpointer) for state that must cross that boundary.

## Human-in-the-Loop (ties directly to persistence — do not treat as a separate mechanism)

A checkpointer is the prerequisite for human-in-the-loop workflows: pausing a graph mid-execution for human review requires the state to be durably saved at that pause point so the graph can later resume exactly where it left off, potentially in a different process. Configure a checkpointer (as above) before relying on any pause/approve/resume flow — without one, "pausing for approval" has nothing to resume from.
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test test/framework-skill-packs.test.js`
Expected: PASS (6 tests)

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/langgraph-code test/framework-skill-packs.test.js
git commit -m "feat: add langgraph-code skill (graph API + persistence/checkpointing)"
```

---

### Task 4: `langchain-code` skill

**Files:**
- Create: `.claude/skills/langchain-code/SKILL.md`
- Create: `.claude/skills/langchain-code/references/agents.md`
- Create: `.claude/skills/langchain-code/references/models.md`
- Test: `test/framework-skill-packs.test.js` (append wiring assertions)

**Sourcing for this task:** `https://docs.langchain.com/llms.txt` (the full docs.langchain.com index) is ~2000+ links, almost entirely LangSmith/Agent-Server/Fleet/REST-API surface unrelated to the core OSS Python library — do not attempt to index it wholesale. The core library's own conceptual pages live under `docs.langchain.com/oss/python/langchain/*`, discovered this session via `https://docs.langchain.com/oss/python/langchain/overview`, which links to `install`, `quickstart`, `models`, and `agents` (plus cross-links to `langgraph/overview` and `langsmith/observability`, both out of scope for this skill). This task writes `SKILL.md` plus the two most load-bearing reference files (`agents.md`, `models.md`), fetched and verified this session from `https://docs.langchain.com/oss/python/langchain/agents` and `https://docs.langchain.com/oss/python/langchain/models`.

- [ ] **Step 1: Write the failing wiring test**

Append to `test/framework-skill-packs.test.js`:

```javascript
test('langchain-code skill exists with correct frontmatter and reference files', () => {
  const skillDir = path.join(__dirname, '..', '.claude', 'skills', 'langchain-code');
  const skill = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: langchain-code\n/);
  assert.match(skill, /create_agent/);
  assert.strictEqual(fs.existsSync(path.join(skillDir, 'references', 'agents.md')), true);
  assert.strictEqual(fs.existsSync(path.join(skillDir, 'references', 'models.md')), true);
  const agents = fs.readFileSync(path.join(skillDir, 'references', 'agents.md'), 'utf8');
  assert.match(agents, /docs\.langchain\.com\/oss\/python\/langchain\/agents/);
  const models = fs.readFileSync(path.join(skillDir, 'references', 'models.md'), 'utf8');
  assert.match(models, /docs\.langchain\.com\/oss\/python\/langchain\/models/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/framework-skill-packs.test.js`
Expected: FAIL — `.claude/skills/langchain-code/SKILL.md` does not exist

- [ ] **Step 3: Write `SKILL.md`**

Create `.claude/skills/langchain-code/SKILL.md`:

```markdown
---
name: langchain-code
description: Build LangChain agents in Python — create_agent, chat model initialization, tool binding, structured output, and middleware. Use for a single-agent tool-calling loop with a system prompt and a fixed tool list; use langgraph-code instead when the task needs explicit multi-step state-machine control flow, and deepagents-code instead when it needs a pre-assembled filesystem/planning/subagent harness for long-running work. Triggers on "LangChain agent", "create_agent", "chat model", "tool calling agent", "structured output langchain", "bind_tools".
---

# LangChain

Source: https://docs.langchain.com/oss/python/langchain/overview (fetched 2026-07-06 — re-verify if this content seems stale). Note: `docs.langchain.com`'s top-level `llms.txt` index is dominated by LangSmith/Agent-Server/Fleet/API-reference content unrelated to this skill — the relevant pages live under `oss/python/langchain/*` specifically; don't confuse the two when looking for more material.

## Core Philosophy

An agent is a model plus a configurable harness: `create_agent` gives you a minimal, composable base (model, tools, system prompt, optional middleware) rather than a fixed opinionated pipeline. This is the "assemble exactly what you need" layer — see `deepagents-code` for the pre-assembled, opinionated alternative when the task needs filesystem access, planning, and subagents out of the box.

## When to Reach for LangChain vs. Its Siblings

- **`langchain-code` (this skill)**: a single agent, a fixed tool list, optionally structured output — no explicit multi-step state machine needed.
- **`langgraph-code`**: the task needs explicit branching/looping control flow, durable checkpointing, or a pause-for-approval step.
- **`deepagents-code`**: the task is long-running (coding/research) and needs filesystem access, task planning, and subagent delegation pre-assembled rather than composed by hand.

## Quick Reference

- `references/agents.md` — `create_agent`, tool attachment, middleware, structured output, conversation persistence via checkpointer/`thread_id`.
- `references/models.md` — `init_chat_model`, provider-specific classes, invoke/stream/batch, tool binding at the model level, structured output at the model level.

## Gotchas (do not skip)

- **Conversation persistence requires an explicit checkpointer**, same as LangGraph (`create_agent` is itself LangGraph-backed under the hood) — without one, history is discarded between invocations even with a `thread_id`.
- **System prompts are static at agent creation** and do not enforce hard rules — for actual policy enforcement (PII redaction, content filters), use middleware, not prompt wording.
- **Tool docstrings are load-bearing.** The agent introspects a tool function's docstring and type hints to build its schema — a vague docstring produces poor tool-selection behavior, this is not cosmetic.
- **`invoke()` blocks until the whole run finishes.** For real-time UX on a multi-tool-call run, use streaming (`stream_events`) instead.

## Not Yet Covered Here (fetch before relying on these topics)

This skill's reference files cover `create_agent` and chat-model configuration in depth. Tool-definition patterns beyond the basics, retrieval/RAG composition, and memory patterns beyond what `agents.md`'s checkpointer section covers were not separately fetched into a reference file this pass — fetch `https://docs.langchain.com/oss/python/langchain/overview`'s current linked pages (the set may have grown) before advising deeply on those topics.
```

- [ ] **Step 4: Write `references/agents.md`**

Create `.claude/skills/langchain-code/references/agents.md`:

```markdown
# create_agent — API, Tools, Middleware, Structured Output

Source: https://docs.langchain.com/oss/python/langchain/agents (fetched 2026-07-06 — re-verify if this content seems stale)

## Core API

```python
from langchain.agents import create_agent

agent = create_agent(
    model="provider:model_id",       # e.g. "anthropic:claude-sonnet-4-6"
    tools=[...],
    system_prompt="...",
    response_format=SomeSchema,      # optional — see Structured Output below
    middleware=[...],                # optional — see Middleware below
    checkpointer=...,                # optional — see Invocation & Conversation State below
    context_schema=...,              # optional dataclass for per-invocation request-scoped data
    name="agent_name",               # optional, useful for multi-agent hierarchies
)
```

`model` accepts a `"provider:model_id"` string or an already-initialized model instance (see `references/models.md`).

## Attaching Tools

```python
from langchain.tools import tool

@tool
def search(query: str) -> str:
    """Search for information."""
    return f"Results for: {query}"

agent = create_agent(model="...", tools=[search])
```

The agent parses each tool's docstring and type hints to build its schema — write clear docstrings, this directly affects tool-selection quality, not just documentation.

## System Prompt

A string or `SystemMessage`, static at creation time. It shapes reasoning but does **not** enforce hard rules — for deterministic policy enforcement (PII redaction, content filters), implement guardrail middleware instead of relying on prompt wording.

## Middleware — the Extensibility Primitive

Middleware composes freely, one concern per instance, across six categories: execution environment (filesystem/tools/sandboxes), context management (summarization/memory/prompt caching), planning & delegation (todo lists/subagents), fault tolerance (retries), guardrails (PII/content policy, deterministic), and steering (human-in-the-loop approval).

```python
agent = create_agent(
    model="...",
    tools=[search],
    middleware=[
        ModelRetryMiddleware(max_retries=3),
        PIIMiddleware("email"),
        HumanInTheLoopMiddleware(interrupt_on={"write_file": True}),
    ],
)
```

**Middleware order matters** — each middleware sees the output of whatever ran before it in the list.

## Structured Output

```python
class Answer(BaseModel):
    summary: str
    confidence: float

result = agent.invoke({"messages": [{"role": "user", "content": "Summarize AI trends"}]}, config=config)
validated_output = result["structured_response"]  # an Answer instance, already validated
```

## Invocation & Conversation State

```python
config = {"configurable": {"thread_id": str(uuid7())}}
result = agent.invoke({"messages": [{"role": "user", "content": "Question?"}]}, config=config)
# Reuse the same thread_id for follow-up turns — history persists automatically, ONLY if a checkpointer was configured.
```

`thread_id` (in `config`) scopes the conversation; a separate `context` argument carries per-invocation metadata (user id, feature flags) that is not conversation state. Both are commonly passed together but serve different purposes — don't conflate them.

## Gotchas

- **Checkpointer is not automatic** — without one, `thread_id` reuse does nothing; history is discarded between invocations regardless of whether you pass the same `thread_id`. Locally use `InMemorySaver()`.
- **Streaming vs. blocking**: `invoke()` blocks until the entire run (including all tool calls) completes. For real-time UX during long multi-tool-call runs, use `stream_events(version="v3")` instead.
- **`deepagents-code`'s `create_deep_agent`** pre-assembles filesystem access, summarization, subagents, and prompt caching on top of this same `create_agent` foundation — reach for it instead of hand-assembling that middleware stack yourself when the task calls for it.
```

- [ ] **Step 5: Write `references/models.md`**

Create `.claude/skills/langchain-code/references/models.md`:

```markdown
# Chat Model Initialization and Configuration

Source: https://docs.langchain.com/oss/python/langchain/models (fetched 2026-07-06 — re-verify if this content seems stale)

## Initialization

Preferred: `init_chat_model`, a unified constructor across providers:

```python
from langchain.chat_models import init_chat_model

model = init_chat_model("claude-sonnet-4-6", model_provider="anthropic")
# or with an inline provider prefix:
model = init_chat_model("openai:gpt-5.5")
```

Or a provider-specific class directly:

```python
from langchain_openai import ChatOpenAI
model = ChatOpenAI(model="gpt-5.5")
```

Every provider package implements the same standard interface — switching providers later is a one-line change either way.

## Configuration Parameters

```python
model = init_chat_model(
    "claude-sonnet-4-6",
    temperature=0.7,
    timeout=30,
    max_tokens=1000,
    max_retries=6,   # default is 6; raise to 10-15 on unreliable networks
)
```

## Invocation Methods

```python
response = model.invoke("Why do parrots talk?")                 # single synchronous call

for chunk in model.stream("Question here"):                     # progressive iterator
    print(chunk.text, end="", flush=True)

responses = model.batch(["Question 1", "Question 2", "Question 3"])  # parallel independent calls
```

## Tool Binding (model-level, distinct from `create_agent`'s `tools=` param)

```python
from langchain.tools import tool

@tool
def get_weather(location: str) -> str:
    """Get weather at location."""
    return f"Sunny in {location}."

model_with_tools = model.bind_tools([get_weather])
response = model_with_tools.invoke("What's the weather in Boston?")
# response.tool_calls lists requested functions + arguments — the caller must execute them
# and feed the results back to the model for continued reasoning; bind_tools alone does not run them.
```

## Structured Output

```python
class Movie(BaseModel):
    title: str = Field(description="Movie title")
    year: int = Field(description="Release year")

model_with_structure = model.with_structured_output(Movie)
response = model_with_structure.invoke("Details on Inception?")
```

Supports `'json_schema'` (native provider support), `'function_calling'` (via tool forcing), or `'json_mode'` as the underlying method.

## Gotchas

- **Chat models vs. plain LLM models**: use classes prefixed "Chat" (`ChatOpenAI`, etc.) — they return structured message objects, not raw strings.
- **Streaming requires every component in the pipeline to support it** — a partial implementation silently breaks the streaming flow rather than erroring clearly.
- **Only network errors (timeouts), rate limits (429), and 5xx responses auto-retry.** 401/404 client errors do not retry — don't rely on `max_retries` to paper over a bad API key or wrong model name.
- **Token-usage streaming is opt-in** for some providers (OpenAI/Azure) — don't assume it's present by default.
- **`bind_tools` alone does not execute tools** — the application (or `create_agent`'s loop) is responsible for calling the requested function and returning its result to the model.
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test test/framework-skill-packs.test.js`
Expected: PASS (7 tests)

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/langchain-code test/framework-skill-packs.test.js
git commit -m "feat: add langchain-code skill (create_agent + chat model configuration)"
```

---

### Task 5: `deepagents-code` skill

**Files:**
- Create: `.claude/skills/deepagents-code/SKILL.md`
- Create: `.claude/skills/deepagents-code/references/architecture-and-api.md`
- Test: `test/framework-skill-packs.test.js` (append wiring assertions)

**Sourcing for this task:** `https://docs.langchain.com/oss/python/deepagents/overview`, fetched in full this session — covers the four architectural pillars, the `create_deep_agent`/`HarnessProfile`/`interrupt_on` API, the default middleware stack, and concrete gotchas. This is comprehensive enough for one solid reference file; no additional fetch is required for this task's scope, though deeper sub-pages (if `docs.langchain.com/oss/python/deepagents/*` has more than the overview) are worth checking during implementation.

- [ ] **Step 1: Write the failing wiring test**

Append to `test/framework-skill-packs.test.js`:

```javascript
test('deepagents-code skill exists with correct frontmatter and reference file', () => {
  const skillDir = path.join(__dirname, '..', '.claude', 'skills', 'deepagents-code');
  const skill = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: deepagents-code\n/);
  assert.match(skill, /create_deep_agent/);
  assert.strictEqual(fs.existsSync(path.join(skillDir, 'references', 'architecture-and-api.md')), true);
  const arch = fs.readFileSync(path.join(skillDir, 'references', 'architecture-and-api.md'), 'utf8');
  assert.match(arch, /docs\.langchain\.com\/oss\/python\/deepagents\/overview/);
  assert.match(arch, /HarnessProfile/);
});

test('python-ai-agents pack registers exactly the three skills this plan built', () => {
  const registry = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', '.claude', 'config', 'framework-skill-packs.json'), 'utf8'
  ));
  const local = registry.packs.find((p) => p.key === 'python-ai-agents');
  for (const skillName of local.skills) {
    assert.strictEqual(
      fs.existsSync(path.join(__dirname, '..', '.claude', 'skills', skillName, 'SKILL.md')),
      true,
      `expected .claude/skills/${skillName}/SKILL.md to exist`
    );
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/framework-skill-packs.test.js`
Expected: FAIL — `.claude/skills/deepagents-code/SKILL.md` does not exist

- [ ] **Step 3: Write `SKILL.md`**

Create `.claude/skills/deepagents-code/SKILL.md`:

```markdown
---
name: deepagents-code
description: Build long-running, production-ready agents with DeepAgents — the opinionated harness on top of LangGraph/LangChain providing filesystem access, task planning, subagent delegation, and context management out of the box. Use for long-running coding/research/multi-step tasks where you'd otherwise hand-assemble that middleware stack yourself; use langchain-code's plain create_agent instead for a simple single-tool-call loop with no need for planning or filesystem access. Triggers on "DeepAgents", "create_deep_agent", "agent harness", "long-running agent", "coding agent with filesystem", "subagent spawning".
---

# DeepAgents

Source: https://docs.langchain.com/oss/python/deepagents/overview (fetched 2026-07-06 — re-verify if this content seems stale; this is a fast-moving 2026-era product).

## What It Is, and Isn't

DeepAgents is **not** a separate orchestration engine — it's an opinionated harness layer built on top of LangChain's `create_agent` and LangGraph's runtime. Think of the stack as three layers: LangGraph (low-level execution runtime — state, checkpointing), LangChain's `create_agent` (compose exactly the primitives you need), DeepAgents' `create_deep_agent` (a pre-assembled, batteries-included harness on top of both). Reach for DeepAgents when a task needs the harness's defaults (filesystem, planning, subagents, context management); reach for plain `create_agent` (`langchain-code`) when you want to compose a narrower agent by hand instead.

## Core Architecture — Four Pillars

1. **Execution Environment**: custom tools/APIs/MCP servers, a virtual filesystem (pluggable backends — in-memory, local disk, LangGraph store, composite routing), declarative glob-based filesystem permission rules, code execution via sandboxes.
2. **Context Management**: `SKILL.md`-based progressive-disclosure skills, `AGENTS.md` persistent memory loaded at startup, automatic summarization/context offloading for long-running work, automatic prompt caching for Anthropic/Bedrock models.
3. **Delegation**: `write_todos` for structured task tracking, a `task` tool for spawning ephemeral, stateless subagents with fresh isolated context that return one final report each (not a back-and-forth dialogue).
4. **Steering**: human-in-the-loop via LangGraph interrupts, configurable per tool.

## Key API

```python
from deepagents import create_deep_agent

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    tools=[custom_functions],
    system_prompt="...",
    memory=[memory_files],           # AGENTS.md-style persistent memory
    permissions=[permission_rules],  # glob-based, first-match-wins filesystem access control
    interrupt_on={"edit_file": True},
)

agent.invoke({"messages": [{"role": "user", "content": "..."}]})
```

See `references/architecture-and-api.md` for the default middleware stack, `HarnessProfile`, and every gotcha below in full detail.

## Gotchas (do not skip)

- **You cannot remove the default middleware** — only hide specific tools from a model via `HarnessProfile`'s `excluded_tools`. Removing the middleware itself is "intentionally rejected" by the framework's own design.
- **Subagents are stateless** — a spawned subagent returns exactly one final report, not a streaming dialogue. Don't design a flow expecting back-and-forth with a subagent mid-task.
- **Filesystem permission rules don't cover sandbox backends** — a sandbox allows arbitrary shell execution regardless of glob-based permission rules on the built-in filesystem tools. Add custom policy hooks if a sandbox needs additional guardrails.
- **Prompt caching is automatic for Anthropic/Bedrock** — no configuration needed; don't add manual cache-control logic on top of it.
```

- [ ] **Step 4: Write `references/architecture-and-api.md`**

Create `.claude/skills/deepagents-code/references/architecture-and-api.md`:

```markdown
# DeepAgents Architecture, Default Middleware, and API Surface

Source: https://docs.langchain.com/oss/python/deepagents/overview (fetched 2026-07-06 — re-verify if this content seems stale)

## Relationship to LangChain and LangGraph

DeepAgents is built directly on LangChain's core building blocks and uses the LangGraph runtime for durable execution. LangChain provides the primitives (`create_agent`); LangGraph provides the execution runtime (state, checkpointing); DeepAgents adds an opinionated harness layer with built-in planning/filesystem/delegation/context-management capabilities on top of both. If you need a custom agent without the harness's specific defaults, drop down to `langchain-code`'s `create_agent` or a hand-built LangGraph workflow (`langgraph-code`) instead.

## Configuration Artifacts

- **`HarnessProfile`**: controls which tools/middleware are excluded per model — e.g. hiding a tool from a specific model without removing the underlying middleware.
- **`SKILL.md` files**: domain-knowledge bundles, progressively disclosed — same mechanism this harness's own skills use.
- **`AGENTS.md` files**: persistent memory loaded at startup, carried across sessions.
- **Permission rules**: glob-based filesystem access control, first-match-wins semantics.

## Default Middleware Stack

Ships built-in (cannot be fully removed, only individual tools hidden via `HarnessProfile.excluded_tools`):

- Filesystem tools: `ls`, `read_file`, `write_file`, `edit_file`, `glob`, `grep`, `execute`.
- Subagent spawning via the `task` tool (on by default, "intentionally rejected" for removal per the framework's own design).
- Context management: automatic summarization and offloading for long-running work.
- Automatic prompt caching for Anthropic/Bedrock models — static prompt sections (system prompt, memory, skills) are cache-eligible by default, no configuration needed.

## Key API Example

```python
from deepagents import create_deep_agent

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    tools=[custom_functions],
    system_prompt="...",
    memory=[memory_files],
    permissions=[permission_rules],
    interrupt_on={"edit_file": True},
)

agent.invoke({"messages": [{"role": "user", "content": "..."}]})
```

## Idiomatic Patterns and Gotchas for Senior Engineers

- **Hiding a tool ≠ removing middleware.** Use `HarnessProfile`'s `excluded_tools` to hide specific filesystem tools from a model. Do not attempt to strip the middleware itself — that path is deliberately unsupported.
- **Subagent semantics are stateless-by-design.** A `task`-tool-spawned subagent gets a fresh, isolated context and returns exactly one final report — no streaming intermediate messages back to the parent. This keeps delegated work token-efficient and isolated, but means you cannot have iterative back-and-forth with a subagent inside a single delegated task.
- **Permission rules protect the built-in filesystem tools only.** A sandbox execution backend permits arbitrary shell commands regardless of glob-based permission rules configured for `read_file`/`write_file`/etc. — if a sandbox needs additional restriction, add custom policy hooks rather than assuming the permission-rule system covers it.
- **Prompt caching needs no manual setup for Anthropic/Bedrock models** — it's automatic and covers static prompt sections (system prompt, memory, skills) by default.
- **Context flow discipline**: understand the four-part flow — input, compression (summarization), isolation (subagent contexts), long-term memory (`AGENTS.md`) — when designing an agent meant to run for a long time without exhausting its context window.
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/framework-skill-packs.test.js`
Expected: PASS (9 tests)

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/deepagents-code test/framework-skill-packs.test.js
git commit -m "feat: add deepagents-code skill (architecture, middleware stack, API)"
```

---

### Task 6: Full-suite verification

**Files:** none created or modified — verification only.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including every test added in Tasks 1-5

- [ ] **Step 2: Manual smoke check — a `core`-profile scaffold does NOT get the new pack unless selected**

Run (from a scratch temp directory, substituting real paths):
```bash
TMPDIR_TEST=$(mktemp -d)
node .claude/scripts/scaffold-apply.js --profile <any-existing-e2e-profile.json> --plugin-source "$(pwd)" --target "$TMPDIR_TEST"
ls "$TMPDIR_TEST/.claude/skills/langgraph-code" 2>&1
```
Expected: `ls` reports "No such file or directory" — confirms `copyFrameworkPackSkills` is correctly a no-op when the test profile's `framework_skill_packs` doesn't include `python-ai-agents` (use any existing fixture profile under `test/e2e/` that doesn't set this field).

- [ ] **Step 3: Commit any final cleanup (only if Step 1 or 2 surfaced something to fix)**

If all tests passed and the manual check matched expectations, there is nothing to commit here — Tasks 1-5 already committed everything.
