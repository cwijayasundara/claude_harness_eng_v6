"""Deterministic fake LLM client (boundary-test-doubles kit, gap G34).

Returns golden structured responses keyed by (operation, stable request hash) so
LLM-backed flows are deterministic in tests. code-gen mandates tool_use/JSON-schema
output, so the golden is a validated JSON object, not free text. Drop-in for the
LLM wrapper's SDK client under HARNESS_TEST_REPLAY=1.

`request_key` is defined below the class deliberately (it is resolved at call
time) to keep each definition small and unambiguous.
"""
import hashlib
import json
from pathlib import Path


class GoldenNotFoundError(RuntimeError):
    """Raised in replay mode when no golden response exists for a request.

    In a forced-replay regression run this signals the flow would have called the
    real model — a hard failure, not a live call.
    """


class FakeLLMClient:
    def __init__(self, fixtures_root: str = "tests/fixtures/llm"):
        self._dir = Path(fixtures_root)

    def _path(self, operation: str, key: str) -> Path:
        return self._dir / operation / f"{key}.json"

    def respond(self, operation: str, payload: dict) -> dict:
        key = request_key(payload)
        p = self._path(operation, key)
        if not p.exists():
            raise GoldenNotFoundError(
                f"no golden LLM response for {operation}/{key} at {p}; "
                f"record it once against the real model via record_golden()"
            )
        return json.loads(p.read_text())

    def record_golden(self, operation: str, payload: dict, response: dict) -> Path:
        key = request_key(payload)
        p = self._path(operation, key)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(response, indent=2, sort_keys=True))
        return p


def request_key(payload: dict) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]
