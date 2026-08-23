"""RED-metrics baseline (Rate/Errors/Duration) — no OTLP export, no business metrics.

`observability.enabled` = true in project-manifest.json requires a
`/metrics` endpoint and a request middleware emitting `http_requests_total`
and `http_request_duration_seconds`, labeled by route *template* (never the
raw path, to keep cardinality bounded).
"""

import time

from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

REQUESTS = Counter(
    "http_requests_total", "Total HTTP requests", ["method", "route", "status"]
)
LATENCY = Histogram(
    "http_request_duration_seconds", "HTTP request latency (seconds)", ["method", "route"]
)


def _route_template(request: Request) -> str:
    """The matched route's path template (e.g. `/auth/sign-in`), not the raw
    path. Starlette's router stores the matched route on `scope["route"]`
    once `call_next` has run the request through it; no match (e.g. 404)
    leaves it unset, so the raw path is the only label available then.
    """
    route = request.scope.get("route")
    path = getattr(route, "path", None)
    return path if isinstance(path, str) else request.url.path


class MetricsMiddleware(BaseHTTPMiddleware):
    """Records RED metrics for every HTTP request."""

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        start = time.perf_counter()
        response = await call_next(request)
        template = _route_template(request)
        REQUESTS.labels(request.method, template, str(response.status_code)).inc()
        LATENCY.labels(request.method, template).observe(time.perf_counter() - start)
        return response


async def metrics_endpoint(_request: Request) -> Response:
    """GET /metrics — Prometheus text exposition format."""
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)
