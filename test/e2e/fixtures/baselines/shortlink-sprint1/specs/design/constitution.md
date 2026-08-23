# Architecture Constitution

Cross-sprint invariants this system must never violate — the rules a design
amendment is checked against every sprint, not just the rules for right now.
Human-owned. Edit this file like code: a change to an invariant is itself an
architectural decision and should go through normal PR review.

First authored at sprint-1 design approval. Revisit at each sprint boundary —
`/design --delta`'s design-delta rubric checks every amendment against the
`## Invariants` list below as a hard criterion; violating one fails the
amendment regardless of its weighted score.

## Invariants

<!-- One line per invariant, each independently checkable against a diff or an
     amendment narrative. Delete this comment once populated. Examples: -->

- All schema changes use expand-contract; no destructive migration ships in the same sprint that removes the old column/field.
- Services communicate only through their published API contracts; no service reads another service's database directly.
- Public-facing APIs are REST/JSON only; no GraphQL or gRPC surface for external consumers.

## Amendment History

<!-- Append one line per sprint whenever an invariant is added, changed, or
     removed. Never delete a line — this is the audit trail for why the
     constitution looks the way it does. -->

- Sprint 1: initial invariants established at design approval.
