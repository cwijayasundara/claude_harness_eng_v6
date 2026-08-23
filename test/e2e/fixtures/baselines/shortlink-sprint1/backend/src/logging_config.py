"""Global log redaction: passwords and Argon2id hashes never appear in logs.

Two guarantees hold together:
1. No handler in this codebase logs a request body — register/sign-in
   payloads are never passed to a logger call, so the plaintext password
   never reaches a log line in the first place.
2. A filter installed on every logger used by this app strips any
   `$argon2id$...` substring from every record before it is emitted, as a
   defense-in-depth backstop against an accidental future log line that
   embeds a Member's stored hash.
"""

import logging
import re

_ARGON2_HASH_PATTERN = re.compile(r"\$argon2id\$[^\s\"']*")
REDACTED = "[REDACTED]"

_INSTRUMENTED_LOGGERS = ("", "uvicorn", "uvicorn.access", "uvicorn.error", "sqlalchemy.engine")


class RedactHashFilter(logging.Filter):
    """Replaces any Argon2id hash substring in a record with a redaction marker."""

    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        record.msg = _ARGON2_HASH_PATTERN.sub(REDACTED, message)
        record.args = ()
        return True


def configure_logging(level: int = logging.INFO) -> None:
    """Install the redaction filter on the root and framework loggers.

    Must run once at startup, before the app serves any request.
    """
    logging.basicConfig(level=level)
    redact_filter = RedactHashFilter()
    for name in _INSTRUMENTED_LOGGERS:
        logging.getLogger(name).addFilter(redact_filter)
