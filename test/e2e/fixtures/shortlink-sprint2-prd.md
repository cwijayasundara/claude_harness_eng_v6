# PRD: Shortlink (sprint 2 — expiry and click counts)

Enhancement against the living sprint-1 system. Same product, same users.
This is the SPDD `/spdd-prompt-update` analog: change the create, redirect,
and list contracts, then generate against the amended Canvas — do not
regenerate the architecture.

Run with `/sprint docs/shortlink-prd-sprint-2.md` after sprint 1 has an
approved `specs/design/` baseline.

## What's new in this sprint

| Id | Class | Change |
|---|---|---|
| FR-2 | changed | Create accepts an optional `expires_at` |
| FR-3 | changed | An expired code returns 410 and must not record a click |
| FR-4 | changed | Each list row shows the exact click count |
| FR-9 | new | One click row per successful 302 (timestamp only, no IP) |
| FR-10 | new | Copy-to-clipboard on each list row |
| FR-1, FR-5–FR-8 | carried | Unchanged from sprint 1 |

Nothing from sprint 1 is dropped.

## 1. Problem & Goal

Members now need to know whether a hand-out was used, and to mint a code that
dies on a date they chose. Success: an expired code returns 410, a live
redirect increments the count shown on the list, and the short URL can be
copied from the console.

## 2. Users & Jobs-to-be-done

- **Member** — same person as sprint 1. Additionally wants to (a) set an
  expiry when minting, (b) see how many times a code was followed, (c) copy
  the short URL.

Still no admin, no teams, no anonymous minting.

## 3. Functional Requirements

- **FR-1** Register and sign in with an email address and a password, receiving an HTTP-only session cookie.
- **FR-2** Create a short link from a target URL while signed in, returning a code of at least seven characters. Accept an optional `expires_at` timestamp at creation; omit it and the link does not expire. There is no API to change expiry after creation.
- **FR-3** Redirect a request for a known, not-deleted, not-expired code to its target URL with HTTP 302. A known code whose `expires_at` is in the past returns 410 permanently, with no revival path and no click recorded.
- **FR-4** List the signed-in member's own links on a console page, newest first, twenty per page. Each row shows the exact click count, computed as a live aggregate over click rows (no denormalized counter). No other member's links appear.
- **FR-5** Delete one of the signed-in member's own links: the response is 204, a later request for that code returns 404, the code is never reissued, and its click rows remain.
- **FR-6** Reject a target URL whose scheme is not `http` or `https`, whose host matches the configured `PUBLIC_BASE_URL`, or whose host is `localhost` or an IP literal in a private (RFC1918), loopback, link-local, unique-local, or cloud-metadata (`169.254.169.254`) range. Inspect the host literally at creation time — no DNS lookup and no outbound fetch.
- **FR-7** Sign out invalidates the session server-side; a later authenticated request returns 401.
- **FR-8** Expose a `/healthz` endpoint that is 200 when the database is reachable and 503 when it is not.
- **FR-9** Record one click event per successful redirect, written before the 302 is returned, holding only a timestamp. Store no IP address and no country code. Missed, expired, and deleted codes write no row.
- **FR-10** Provide a copy-to-clipboard control on each row of the link list that copies the short URL.

## 4. Non-Functional Requirements

- **NFR-1** Create and list responses are p95 under 300 ms for an account holding 100 links.
- **NFR-2** Short codes are drawn from a cryptographically secure random source and carry at least 40 bits of entropy.
- **NFR-3** Passwords are stored using Argon2id and are never written to logs.
- **NFR-4** The console conforms to WCAG 2.2 level AA.
- **NFR-5** The system runs from one `docker compose up` with a single Postgres 16 container and no third-party network calls at build or run time.
- **NFR-6** When the database is unreachable the API returns HTTP 503 with a JSON error body and never a stack trace.
- **NFR-7** Exactly 0 click rows contain an IPv4 or IPv6 address.

## 5. Out of Scope

- Custom or vanity codes — codes are generated, never chosen.
- Editing a link's target or expiry after creation.
- GeoIP, country codes, referrers, charts, or per-day breakdowns.
- Teams, shared ownership, or an admin role.
- Billing, plans, or usage quotas.
- Password reset by email, SSO, and multi-factor authentication.
- Rate limiting.
- Bulk import or export.
- Following redirect chains or resolving hostnames on FR-6.
- Automatic purge of old click rows.
- OpenAPI publication as a required deliverable.

## 6. Acceptance / Done

- **FR-1** → Given a registered email and correct password, when signing in, then the response sets an HTTP-only session cookie and a subsequent authenticated request succeeds.
- **FR-2** → Given a signed-in member, when creating a link with `expires_at` one hour in the future, then the response is 201 and a later GET of that link shows that expiry; when creating without `expires_at`, the link has no expiry.
- **FR-3** → Given a link whose expiry is in the past, when requesting its code, then the response is 410, no click event is recorded, and there is no API to extend the expiry. A not-expired code still returns 302.
- **FR-4** → Given a link with three recorded clicks, when the list page renders, then that row displays a click count of 3. Page 1 of 25 links still returns exactly 20, newest first, owner-only.
- **FR-5** → Given a member's own link that has click rows, when deleting it, then the response is 204, a later request for that code returns 404, the code is not reissued, and the click rows still exist.
- **FR-6** → Given a target of `ftp://example.com`, when creating a link, then the response is 422; the same holds for a host matching `PUBLIC_BASE_URL` and for each of `http://192.168.1.1/`, `http://10.0.0.1/`, `http://127.0.0.1/`, `http://[::1]/`, `http://169.254.169.254/` and `http://localhost/`.
- **FR-7** → Given a signed-in member, when signing out, then a subsequent authenticated request returns 401.
- **FR-8** → Given a reachable database, when fetching `/healthz`, then the response is 200; when the database is stopped, the response is 503.
- **FR-9** → Given a successful 302, when the click table is queried immediately after, then exactly one new row exists carrying a timestamp and no IP address. A 410 or 404 writes no row.
- **FR-10** → Given a link row, when the copy control is activated, then the short URL is on the clipboard and a confirmation is announced to assistive technology.

## 7. Milestones

- **M1 — Expiry holds.** Done when: create with `expires_at` works, an expired code returns 410, and a live code still 302s. (FR-2, FR-3)
- **M2 — Counts and copy.** Done when: three redirects show a count of 3 on the list, copy puts the short URL on the clipboard, and no click row contains an IP. (FR-4, FR-9, FR-10, NFR-7)
