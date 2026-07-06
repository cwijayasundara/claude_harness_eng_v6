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
