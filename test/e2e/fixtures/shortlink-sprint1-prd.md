# PRD: Shortlink (sprint 1 — mint and redirect)

Small enough for one `/build` → `/auto` session. Complete enough to exercise
SSDD alignment (in/out), a living design, and a draft PR. Sprint 2
(`docs/shortlink-prd-sprint-2.md`) is the enhancement: expiry + click counts
on the same create / redirect / list paths.

## 1. Problem & Goal

People sharing links in chat need a short, stable URL they can hand out and
later revoke. Success: a signed-in member creates a short link, the code
redirects to the target, they can list and delete only their own links.

## 2. Users & Jobs-to-be-done

- **Member** — the only user in this sprint. Wants to (a) register and sign in,
  (b) mint a short code from a target URL, (c) follow that code, (d) see their
  own links, (e) revoke a link, (f) sign out.

There is no admin, no anonymous minting, and no teams.

## 3. Functional Requirements

- **FR-1** Register and sign in with an email address and a password, receiving an HTTP-only session cookie.
- **FR-2** Create a short link from a target URL while signed in, returning a code of at least seven characters.
- **FR-3** Redirect a request for a known, not-deleted code to its target URL with HTTP 302.
- **FR-4** List the signed-in member's own links on a console page, newest first, twenty per page. No other member's links appear.
- **FR-5** Delete one of the signed-in member's own links: the response is 204, a later request for that code returns 404, and the code is never reissued.
- **FR-6** Reject a target URL whose scheme is not `http` or `https`, whose host matches the configured `PUBLIC_BASE_URL`, or whose host is `localhost` or an IP literal in a private (RFC1918), loopback, link-local, unique-local, or cloud-metadata (`169.254.169.254`) range. Inspect the host literally at creation time — no DNS lookup and no outbound fetch.
- **FR-7** Sign out invalidates the session server-side; a later authenticated request returns 401.
- **FR-8** Expose a `/healthz` endpoint that is 200 when the database is reachable and 503 when it is not.

## 4. Non-Functional Requirements

- **NFR-1** Create and list responses are p95 under 300 ms for an account holding 100 links.
- **NFR-2** Short codes are drawn from a cryptographically secure random source and carry at least 40 bits of entropy.
- **NFR-3** Passwords are stored using Argon2id and are never written to logs.
- **NFR-4** The console conforms to WCAG 2.2 level AA.
- **NFR-5** The system runs from one `docker compose up` with a single Postgres 16 container and no third-party network calls at build or run time.
- **NFR-6** When the database is unreachable the API returns HTTP 503 with a JSON error body and never a stack trace.

## 5. Out of Scope

- Custom or vanity codes — codes are generated, never chosen.
- Editing a link's target after creation — delete and recreate.
- Link expiry (sprint 2).
- Click counts, analytics, referrers, charts, or GeoIP (sprint 2 for a count only).
- Teams, shared ownership, or an admin role.
- Billing, plans, or usage quotas.
- Password reset by email, SSO, and multi-factor authentication.
- Rate limiting.
- Bulk import or export.
- Following redirect chains or resolving hostnames on FR-6 (an outbound fetch or DNS lookup would violate NFR-5).
- OpenAPI publication, scheduled purge jobs, and structured request logs as required deliverables.

## 6. Acceptance / Done

- **FR-1** → Given a registered email and correct password, when signing in, then the response sets an HTTP-only session cookie and a subsequent authenticated request succeeds.
- **FR-2** → Given a signed-in member and `https://example.com/a/long/path`, when creating a link, then the response is 201 with a code of at least 7 characters.
- **FR-3** → Given an existing code, when requesting `/{code}`, then the response is 302 with `Location` set to the target URL.
- **FR-4** → Given a member owning 25 links, when listing page 1, then exactly 20 links are returned, newest first, and none belongs to another user.
- **FR-5** → Given a member's own link, when deleting it, then the response is 204, a later request for that code returns 404, and the code is not issued to a new link.
- **FR-6** → Given a target of `ftp://example.com`, when creating a link, then the response is 422; the same holds for a host matching `PUBLIC_BASE_URL` and for each of `http://192.168.1.1/`, `http://10.0.0.1/`, `http://127.0.0.1/`, `http://[::1]/`, `http://169.254.169.254/` and `http://localhost/`.
- **FR-7** → Given a signed-in member, when signing out, then a subsequent authenticated request returns 401.
- **FR-8** → Given a reachable database, when fetching `/healthz`, then the response is 200; when the database is stopped, the response is 503.
- **NFR-2** → Given 10,000 codes generated in one run, when they are inspected, then every code is at least 7 characters drawn from a 62-character alphanumeric alphabet (≥ 41.7 bits), no two are equal, and the bytes come from `secrets` / `os.urandom` rather than the `random` module.
- **NFR-3** → Given a member registering and then signing in, when the stored credential is read, then it begins with `$argon2id$`; and when the application's full log output for those two requests is scanned, then it contains neither the plaintext password nor the stored hash.
- **NFR-5** → Given a clean checkout with no project images cached, when `docker compose up` is run once, then the stack reaches healthy with exactly one Postgres 16 container, and no service makes a request to a host outside the compose network at build or run time.
- **NFR-6** → Given the Postgres container is stopped, when any API endpoint other than `/healthz` is called, then the response is 503 with a JSON body carrying an `error` field, and the body contains no stack trace, exception class name, or filesystem path.
- **NFR-1** and **NFR-4** carry no postcondition here by decision: proving p95 latency needs a load harness and WCAG 2.2 AA needs an accessibility scan, so `/spec` sizes each as its own story.

## 7. Milestones

- **M1 — Redirect works.** Done when: a signed-in member can create a link, be redirected by it, and sign out. (FR-1, FR-2, FR-3, FR-6, FR-7, NFR-2, NFR-3, NFR-5)
- **M2 — Console works.** Done when: the list page shows only the member's links, delete returns 404 on that code, and `/healthz` reports the database. (FR-4, FR-5, FR-8, NFR-1, NFR-4, NFR-6)
