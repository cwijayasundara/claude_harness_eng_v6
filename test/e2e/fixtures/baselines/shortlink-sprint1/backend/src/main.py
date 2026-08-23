"""FastAPI app wiring: routers, middleware, exception handlers.

E6-S1 adds the /healthz router and E6-S2 adds the global DB-unreachable
503 handler here later — this file starts minimal, auth + observability only.
"""

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from src.api.auth import router as auth_router
from src.api.health import router as health_router
from src.logging_config import configure_logging
from src.observability import MetricsMiddleware, metrics_endpoint
from src.types.models import ErrorBody

configure_logging()

app = FastAPI(title="shortlink")
app.add_middleware(MetricsMiddleware)
app.add_route("/metrics", metrics_endpoint)
app.include_router(auth_router)
app.include_router(health_router)


@app.exception_handler(HTTPException)
async def http_exception_handler(_request: Request, exc: HTTPException) -> JSONResponse:
    """Map every HTTPException to the shared {"error": ...} envelope."""
    message = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
    return JSONResponse(status_code=exc.status_code, content=ErrorBody(error=message).model_dump())


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    _request: Request, _exc: RequestValidationError
) -> JSONResponse:
    """Map Pydantic request-validation failures to the {"error": ...} envelope."""
    return JSONResponse(status_code=422, content=ErrorBody(error="validation_error").model_dump())
