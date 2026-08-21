"""Domain and wire-shape models shared by every layer above types/.

Field names mirror `specs/design/data-models.schema.json` (Member, Session)
and `specs/design/api-contracts.schema.json` (RegisterRequest, SignInRequest,
MemberView, ErrorBody) exactly. This module imports nothing from other
layers, per `.claude/architecture.md`.
"""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr


class Member(BaseModel):
    """A registered account holder (see CONTEXT.md#Member)."""

    model_config = ConfigDict(frozen=True)

    id: UUID
    email: EmailStr
    password_hash: str
    created_at: datetime


class Session(BaseModel):
    """Server-side record backing a Member's HTTP-only cookie (CONTEXT.md#Session)."""

    model_config = ConfigDict(frozen=True)

    id: UUID
    member_id: UUID
    created_at: datetime
    expires_at: datetime | None
    revoked_at: datetime | None


class RegisterRequest(BaseModel):
    """POST /auth/register request body."""

    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    password: str


class SignInRequest(BaseModel):
    """POST /auth/sign-in request body."""

    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    password: str


class MemberView(BaseModel):
    """The Member fields returned to the client. Never includes password_hash."""

    model_config = ConfigDict(extra="forbid")

    id: UUID
    email: EmailStr
    createdAt: datetime


class ErrorBody(BaseModel):
    """Shared error envelope every 4xx/503 response returns."""

    model_config = ConfigDict(extra="forbid")

    error: str


class HealthBody(BaseModel):
    """The /healthz response body: status and database reachability."""

    model_config = ConfigDict(extra="forbid")

    status: Literal["ok", "unavailable"]
    database: Literal["reachable", "unreachable"]
