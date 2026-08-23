# Test Plan

Scope: 11 stories, 38 acceptance criteria.
Machine spine: `verification-matrix.json` (one row per AC). Behavior scenarios are that list in Given/When/Then — not extra cases, not Cucumber, not AT source.

## Named Seams (Ports-and-Adapters)

| Story | Seam (port) | Real adapter | Test-double adapter |
| --- | --- | --- | --- |
| E1-S1 | `auth_service.py` → `member_repository.py` / `session_repository.py` | Postgres-backed repositories | 4 |
| E1-S2 | `auth_service.py` → `session_repository.py` (revoke) | Postgres-backed `session_repository.py` | 3 |
| E2-S1 | `link_service.py` (target validation + code gen) → `link_repository.py` | Postgres-backed `link_repository.py` | 5 |
| E3-S1 | redirect handler (`api/links.py`) → `link_repository.py` (read-only) | Postgres-backed `link_repository.py` | 3 |
| E4-S1 | `link_service.py` (list/paginate) → `link_repository.py` | Postgres-backed `link_repository.py`, seeded with 25 rows | 4 |
| E4-S2 | `link_service.py` (create + list) → `link_repository.py`, under load | Postgres-backed `link_repository.py`, seeded with 100 rows | 3 |
| E4-S3 | console list page → `link_service.py` (read) | Rendered page in a real browser (Playwright, Chromium) | 3 |
| E5-S1 | `link_service.py` (soft-delete) → `link_repository.py` | Postgres-backed `link_repository.py` | 4 |
| E6-S1 | health check handler → `repository/db.py` connectivity probe | Real Postgres connection pool | 3 |
| E6-S2 | global error-handling middleware → `repository/db.py` | Real Postgres connection pool (stopped/restarted) | 3 |
| E7-S1 | compose network boundary → service containers | Running `docker compose` stack | 3 |

## Behavior scenarios (Given / When / Then)

Human-reviewed behavior spec. Implement-time ATs match this wording. Do not write `.feature` or AT source here.

