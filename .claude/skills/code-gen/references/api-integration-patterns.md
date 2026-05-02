# External API Integration Patterns

Reference templates for generator teammates. When a story involves an external API, read this file before implementation.

---

## 1. Service Wrapper Template (Python)

```python
import asyncio
import json
import logging
import time
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


class ApiTransientError(Exception):
    """Retryable: 429, 502, 503, timeout, connection reset."""
    pass


class ApiPermanentError(Exception):
    """Not retryable: 400, 401, 403, 404, schema mismatch."""
    pass


class ApiRateLimitError(ApiTransientError):
    """Rate limited with backoff hint."""
    def __init__(self, message: str, retry_after: float | None = None):
        super().__init__(message)
        self.retry_after = retry_after


class ExternalServiceClient:
    """Wrapper for ExternalService API.

    This is the ONLY file that imports the ExternalService SDK.
    Business logic uses this wrapper's typed interface.
    """

    def __init__(self, config: ApiConfig, replay: bool = False):
        self._config = config
        self._service_name = "external_service"
        self._replay = replay
        self._fixtures_dir = Path(f"tests/fixtures/{self._service_name}")
        self._client = self._build_client(config)

    def _build_client(self, config: ApiConfig) -> Any:
        """Initialize the SDK client."""
        # Import SDK here — nowhere else in the codebase
        # from external_sdk import Client
        # return Client(api_key=config.api_key, base_url=config.base_url)
        raise NotImplementedError("Replace with actual SDK initialization")

    async def execute_operation(self, request: OperationRequest) -> OperationResponse:
        """Execute operation with retry, logging, and error classification."""
        start = time.monotonic()
        attempt = 0
        last_error: Exception | None = None

        while attempt < self._config.retry.max_attempts:
            attempt += 1
            try:
                logger.info(
                    "API request started",
                    extra={
                        "service": self._service_name,
                        "operation": "execute_operation",
                        "attempt": attempt,
                    },
                )

                raw = await self._call(request)

                elapsed_ms = (time.monotonic() - start) * 1000
                logger.info(
                    "API request completed",
                    extra={
                        "service": self._service_name,
                        "operation": "execute_operation",
                        "attempt": attempt,
                        "latency_ms": round(elapsed_ms, 2),
                        "status": "success",
                    },
                )

                return OperationResponse.from_raw(raw)

            except ApiRateLimitError as e:
                last_error = e
                backoff = e.retry_after or self._compute_backoff(attempt)
                logger.warning(
                    "API rate limited",
                    extra={
                        "service": self._service_name,
                        "operation": "execute_operation",
                        "attempt": attempt,
                        "retry_after": backoff,
                    },
                )
                if attempt < self._config.retry.max_attempts:
                    await asyncio.sleep(backoff)

            except ApiTransientError as e:
                last_error = e
                elapsed_ms = (time.monotonic() - start) * 1000
                logger.warning(
                    "API transient error, retrying",
                    extra={
                        "service": self._service_name,
                        "operation": "execute_operation",
                        "attempt": attempt,
                        "error": str(e),
                        "latency_ms": round(elapsed_ms, 2),
                    },
                )
                if attempt < self._config.retry.max_attempts:
                    await asyncio.sleep(self._compute_backoff(attempt))

            except ApiPermanentError:
                elapsed_ms = (time.monotonic() - start) * 1000
                logger.error(
                    "API permanent error",
                    extra={
                        "service": self._service_name,
                        "operation": "execute_operation",
                        "attempt": attempt,
                        "latency_ms": round(elapsed_ms, 2),
                    },
                )
                raise

        raise last_error or ApiTransientError("Max retries exceeded")

    async def _call(self, request: OperationRequest) -> dict:
        """Make the actual API call. Handles replay mode and sync bridging."""
        if self._replay:
            fixture_path = self._fixtures_dir / f"{request.operation_name}.json"
            logger.debug("Replaying fixture", extra={"path": str(fixture_path)})
            return json.loads(fixture_path.read_text())

        # Sync SDK bridge — use asyncio.to_thread for sync-only SDKs
        return await asyncio.to_thread(
            self._client.operation,
            **request.to_sdk_params(),
        )

    def _compute_backoff(self, attempt: int) -> float:
        return self._config.retry.backoff_base * (
            self._config.retry.backoff_multiplier ** (attempt - 1)
        )
```

---

## 2. Service Wrapper Template (TypeScript)

