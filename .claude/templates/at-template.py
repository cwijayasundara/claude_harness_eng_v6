"""Acceptance-test template — Ports-and-Adapters with a fake adapter
(boundary-test-doubles kit, gap G34). Copy to specs/test_artefacts/at-template.py
and adapt per story, so writing-acceptance-tests-first has a concrete house pattern
instead of hand-rolling the first AT.

GIVEN a valid registration request
WHEN the account is registered through the business port
THEN an account exists with the given email
"""
from dataclasses import dataclass, field


class AccountStore:  # Port: the narrow I/O interface the business logic depends on
    def save(self, email: str) -> str: ...
    def exists(self, email: str) -> bool: ...


@dataclass
class FakeAccountStore(AccountStore):  # Test-double adapter: fast, in-memory, deterministic
    _emails: set = field(default_factory=set)

    def save(self, email: str) -> str:
        self._emails.add(email)
        return email

    def exists(self, email: str) -> bool:
        return email in self._emails


def test_registering_a_valid_email_creates_an_account():
    # GIVEN an empty account store
    store = FakeAccountStore()
    from app.accounts import register  # the business port entry point

    # WHEN a valid email is registered through the port
    register("ada@example.com", store=store)

    # THEN an account exists for that email
    assert store.exists("ada@example.com")
