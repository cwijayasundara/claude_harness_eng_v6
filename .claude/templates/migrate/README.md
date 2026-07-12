# Mechanical migrate (Bun Phase B)

Use this directory for **faithful mechanical transforms** (language port, framework swap, monorepo split, large renames) — not for greenfield product design.

## Flow

1. Copy these templates into `specs/migrate/` in the target project (or create the dir and fill them).
2. Draft `MAPPING.md` (pattern → pattern) and optional `CONSTRAINTS.tsv`.
3. **Dual adversarial review** of the mapping artifacts alone (two independent `code-reviewer` instances on the mapping files — or human review for high-risk ports).
4. Record a **3-file canary** in `CANARY.md`; prove tests/lint/types on the canary before fan-out.
5. Fan-out under ownership + behaviour oracle (existing suite must stay green; G31: do not delete/skip tests to pass).

## Entrypoint

Prefer:

```text
/refactor --mechanical
```

which reads `specs/migrate/` and follows the canary → fan-out discipline. Do **not** invent a second BRD→spec pipeline for pure mechanical ports.
