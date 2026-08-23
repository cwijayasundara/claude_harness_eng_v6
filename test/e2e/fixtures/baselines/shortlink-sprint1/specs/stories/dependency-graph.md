# Dependency Graph

## Group A

| Story | Title | Layer | Points | Dependencies |
|---|---|---|---|---|
| E1-S1 | Register and sign in with a hashed, non-logged credential | backend | 8 | — |
| E6-S1 | Expose /healthz reflecting database reachability | backend | 2 | — |
| E7-S1 | Run the whole stack from one docker compose up | infra | 5 | — |

## Group B

| Story | Title | Layer | Points | Dependencies |
|---|---|---|---|---|
| E1-S2 | Sign out invalidates the session server-side | backend | 3 | E1-S1 (behavior) |
| E2-S1 | Create a short link with an SSRF-safe target and a cryptographically random code | backend | 8 | E1-S1 (behavior) |
| E6-S2 | Return a safe 503 JSON envelope when the database is unreachable | backend | 3 | E6-S1 (behavior) |

## Group C

| Story | Title | Layer | Points | Dependencies |
|---|---|---|---|---|
| E3-S1 | Redirect a known code to its target | backend | 3 | E2-S1 (data) |
| E4-S1 | List the signed-in member's own links | fullstack | 5 | E1-S1 (behavior), E2-S1 (data) |
| E5-S1 | Delete a member's own link | backend | 3 | E1-S1 (behavior), E2-S1 (data) |

## Group D

| Story | Title | Layer | Points | Dependencies |
|---|---|---|---|---|
| E4-S2 | Create and list responses stay under a 300ms p95 at 100 links | backend | 5 | E4-S1 (behavior), E2-S1 (behavior) |
| E4-S3 | Console list page meets WCAG 2.2 AA | frontend | 5 | E4-S1 (behavior) |

## Ownership Clusters

- C1: E1-S1, E2-S1, E4-S1, E4-S2, E5-S1 (29 pts)
- C2: E1-S2 (3 pts)
- C3: E3-S1 (3 pts)
- C4: E4-S3 (5 pts)
- C5: E6-S1, E6-S2 (5 pts)
- C6: E7-S1 (5 pts)
