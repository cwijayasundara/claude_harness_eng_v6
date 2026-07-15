# PRD: Todo List

A tiny single-user todo service — the **small, fast** fixture for tuning the
Fusion A/B loop end-to-end before spending on the larger ledger PRD. Small on
purpose, but shaped to decompose into a foundation cluster (data model +
persistence) and an API cluster with a real dependency between them.

## 1. Problem & Goal
One person wants to jot down tasks, mark them done, and find the ones still open
— from one small local app, no signup. Success: add a task and see only the open
ones in one call.

## 2. Users & Jobs-to-be-done
One local user ("me") who wants to (a) add a task, (b) mark it complete or
reopen it, (c) list tasks filtered by open/done, and (d) delete a task.

## 3. Functional Requirements
- **FR-1** Persist tasks (id, title, status ∈ {open, done}, created_at) in a local store that survives a process restart.
- **FR-2** Add a task via an HTTP API endpoint (defaults to `open`), returning the stored record with an id.
- **FR-3** List tasks via an HTTP API endpoint, newest first, with an optional `status` filter (`open` / `done`).
- **FR-4** Toggle a task's status (open ↔ done) by id via an HTTP API endpoint.
- **FR-5** Delete a task by id via an HTTP API endpoint.

## 4. Non-Functional Requirements
- **NFR-1** No external runtime dependencies — standard library only (Node stdlib or Python stdlib).
- **NFR-2** List responses return in under 100 ms for up to 1,000 tasks.
- **NFR-3** Reject malformed input (missing title, unknown status, unknown id) with HTTP 400 and a JSON body `{ "error": "<message>", "field": "<name>" }`.

## 5. Out of Scope
- Authentication or multi-user accounts.
- Cloud sync or sharing.
- Editing a task's title after creation (delete + re-add only).
- Due dates, priorities, tags, subtasks.

## 6. Acceptance / Done
- **FR-1** → An added task survives a process restart (persisted to disk and reloaded).
- **FR-2** → POST a valid task returns 201 and the stored record with an id and `status: "open"`.
- **FR-3** → GET the list returns tasks newest-first; filtering by `status=open` returns only open tasks.
- **FR-4** → Toggling an open task returns it as `done`; toggling again returns it as `open`.
- **FR-5** → DELETE an existing id returns 204 and the task no longer lists.
- **NFR-3** → POST with a missing title returns 400 with `{error, field:"title"}`.
