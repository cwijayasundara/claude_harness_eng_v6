"""Record/replay transport for external-API wrappers (boundary-test-doubles kit, gap G34).

A wrapper delegates its `_call` seam to a ReplayTransport. Under
HARNESS_TEST_REPLAY=1 it serves a recorded golden fixture instead of hitting the
network, making integration and regression tests deterministic. Recording is a
one-time step run with the flag unset against the real service.
"""
import json
import os
from pathlib import Path


def replay_enabled() -> bool:
    return os.environ.get("HARNESS_TEST_REPLAY") == "1"


class MissingFixtureError(RuntimeError):
    """Raised in replay mode when no recorded fixture exists for an operation.

    In a forced-replay regression run this signals that the code path would have
    reached a live external — a hard failure, not a fallback to the network.
    """


class ReplayTransport:
    def __init__(self, service_name: str, fixtures_root: str = "tests/fixtures"):
        self._service = service_name
        self._dir = Path(fixtures_root) / service_name

    def path_for(self, operation: str) -> Path:
        return self._dir / f"{operation}.json"

    def replay(self, operation: str) -> dict:
        p = self.path_for(operation)
        if not p.exists():
            raise MissingFixtureError(
                f"no recorded fixture for {self._service}/{operation} at {p}; "
                f"record it once with HARNESS_TEST_REPLAY unset via ReplayTransport.record()"
            )
        return json.loads(p.read_text())

    def record(self, operation: str, response: dict) -> Path:
        self._dir.mkdir(parents=True, exist_ok=True)
        p = self.path_for(operation)
        p.write_text(json.dumps(response, indent=2, sort_keys=True))
        return p
