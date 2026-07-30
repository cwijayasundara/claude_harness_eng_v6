# publish-to-jira.js

**Date:** 2026-06-28
**Status:** Approved (design)
**Scope:** The split-off greenfield piece from fix #3. Let the PRD-planning phase
create groomed group issues on **Jira** (Linear-only today) so
`/tracker-publish --provider jira` works end-to-end.

## Problem

`/tracker-publish`'s argument-hint advertises `--provider linear|jira`, but only
`publish-to-linear.js` exists. The Jira **runtime** adapter (`symphony_clone/
src/tracker/jira.js`: `listCandidates`/`moveIssue`/`addComment`) already works —
the gap is **issue creation**: nothing turns the approved dependency groups into
Jira issues. So "Jira drives the SDLC" holds for execution but not for the
greenfield grooming step.

## Decisions (from brainstorming)

- **Self-contained script**, mirroring `publish-to-linear.js` (which has its own
  inline GraphQL client, not symphony's `linear.js`). `symphony_clone/` is not
  copied into target projects, so the needed Jira helpers (`textToAdf`,
  `basicAuth`) are **ported**, not imported.
- **Create + transition to the ready state.** Jira can't set a status at creation
  (unlike Linear's `stateId`), so after `POST /issue` the script transitions the
  new issue into the configured ready state — matching `publish-to-linear`'s
  behavior (issues land claimable). If no matching transition exists, **warn and
  continue** (operator moves it); don't fail the whole publish.
- **No blocker relations.** `publish-to-linear` sets none (group dependencies are
  not encoded as tracker blockers); `publish-to-jira` matches. (Shared
  pre-existing limitation, out of scope here.)
- **Testability improvement:** factor the per-group create+transition into an
  `publishGroups(...)` taking an **injectable `request`**, so the core is
  unit-tested without network — a small structural improvement over
  `publish-to-linear`'s monolithic `main()`.

## Architecture

### New: `.claude/skills/tracker-publish/scripts/publish-to-jira.js`

Self-contained, mirroring `publish-to-linear.js`'s shape.

**Pure / ported helpers**

- `textToAdf(text)` → Atlassian Document Format `{ type:'doc', version:1, content:
  [paragraphs] }` (ported verbatim from `jira.js`).
- `basicAuth(user, token)` → `Buffer.from('user:token').toString('base64')`
  (ported from `http.js`).
- `looksAlreadyPublished(group)` → reuse the same idempotency predicate
  `publish-to-linear` uses (a group with a `tracker_key` is already published).

**Core (injectable `request` + `readBody`, unit-tested)**

```
publishGroups(trackerMap, config, { request, readBody, dryRun }) -> { created, skipped, warnings }
```

Both `request` (network) and `readBody(group) -> string` (the group's body_file
contents) are injected, so `publishGroups` does no `fetch` and no `fs` directly —
the CLI passes the real `fetch`-based `request` and an `fs`-based `readBody`; tests
pass stubs. For each group in `trackerMap.groups` that is not already published:
1. `readBody(group)` for its description (CLI default reads the group's
   `body_file`, same convention as the Linear publisher);
2. `dryRun` → record and continue (no request);
3. `request('POST', '/rest/api/3/issue', { fields: { project: { key:
   config.projectKey }, summary: group.title, description: textToAdf(body),
   issuetype: { name: config.issueType }, labels: group.labels || [] } })` →
   `{ id, key, self }`;
4. **transition to ready:** `request('GET', '/rest/api/3/issue/<id>/transitions')`
   → find a transition whose target/name matches `config.readyState` (with the
   `jira.js` fallback-candidates idiom); if found, `request('POST',
   '/rest/api/3/issue/<id>/transitions', { transition: { id } })`; if not, push a
   warning and leave the issue in its default status;
5. mutate the group in `trackerMap`: `tracker_key = key`, `tracker_id = id`,
   `url = <browse url>`; propagate `tracker_key` to the group's stories.

Returns `{ created: [...], skipped: [...], warnings: [...] }`. No direct `fetch`
or `fs` — all network goes through `request`, all body reads through `readBody`.

**CLI (`require.main`)**

- Read `.claude/state/tracker-map.json` + `.claude/tracker-config.json`.
- Resolve config: `baseUrl` + `projectKey` (+ `issueType`, default `Task`) from
  `tracker-config.tracker` (or `trackerMap.config_snapshot`); `readyState` from
  the same precedence `publish-to-linear` uses. Auth from env `JIRA_EMAIL` +
  `JIRA_API_TOKEN`. Abort with a clear message if any of email/token/baseUrl/
  projectKey is missing or a `replace-with-` placeholder (mirrors the Linear
  `project_slug` guard).
- Build the real `request(method, path, body)` = `fetch(baseUrl + path, { method,
  headers: { Authorization: 'Basic ' + basicAuth(email, token), Accept/Content-
  Type: application/json }, body: JSON.stringify(body) })` with a non-2xx →
  throw-with-status (mirrors `http.js#restRequest`).
- Call `publishGroups`, write the mutated `tracker-map.json` (unless `--dry-run`),
  print the same `created/skipped` summary the Linear publisher prints, and any
  transition warnings.
- Parse `--dry-run` (same `parseArgs` shape).

### Changed: `.claude/templates/tracker-config.template.json`

Add an optional `jira` configuration so an operator can set `provider: "jira"` —
within `tracker`, a `base_url`, `project_key`, and `issue_type` (snake_case,
consistent with the existing `ready_state`/`ready_label` keys). Additive; the
default `provider` stays `linear`.

### Changed: `.claude/skills/tracker-publish/SKILL.md`

Document that `--provider jira` runs `publish-to-jira.js` (the argument-hint
already advertises `linear|jira`); note the env vars (`JIRA_EMAIL`,
`JIRA_API_TOKEN`) and the `tracker.base_url`/`project_key` config. The map shape
and `--granularity` semantics are unchanged — the publisher just creates one Jira
issue per `groups` entry, exactly as the Linear publisher does.

### Changed: `symphony_clone/README.md`

Correct the stale "Jira is a stub" line: the runtime Jira adapter is fully
implemented, and Jira **issue-creation** now exists too (`publish-to-jira.js`).

## Data flow

```
/tracker-publish --provider jira
  └─ (skill writes tracker-map.json as today) ──► publish-to-jira.js
        read tracker-map + tracker-config + JIRA_EMAIL/JIRA_API_TOKEN
        publishGroups(map, config, { request: fetch-based }):
          per unpublished group:
            POST /rest/api/3/issue  (ADF body)        ──► {id,key}
            GET  /issue/{id}/transitions → find ready
            POST /issue/{id}/transitions {id}          (move to ready)
              └─ no match → warn, leave in default status
            mutate group: tracker_key/id/url
        write tracker-map.json (unless --dry-run), print summary + warnings
```

## Error handling

- **Missing `JIRA_EMAIL`/`JIRA_API_TOKEN`, `base_url`, or `project_key`** (or a
  `replace-with-` placeholder) → clear error, abort before any request.
- **Issue create fails** (non-2xx) → throw (abort the publish), surfacing the Jira
  status + body — same fail-loud posture as `publish-to-linear`.
- **Transition to ready not found** → warning, the issue is left in its default
  status, the publish continues; the summary lists which issues need a manual
  move. One workflow mismatch never blocks the rest.
- **Already-published group** (has `tracker_key`) → skipped (idempotent re-run).
- **`--dry-run`** → no `POST`, no file write; prints what would be created.

## Testing

`test/publish-to-jira.test.js` (node:test), using an injected `request` stub
recording calls and returning canned responses — no network:

- create: one unpublished group → `POST /rest/api/3/issue` with
  `project.key`/`summary`/ADF `description`/`issuetype.name`/`labels`; group gets
  `tracker_key`/`url`.
- transition: after create, `GET` transitions then `POST` the one matching
  `readyState`; the issue moves to ready.
- no-transition: when no transition matches `readyState` → a warning is recorded
  and **no throw**; the group is still created.
- idempotency: a group already carrying `tracker_key` → skipped, no `POST`.
- dry-run: `{ dryRun: true }` → no `POST`/transition calls; group unchanged.
- `textToAdf` → correct `{type:'doc',version:1,content:[paragraph...]}` shape
  (incl. an empty line → empty-content paragraph).
- `basicAuth` → base64 of `email:token`.

## Out of scope

- The runtime Jira adapter (already implemented); the brownfield tracker path
  (fix #3 files one issue directly — no publish step); Azure issue-creation;
  setting blocker relations (neither publisher does).
