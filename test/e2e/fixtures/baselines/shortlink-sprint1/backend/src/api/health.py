"""GET /healthz — unauthenticated database-reachability probe.

Two possible status codes (200 reachable / 503 unreachable) share one
route, so the response is built explicitly with `JSONResponse` rather than
a single fixed `response_model` + `status_code=` pair.
"""

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from src.repository.db import check_db_reachable
from src.types.models import HealthBody

router = APIRouter(tags=["health"])


@router.get("/healthz")
async def healthz() -> JSONResponse:
    """Report database reachability. No auth dependency, no request body."""
    if await check_db_reachable():
        body = HealthBody(status="ok", database="reachable")
        return JSONResponse(status_code=200, content=body.model_dump())
    body = HealthBody(status="unavailable", database="unreachable")
    return JSONResponse(status_code=503, content=body.model_dump())
