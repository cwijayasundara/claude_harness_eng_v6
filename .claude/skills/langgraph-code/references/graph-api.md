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
