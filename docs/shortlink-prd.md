# PRD: Shortlink

A small multi-user link shortener with a web console — the **mid-sized** fixture
for exercising the whole pipeline end to end.

Sized on purpose. `docs/todo-list-prd.md` (8 requirements) and
`test/e2e/fixtures/counter-prd.md` (3) are smoke fixtures: too small to produce
epics, clusters, mockups or a real dependency graph, so most of the harness never
runs. A 100-requirement product PRD is the opposite problem — one pass costs
hours and a hundred dollars, so nothing gets tested twice. This document is
deliberately in between: **24 requirements, one requirement in each of the ten
taxonomy slots, a UI surface, and three milestones**, which is enough to make
`/spec` produce real epics and clusters, `/design` produce contracts and mockups,
`/test` produce Playwright specs, and `/auto` produce a working app — while
still finishing in one sitting.

Use it to test the harness. Do not use it to test your product ideas.

## 1. Problem & Goal

People sharing links in chat and slides need short, stable URLs they can hand out
and later revoke, plus a rough sense of whether anyone clicked. Existing services
are either free-with-ads or enterprise-priced, and neither can be self-hosted.

Success: a signed-in user creates a short link in under five seconds, the link
redirects reliably, and they can see its click count and delete it.

## 2. Users & Jobs-to-be-done

- **Member** — the everyday user. Wants to (a) shorten a URL, (b) find their
  links again, (c) see whether a link is being used, (d) revoke a link.
- **Admin** — one operator per deployment. Wants to see every link in the system
  and remove abusive ones.

## 3. Scope

One web application: a Postgres-backed API and a browser console, deployed as a
single Docker Compose stack. Two roles (member, admin). No teams, no billing, no
custom domains.

## 4. Functional Requirements

- **FR-1** Register and sign in with an email address and a password, receiving an HTTP-only session cookie.
- **FR-2** Create a short link from a target URL, returning a code of at least seven characters.
- **FR-3** Redirect a request for a known code to its target URL with HTTP 302.
- **FR-4** List the signed-in user's own links, newest first, twenty per page.
- **FR-5** Delete one of the signed-in user's own links; a deleted code stops redirecting.
- **FR-6** Set an optional expiry timestamp on a link at creation time; an expired code stops redirecting.
- **FR-7** Record one click event per successful redirect, holding the timestamp and a two-letter country code.
- **FR-8** Show the total click count for each link on the list page.
- **FR-9** Reject a target URL whose scheme is not `http` or `https`, and reject a target pointing at the service's own host.
- **FR-10** Publish an OpenAPI 3.1 schema at `/openapi.json` describing every public endpoint.
- **FR-11** Expose a `/healthz` endpoint reporting whether the database is reachable.
- **FR-12** Emit one structured JSON log line per HTTP request carrying a request id, method, path, status and duration.
- **FR-13** Delete click events older than ninety days on a scheduled job.
- **FR-14** Let an admin list every link in the system and delete any of them.
- **FR-15** Make the link list page fully operable by keyboard alone, with a visible focus indicator on every interactive element.
- **FR-16** Provide a copy-to-clipboard control on each row of the link list.

## 5. Non-Functional Requirements

- **NFR-1** Redirects respond at p95 under 50 ms while sustaining 100 requests per second.
- **NFR-2** The link list page responds at p95 under 300 ms for an account holding 1,000 links.
- **NFR-3** Short codes are drawn from a cryptographically secure random source and carry at least 40 bits of entropy.
- **NFR-4** Passwords are stored using Argon2id and are never written to logs.
- **NFR-5** Click events store no raw IP address: the country is derived in-request and the address discarded before the row is written, so exactly 0 stored rows contain an IP address.
- **NFR-6** The console conforms to WCAG 2.2 level AA.
- **NFR-7** The whole system runs from one `docker compose up` with a single Postgres 16 container and no third-party network calls.
- **NFR-8** When the database is unreachable the API returns HTTP 503 with a JSON error body and never a stack trace.

## 6. Acceptance

