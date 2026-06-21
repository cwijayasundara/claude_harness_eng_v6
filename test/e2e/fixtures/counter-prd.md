# PRD: Counter Service

A deliberately small product, sized so the full autonomous pipeline (plan → build
→ deploy → test) completes quickly. Shaped to decompose into a foundation cluster
(state + server) and a UI cluster.

## 1. Problem & Goal
A single user wants a web page that shows a running count they can increase, and
the count must survive a server restart. Success: open the page, click once, see 1.

## 2. Users & Jobs-to-be-done
One local user who wants to (a) see the current count and (b) increment it.

## 3. Functional Requirements
- **FR-1** Persist the current count (a non-negative integer) to local disk.
- **FR-2** An HTTP API endpoint returns the current count and one to increment it by 1.
- **FR-3** A single web page shows the count (element id="count") and an Increment button (id="increment").

## 4. Non-Functional Requirements
- **NFR-1** No external runtime dependencies; Node standard library only.
- **NFR-2** The server honors process.env.PORT.

## 5. Out of Scope
- Decrement or reset.
- Authentication or multiple users.
- Any database or cloud service.

## 6. Acceptance / Done
- **FR-1** → After incrementing then restarting the process, the count is unchanged.
- **FR-2** → GET returns the current count as JSON; the increment call raises it by 1.
- **FR-3** → Loading the page shows the count, and clicking Increment raises #count by 1 without a manual reload.
