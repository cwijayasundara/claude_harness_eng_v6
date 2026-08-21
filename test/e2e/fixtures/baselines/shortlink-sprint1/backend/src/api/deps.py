"""FastAPI dependencies shared across routers."""

from uuid import UUID

from fastapi import HTTPException, Request

from src.config.settings import settings
from src.services.auth_service import NoActiveSession, get_current_member
from src.types.models import Member


async def require_session(request: Request) -> Member:
    """Resolve the signed-in Member from the session cookie, or raise 401."""
    raw_session_id = request.cookies.get(settings.SESSION_COOKIE_NAME)
    session_id: UUID | None
    try:
        session_id = UUID(raw_session_id) if raw_session_id is not None else None
    except ValueError:
        session_id = None
    try:
        return await get_current_member(session_id)
    except NoActiveSession as exc:
        raise HTTPException(status_code=401, detail="no active session") from exc