| AC | Matrix | Given | When | Then |
| --- | --- | --- | --- | --- |
| E1-S1-AC1 | VM-001 | a registered email and correct password | signing in | the response sets an HTTP-only session cookie and a subsequent authenticated request succeeds |
| E1-S1-AC2 | VM-002 | a member registering with a new email and password | the stored credential is read back | it begins with `$argon2id$` |
| E1-S1-AC3 | VM-003 | a member registering and then signing in | the application's full log output for those two requests is scanned | it contains neither the plaintext password nor the stored hash |
| E1-S1-AC4 | VM-004 | an unregistered email or a wrong password | signing in | the response is 401 and no session cookie is set |
| E1-S2-AC1 | VM-005 | a signed-in member | signing out | a subsequent authenticated request returns 401 |
| E1-S2-AC2 | VM-006 | a signed-in member who has just signed out | the same session cookie from before sign-out is replayed | the request is rejected with 401 rather than succeeding, because the session was invalidated server-side and not merely cleared client-side |
| E1-S2-AC3 | VM-007 | a request with no active session | calling sign-out | the response is 401 and no server state changes |
| E2-S1-AC1 | VM-008 | a signed-in member and `https://example.com/a/long/path` | creating a link | the response is 201 with a code of at least 7 characters |
| E2-S1-AC2 | VM-009 | a target of `ftp://example.com` | creating a link | the response is 422; the same holds for a host matching PUBLIC_BASE_URL and for each of `http://192.168.1.1/`, `http://10.0.0.1/`, `http://127.0.0.1/`, `http://[::1]/`, `http://169.254.169.254/` and `http://localhost/` |
| E2-S1-AC3 | VM-010 | the host-validation code path | a target URL is inspected during creation | only literal scheme/host/IP-range checks run — no DNS lookup and no outbound network fetch occurs |
| E2-S1-AC4 | VM-011 | 10,000 codes generated in one run | they are inspected | every code is at least 7 characters drawn from a 62-character alphanumeric alphabet (>= 41.7 bits), no two are equal, and the bytes come from `secrets`/`os.urandom` rather than the `random` module |
| E2-S1-AC5 | VM-012 | a request with no valid session | creating a link | the response is 401 and no link row is created |
| E3-S1-AC1 | VM-013 | an existing code | requesting `/{code}` | the response is 302 with `Location` set to the target URL |
| E3-S1-AC2 | VM-014 | a code that was never issued | requesting `/{code}` | the response is 404 |
| E3-S1-AC3 | VM-015 | the redirect handler | it resolves a code to a target URL | it returns the Location header to the caller without itself following or fetching the target URL |
| E4-S1-AC1 | VM-016 | a member owning 25 links | listing page 1 | exactly 20 links are returned, newest first, and none belongs to another user |
| E4-S1-AC2 | VM-017 | a member owning 25 links | listing page 2 | the remaining 5 links are returned, newest-first order preserved across the page boundary |
| E4-S1-AC3 | VM-018 | a member with zero links | opening the console list page | the page renders an empty state with no links and no error |
| E4-S1-AC4 | VM-019 | two members who each own links | the second member requests the list endpoint | only the second member's own links appear — never the first member's |
| E4-S2-AC1 | VM-020 | an account holding 100 links | calling the create-link endpoint repeatedly | the p95 response time across the sample is under 300 ms |
| E4-S2-AC2 | VM-021 | an account holding 100 links | calling the list endpoint for page 1 repeatedly | the p95 response time across the sample is under 300 ms |
| E4-S2-AC3 | VM-022 | the load-test harness | it seeds 100 links and samples both endpoints in one run | it writes a single machine-readable report recording both p95 figures for the evaluator to check |
| E4-S3-AC1 | VM-023 | the rendered console list page | it is scanned with an automated WCAG 2.2 AA checker (e.g. axe) | zero level-A or level-AA violations are reported |
| E4-S3-AC2 | VM-024 | the console list page | operated with keyboard only, no mouse | every interactive element (pagination, delete action) is reachable and operable in a visible focus order |
| E4-S3-AC3 | VM-025 | the console list page | its text and interactive elements are measured for contrast | every element meets the WCAG 2.2 AA minimum contrast ratio |
| E5-S1-AC1 | VM-026 | a member's own link | deleting it | the response is 204 |
| E5-S1-AC2 | VM-027 | a member's own link that was just deleted | requesting that code again | the response is 404 |
| E5-S1-AC3 | VM-028 | a deleted code | a new link is created | the deleted code is never reissued to the new link |
| E5-S1-AC4 | VM-029 | a link owned by another member | the signed-in member attempts to delete it | the response is 404, not 204, and the other member's link is unaffected |
| E6-S1-AC1 | VM-030 | a reachable database | fetching `/healthz` | the response is 200 |
| E6-S1-AC2 | VM-031 | the database is stopped | fetching `/healthz` | the response is 503 |
| E6-S1-AC3 | VM-032 | `/healthz` is called | the response body is inspected | no authentication was required and the body is JSON describing database status |
| E6-S2-AC1 | VM-033 | the Postgres container is stopped | any API endpoint other than `/healthz` is called | the response is 503 with a JSON body carrying an `error` field |
| E6-S2-AC2 | VM-034 | the same 503 response | the body is inspected | it contains no stack trace, exception class name, or filesystem path |
| E6-S2-AC3 | VM-035 | the database becomes reachable again | the same endpoint is called | the response returns to its normal, non-503 status |
| E7-S1-AC1 | VM-036 | a clean checkout with no project images cached | `docker compose up` is run once | the stack reaches healthy with exactly one Postgres 16 container |
| E7-S1-AC2 | VM-037 | the stack is running | build and runtime network traffic is inspected | no service makes a request to a host outside the compose network |
| E7-S1-AC3 | VM-038 | the compose file | it is reviewed | it defines exactly one Postgres 16 service and no other third-party managed service |

## Proposed sprint-contract checks

Evaluator QA procedure (`api` / `playwright`). Fill Observe (method/path or UI steps). Do not write `sprint-contracts/*.json` or Playwright files in this phase.