```typescript
import { Logger } from "../config/logger";

interface ApiConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  retry: {
    maxAttempts: number;
    backoffBase: number;
    backoffMultiplier: number;
  };
}

export class ApiTransientError extends Error {
  constructor(message: string, public statusCode?: number) {
    super(message);
    this.name = "ApiTransientError";
  }
}

export class ApiPermanentError extends Error {
  constructor(message: string, public statusCode?: number, public responseBody?: string) {
    super(message);
    this.name = "ApiPermanentError";
  }
}

export class ApiRateLimitError extends ApiTransientError {
  constructor(message: string, public retryAfter?: number) {
    super(message, 429);
    this.name = "ApiRateLimitError";
  }
}

export class ExternalServiceClient {
  private readonly serviceName = "external_service";
  private readonly logger: Logger;

  constructor(
    private readonly config: ApiConfig,
    private readonly replay: boolean = false,
  ) {
    this.logger = new Logger(this.serviceName);
  }

  async executeOperation(request: OperationRequest): Promise<OperationResponse> {
    const start = performance.now();
    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt < this.config.retry.maxAttempts) {
      attempt++;
      try {
        this.logger.info("API request started", {
          operation: "executeOperation",
          attempt,
        });

        const raw = await this.call(request);
        const elapsedMs = performance.now() - start;

        this.logger.info("API request completed", {
          operation: "executeOperation",
          attempt,
          latencyMs: Math.round(elapsedMs),
          status: "success",
        });

        return OperationResponse.fromRaw(raw);
      } catch (e) {
        if (e instanceof ApiPermanentError) {
          const elapsedMs = performance.now() - start;
          this.logger.error("API permanent error", {
            operation: "executeOperation",
            attempt,
            latencyMs: Math.round(elapsedMs),
          });
          throw e;
        }

        if (e instanceof ApiTransientError) {
          lastError = e;
          const backoff =
            e instanceof ApiRateLimitError && e.retryAfter
              ? e.retryAfter * 1000
              : this.computeBackoff(attempt);

          this.logger.warn("API transient error, retrying", {
            operation: "executeOperation",
            attempt,
            error: e.message,
            backoffMs: backoff,
          });

          if (attempt < this.config.retry.maxAttempts) {
            await new Promise((r) => setTimeout(r, backoff));
          }
        }
      }
    }

    throw lastError ?? new ApiTransientError("Max retries exceeded");
  }

  private async call(request: OperationRequest): Promise<Record<string, unknown>> {
    if (this.replay) {
      const fs = await import("fs/promises");
      const fixture = await fs.readFile(
        `tests/fixtures/${this.serviceName}/${request.operationName}.json`,
        "utf-8",
      );
      return JSON.parse(fixture);
    }

    const response = await fetch(`${this.config.baseUrl}${request.path}`, {
      method: request.method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("Retry-After")) || undefined;
      throw new ApiRateLimitError("Rate limited", retryAfter);
    }
    if (response.status >= 500) {
      throw new ApiTransientError(`Server error: ${response.status}`, response.status);
    }
    if (!response.ok) {
      const body = await response.text();
      throw new ApiPermanentError(`Client error: ${response.status}`, response.status, body);
    }

    return response.json();
  }

  private computeBackoff(attempt: number): number {
    return (
      this.config.retry.backoffBase *
      this.config.retry.backoffMultiplier ** (attempt - 1) *
      1000
    );
  }
}
```

---

## 3. Config Template

```yaml
# config.yml — external API configuration
external_apis:
  service_name:
    base_url: "${SERVICE_BASE_URL}"
    timeout_seconds: 30
    retry:
      max_attempts: 3
      backoff_base: 1.0
      backoff_multiplier: 2.0
      retryable_status_codes: [429, 502, 503]
    rate_limit:
      requests_per_minute: 60
      respect_retry_after: true
```

---

## 4. Test Fixture Pattern

### Recording Fixtures

```python
# scripts/record_fixtures.py
"""One-time script to record API responses for replay testing."""
import asyncio
import json
from pathlib import Path

async def record(service_name: str, operation: str):
    config = load_config()
    client = build_real_client(config, service_name)
    response = await client.execute_operation(build_sample_request(operation))

    fixture_dir = Path(f"tests/fixtures/{service_name}")
    fixture_dir.mkdir(parents=True, exist_ok=True)
    (fixture_dir / f"{operation}.json").write_text(
        json.dumps(response.to_raw(), indent=2)
    )
    print(f"Recorded: {fixture_dir / f'{operation}.json'}")

if __name__ == "__main__":
    import sys
    asyncio.run(record(sys.argv[1], sys.argv[2]))
```

### Unit Test (Mock the Wrapper)

```python
# tests/unit/test_process_service.py
import pytest
from unittest.mock import AsyncMock

@pytest.fixture
def mock_client():
    client = AsyncMock()
    client.execute_operation.return_value = OperationResponse(
        id="123",
        status="completed",
        result={"key": "value"},
    )
    return client

async def test_process_calls_external_api(mock_client):
    service = ProcessService(client=mock_client)
    result = await service.process(document_id="doc-1")

    mock_client.execute_operation.assert_called_once()
    assert result.document_id == "doc-1"
    assert result.status == "completed"
```

### Integration Test (Replay Mode)

```python
# tests/integration/test_external_client.py
import pytest

@pytest.fixture
def replay_client():
    config = load_test_config()
    return ExternalServiceClient(config=config, replay=True)

async def test_operation_returns_expected_shape(replay_client):
    request = OperationRequest(operation_name="parse", params={"file": "test.pdf"})
    result = await replay_client.execute_operation(request)

    assert result.id is not None
    assert result.status in ("completed", "pending")
```
