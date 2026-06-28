# Observability — Python / FastAPI

Concrete implementation of `observability-conventions.md` for FastAPI. Dependency: `prometheus-client`.

Create `backend/app/observability.py`:

```python
import time
from contextvars import ContextVar

from prometheus_client import Counter, Histogram, generate_latest, CONTENT_TYPE_LATEST
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

request_id_var: ContextVar[str] = ContextVar("request_id", default="-")

REQUESTS = Counter(
    "http_requests_total", "Total HTTP requests", ["method", "route", "status"]
)
LATENCY = Histogram(
    "http_request_duration_seconds", "HTTP request latency (seconds)", ["method", "route"]
)


def _route_template(request: Request) -> str:
    # Route matching happens during call_next; the matched route is on the scope
    # afterwards. Fall back to the raw path only if no route matched (404).
    route = request.scope.get("route")
    return getattr(route, "path", request.url.path)


class MetricsMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        start = time.perf_counter()
        response = await call_next(request)
        template = _route_template(request)
        REQUESTS.labels(request.method, template, str(response.status_code)).inc()
        LATENCY.labels(request.method, template).observe(time.perf_counter() - start)
        return response


async def metrics_endpoint(_request: Request) -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)
```

Wire it in the app factory (`backend/app/main.py`):

```python
from app.observability import MetricsMiddleware, metrics_endpoint

app.add_middleware(MetricsMiddleware)
app.add_route("/metrics", metrics_endpoint)  # use observability.metrics_path
```

Log correlation — extend the existing JSON logging config with a filter that reads the contextvar (the request-id middleware already sets `request_id_var`):

```python
import logging

class RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        from app.observability import request_id_var
        record.request_id = request_id_var.get()
        return True
```

Add `request_id` to the JSON formatter's field list so every line carries it.

## Acceptance criterion

`GET /metrics` → 200, `Content-Type: text/plain; version=0.0.4`, body contains `http_requests_total` and `http_request_duration_seconds`.
