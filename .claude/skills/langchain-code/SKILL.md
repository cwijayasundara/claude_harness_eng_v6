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
