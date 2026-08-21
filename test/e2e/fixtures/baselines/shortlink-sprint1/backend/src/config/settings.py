"""Environment-loaded application settings.

Isolated from `.env` in tests via `Settings(_env_file=None)` (pydantic-settings
still reads real process env vars unless the caller also overrides those, but
never reads a `.env` file left on disk during a test run).
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Backend configuration sourced from environment variables."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str
    SESSION_COOKIE_NAME: str = "session_id"


settings = Settings()  # type: ignore[call-arg]  # values come from the environment