| Group | Check id | Kind | Matrix ids | Observe |
| --- | --- | --- | --- | --- |
| A | QA-VM-001 | api | VM-001 | `POST /auth/sign-in` with a registered email/password, then `GET /links` with the returned cookie; assert `Set-Cookie` present and the follow-up call is 200 |
| A | QA-VM-002 | api | VM-002 | `POST /auth/register`, then read the stored `Member` row via a test DB fixture; assert the credential column starts with `$argon2id$` |
| A | QA-VM-003 | api | VM-003 | `POST /auth/register` then `POST /auth/sign-in`; scan captured application log output for the plaintext password and the stored hash string, assert neither appears |
| A | QA-VM-004 | api | VM-004 | `POST /auth/sign-in` with an unregistered email, then with a wrong password; assert 401 and no `Set-Cookie` on both |
| B | QA-VM-005 | api | VM-005 | `POST /auth/sign-out` with a valid session cookie, then `GET /links` with the same cookie; assert the follow-up is 401 |
| B | QA-VM-006 | api | VM-006 | `POST /auth/sign-out`, then replay the same cookie on `GET /links`; assert 401, not 200 |
| B | QA-VM-007 | api | VM-007 | `POST /auth/sign-out` with no cookie; assert 401 and no session-row change in the DB fixture |
| B | QA-VM-008 | api | VM-008 | `POST /links` with a valid session and `targetUrl: https://example.com/a/long/path`; assert 201 and `code.length >= 7` |
| B | QA-VM-009 | api | VM-009 | `POST /links` once per disallowed target (`ftp://...`, `PUBLIC_BASE_URL` host, `192.168.1.1`, `10.0.0.1`, `127.0.0.1`, `[::1]`, `169.254.169.254`, `localhost`); assert 422 on each |
| B | QA-VM-010 | api | VM-010 | `POST /links` across the same safe/unsafe host set with a DNS-resolver and outbound-HTTP-client spy installed; assert zero resolver/network calls during validation |
| B | QA-VM-011 | api | VM-011 | Invoke the code-generation path 10,000 times in a batch test script (not per-HTTP-call); assert alphabet, `length >= 7`, uniqueness, and that bytes originate from `secrets`/`os.urandom` |
| B | QA-VM-012 | api | VM-012 | `POST /links` with no session cookie; assert 401 and no new row in the `Link` table |
| C | QA-VM-013 | api | VM-013 | `GET /{code}` for a code created via `POST /links`; assert 302 with `Location` equal to the target URL |
| C | QA-VM-014 | api | VM-014 | `GET /{code}` for a code that was never issued; assert 404 |
| C | QA-VM-015 | api | VM-015 | `GET /{code}` with an outbound-fetch spy installed; assert the handler never itself calls the target URL while resolving the redirect |
| C | QA-VM-016 | playwright | VM-016 | Sign in as a member seeded with 25 links, open the console list page; assert exactly 20 rows, newest-first, none from another member |
| C | QA-VM-017 | playwright | VM-017 | From the same seeded member, activate the page-2 control; assert the remaining 5 links render in the same newest-first order |
| C | QA-VM-018 | playwright | VM-018 | Sign in as a member with zero links, open the console list page; assert an empty-state message renders and no error banner appears |
| C | QA-VM-019 | api | VM-019 | Seed two members with their own links; `GET /links` as the second member; assert only the second member's links are present |
| D | QA-VM-020 | api | VM-020 | Seed an account with 100 links; call `POST /links` repeatedly (fixed sample size); assert p95 latency < 300ms |
| D | QA-VM-021 | api | VM-021 | Seed an account with 100 links; call `GET /links?page=1` repeatedly (fixed sample size); assert p95 latency < 300ms |
| D | QA-VM-022 | api | VM-022 | Run the load-test harness script once (seeds 100 links, samples both endpoints); assert it writes a single JSON report file recording both p95 figures |
| D | QA-VM-023 | playwright | VM-023 | Run an axe-core scan against the rendered console list page; assert zero level-A/AA violations |
| D | QA-VM-024 | playwright | VM-024 | Tab through the console list page using only the keyboard; assert pagination and delete controls are reachable/operable with a visible focus indicator |
| D | QA-VM-025 | playwright | VM-025 | Run an automated contrast-ratio check (axe or equivalent) against the console list page; assert every element meets WCAG 2.2 AA minimum contrast |
| C | QA-VM-026 | api | VM-026 | `DELETE /links/{code}` for a link owned by the signed-in member; assert 204 |
| C | QA-VM-027 | api | VM-027 | `GET /{code}` immediately after deleting that code; assert 404 |
| C | QA-VM-028 | api | VM-028 | After deleting a code, create new links repeatedly (fixed sample size); assert the deleted code is never reissued |
| C | QA-VM-029 | api | VM-029 | `DELETE /links/{code}` for a link owned by a different member; assert 404 (not 204) and that a follow-up `GET /{code}` by the owner still redirects normally |
| A | QA-VM-030 | api | VM-030 | `GET /healthz` with the DB container running; assert 200 with a JSON body |
| A | QA-VM-031 | api | VM-031 | Stop the Postgres container, then `GET /healthz`; assert 503 |
| A | QA-VM-032 | api | VM-032 | `GET /healthz` with no auth header/cookie; assert 200 and a JSON body describing `status`/`database` |
| B | QA-VM-033 | api | VM-033 | Stop the Postgres container, then call a non-`/healthz` endpoint (e.g. `GET /links`); assert 503 with a JSON body carrying `error` |
| B | QA-VM-034 | api | VM-034 | Inspect the body of that 503 response; assert no stack trace, exception class name, or filesystem path substring appears |
| B | QA-VM-035 | api | VM-035 | Restart the Postgres container, then call the same endpoint again; assert it returns to its normal (non-503) status |
| A | QA-VM-036 | api | VM-036 | From a clean checkout with no cached images, run `docker compose up -d` once; assert the stack reports healthy with exactly one `postgres:16` container |
| A | QA-VM-037 | api | VM-037 | While the stack runs, capture build and runtime network traffic; assert no request leaves the compose network to an external host |
| A | QA-VM-038 | api | VM-038 | Statically review `docker-compose.yml`; assert exactly one Postgres 16 service block and no other third-party managed service |

