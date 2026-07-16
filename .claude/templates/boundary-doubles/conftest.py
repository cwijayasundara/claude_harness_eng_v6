"""Kit conftest — binds the boundary doubles under HARNESS_TEST_REPLAY=1
(boundary-test-doubles kit, gap G34). Copy/merge into the project's tests/ tree.
The app's external-API wrappers read HARNESS_TEST_REPLAY at their own boundary;
this file supplies the fake LLM client. The db_session fixture lives in db_fixture.py.
"""
import os
import pytest

from .fake_llm import FakeLLMClient


def replay_enabled() -> bool:
    return os.environ.get("HARNESS_TEST_REPLAY") == "1"


@pytest.fixture
def llm_client():
    if replay_enabled():
        return FakeLLMClient()
    raise RuntimeError(
        "llm_client requested without HARNESS_TEST_REPLAY=1; integration and "
        "regression tests must run in replay mode (see the live-externals gate, G36)"
    )
