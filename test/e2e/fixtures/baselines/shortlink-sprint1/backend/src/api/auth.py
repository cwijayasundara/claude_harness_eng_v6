"""POST /auth/register and POST /auth/sign-in.

Route handlers stay thin: validate (Pydantic) -> call auth_service -> map
result to a response model. `sign_out` is story E1-S2's addition.
"""

from fastapi import APIRouter, HTTPException, Response

from src.config.settings import settings
from src.services.auth_service import EmailAlreadyRegistered, InvalidCredentials, sign_in
from src.services.auth_service import register as register_member
from src.types.models import Member, MemberView, RegisterRequest, SignInRequest

router = APIRouter(prefix="/auth", tags=["auth"])


def _to_member_view(member: Member) -> MemberView:
    return MemberView(id=member.id, email=member.email, createdAt=member.created_at)


@router.post("/register", response_model=MemberView, status_code=201)
async def register(body: RegisterRequest) -> MemberView:
    """Register a new Member. 409 if the email is already registered."""
    try:
        member = await register_member(body.email, body.password)
    except EmailAlreadyRegistered as exc:
        raise HTTPException(status_code=409, detail="email_already_registered") from exc
    return _to_member_view(member)


@router.post("/sign-in", response_model=MemberView)
async def sign_in_route(body: SignInRequest, response: Response) -> MemberView:
    """Sign in with email + password. 401 if either is wrong; no cookie set."""
    try:
        member, session = await sign_in(body.email, body.password)
    except InvalidCredentials as exc:
        raise HTTPException(status_code=401, detail="invalid_credentials") from exc
    response.set_cookie(
        key=settings.SESSION_COOKIE_NAME,
        value=str(session.id),
        httponly=True,
        secure=True,
        samesite="lax",
    )
    return _to_member_view(member)
