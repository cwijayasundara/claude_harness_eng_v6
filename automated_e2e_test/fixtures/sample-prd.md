# PRD: Personal Bookmarks

A tiny local bookmarks service used as a fixture for the plan-only smoke. Small
on purpose, but shaped to decompose into a foundation cluster, an API cluster,
and a UI cluster with real dependencies.

## 1. Problem & Goal
A single user wants to save, tag, and find web links from one small local app,
without signing up for anything. Success: add a link and find it again by tag in
under three clicks.

## 2. Users & Jobs-to-be-done
One local user ("me") who wants to (a) stash a URL with a note, (b) organize
links with tags, and (c) retrieve links later by tag.

## 3. Functional Requirements
- **FR-1** Persist bookmarks (url, title, note, tags, created-at) in a local store.
- **FR-2** Add a bookmark via an HTTP API endpoint.
- **FR-3** List all bookmarks via an HTTP API endpoint, newest first.
- **FR-4** Delete a bookmark by id via an HTTP API endpoint.
- **FR-5** Filter the listed bookmarks by a tag via the API.
- **FR-6** A single web page that shows the bookmark list and a form to add one.

## 4. Non-Functional Requirements
- **NFR-1** No external runtime dependencies; runs on Node's standard library only.
- **NFR-2** API list responses return in under 100 ms for up to 1,000 bookmarks.
- **NFR-3** Reject malformed input (missing url, non-array tags) with HTTP 400.

## 5. Out of Scope
- Authentication or multi-user accounts.
- Cloud sync or sharing.
- Editing a bookmark after creation (delete + re-add only).
- Browser extension or import from existing browsers.

## 6. Acceptance / Done
- **FR-1** → A added bookmark survives a process restart (persisted to disk).
- **FR-2** → POST a valid bookmark returns 201 and the stored record with an id.
- **FR-3** → GET the list returns all bookmarks, most recent first.
- **FR-4** → DELETE an existing id returns 204 and the record no longer lists.
- **FR-5** → GET the list filtered by a tag returns only bookmarks with that tag.
- **FR-6** → The page renders the current list and adding via the form shows the new bookmark without a manual reload.
