# PRD: Count Endpoint

Intentionally tiny — one functional requirement — so the full autonomous pipeline
(plan → build → deploy → test) fits in a single headless run. One cluster.

## 1. Problem & Goal
A caller wants a single HTTP endpoint that returns a counter and can bump it.
Success: GET the endpoint, see a number; POST to it, the number goes up by 1.

## 2. Users & Jobs-to-be-done
One programmatic caller that reads and increments a count.

## 3. Functional Requirements
- **FR-1** An HTTP server with `GET /count` returning `{ "count": <n> }` (starting at 0) and `POST /count` that increments the count by 1 and returns the new value.

## 4. Non-Functional Requirements
- **NFR-1** No external runtime dependencies; Node standard library only.
- **NFR-2** The server honors `process.env.PORT`.

## 5. Out of Scope
- Any UI or web page.
- Persistence across restarts.
- Authentication, decrement, or reset.

## 6. Acceptance / Done
- **FR-1** → `GET /count` returns `{ "count": 0 }` initially; each `POST /count` raises it by 1 and returns the new value as JSON.