- **FR-1** → Given a registered email and correct password, when signing in, then the response sets an HTTP-only session cookie and a subsequent authenticated request succeeds.
- **FR-2** → Given a signed-in member and `https://example.com/a/long/path`, when creating a link, then the response is 201 with a code of at least 7 characters.
- **FR-3** → Given an existing code, when requesting `/{code}`, then the response is 302 with `Location` set to the target URL.
- **FR-4** → Given a member owning 25 links, when listing page 1, then exactly 20 links are returned, newest first, and none belongs to another user.
- **FR-5** → Given a member's own link, when deleting it, then the response is 204 and a later request for that code returns 404.
- **FR-6** → Given a link whose expiry is in the past, when requesting its code, then the response is 410 and no click event is recorded.
- **FR-7** → Given a successful redirect, when the click table is queried, then exactly one new row exists carrying a timestamp and a two-letter country code.
- **FR-8** → Given a link with three recorded clicks, when the list page renders, then that row displays a click count of 3.
- **FR-9** → Given a target of `ftp://example.com`, when creating a link, then the response is 422; the same holds for a target pointing at the service's own host.
- **FR-10** → Given a running service, when fetching `/openapi.json`, then the response is a valid OpenAPI 3.1 document naming every public endpoint.
- **FR-11** → Given a reachable database, when fetching `/healthz`, then the response is 200; when the database is stopped, the response is 503.
- **FR-12** → Given any HTTP request, when the log stream is read, then it contains one JSON line for that request carrying request id, method, path, status and duration.
- **FR-13** → Given a click event dated 91 days ago and one dated 89 days ago, when the purge job runs, then only the 89-day-old event remains.
- **FR-14** → Given an admin and a link owned by another user, when the admin lists links, then that link appears; when the admin deletes it, its code stops redirecting.
- **FR-15** → Given the link list page, when navigating by Tab alone, then every control is reachable, actionable by Enter or Space, and shows a visible focus ring.
- **FR-16** → Given a link row, when the copy control is activated, then the short URL is on the clipboard and a confirmation is announced to assistive technology.
- **NFR-8** → Given a stopped database, when any API endpoint is called, then the response is 503 with a JSON error body and the response contains no stack trace.

## 7. Out of Scope

- Custom or vanity domains — codes are generated, never chosen.
- Teams, shared ownership, or per-link permissions beyond owner and admin.
- Billing, plans, or usage quotas.
- Editing a link's target after creation; delete and recreate instead.
- Click analytics beyond a total count — no referrers, no charts, no per-day breakdown.
- Password reset by email, SSO, and multi-factor authentication.
- Bulk import or export of links.

## 8. Milestones

- **M1 — Redirect works.** Done when: a signed-in member can create a link and be redirected by it. (FR-1, FR-2, FR-3, FR-9, NFR-3, NFR-4, NFR-7)
- **M2 — Console works.** Done when: the list page shows a member's links with click counts and delete and copy both work by keyboard. (FR-4, FR-5, FR-7, FR-8, FR-15, FR-16, NFR-2, NFR-6)
- **M3 — Operable.** Done when: expiry, admin removal, retention purge, health, logging and the schema are all live and verified. (FR-6, FR-10, FR-11, FR-12, FR-13, FR-14, NFR-1, NFR-5, NFR-8)

## 9. Risks

- Risk (Medium) — Redirect latency is dominated by the database round trip, so NFR-1 may force a cache the design has not planned for. Measure before optimising.
- Risk (Medium) — Country derivation (FR-7, NFR-5) needs a geo lookup, which conflicts with NFR-7's no-third-party-calls constraint unless a local dataset is bundled.
- Risk (Low) — Open-redirect abuse is the standard failure mode of a shortener; FR-9 is the only control and it is easy to implement incompletely.

## 10. Open Questions

- Should an expired link return 410 permanently, or should the owner be able to revive it by extending the expiry?
- Is the admin a database-seeded account, or should the first registered user be promoted automatically?
- Should click counts be exact, or is an approximate count acceptable in exchange for meeting NFR-1 without a cache?