## What Is Explicitly Untested (and why)

| Area | Reason |
| --- | --- |
| Rate limiting on any endpoint | Explicitly out of scope for this sprint (SG-8); no AC requires it |
| CSRF token handling | D-4 relies on same-origin Next.js Route Handlers instead of a CSRF token; no AC exercises cross-origin request forgery |
| Cross-browser/device matrix for the console UI | The Playwright a11y/keyboard/contrast checks (E4-S3) run Chromium only; no AC specifies multi-browser support |
| Load/scale beyond the 100-link, single-account sample | E4-S2's ACs bound performance to one seeded account with 100 links; no AC calls for concurrent-user or larger-dataset load testing |
| Team/tracker integrations | Out of scope per project charter (no team integrations, no tracker) — nothing in the story set exercises them |

## Environment Assumptions & Sprint Pass/Fail

- Postgres 16 runs via `docker compose`; the backend is reachable at its compose service address, and the Next.js Route Handlers call it server-side only (never the browser directly), per D-1.
- Each api/playwright check runs against a freshly seeded or reset database — no cross-test data bleed. E4-S1/E4-S2 checks seed a dedicated account (25 links / 100 links respectively) that isn't shared with other fixtures.
- `PUBLIC_BASE_URL` is set in the test environment to a host distinct from the URLs used as unsafe-target test cases, so VM-009 exercises the real host-match rule.
- E6-S1/E6-S2 checks that stop Postgres do so via the compose container (`docker compose stop db` or equivalent) and restart it for recovery checks — no other service is disrupted.
- Sprint pass/fail: all 38 proposed checks (groups A–D) must pass under `contract-freeze.js`; a failing `test-grounding.json` or `verification-matrix` gate blocks sign-off. The five untested areas above are accepted exclusions, not failures.

## Test Levels

- **unit** / **api** / **e2e** as tagged on each matrix row. Unit rows stay on the seam; they are not evaluator checks.

