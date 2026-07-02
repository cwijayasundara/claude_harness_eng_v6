---
name: checking-migration-safety
description: Use when a planned change touches persisted data shape — ORM models, migration files, schema definitions, serialized formats, or message contracts — in /change, /refactor, or /implement on an existing codebase. Routes schema changes through expand-contract and proves reversibility before any deploy. [Internal discipline — applied automatically by pipeline agents mid-task; direct use is a power-user path.]
---

# Checking Migration Safety

Schema changes are the brownfield edits that cannot be reverted with `git checkout`. Code rolls back in seconds; a dropped column does not. The discipline: every schema change ships as a reversible migration, and any change that existing code cannot tolerate runs as expand-contract, never in one step.

## The Iron Law

```
NO DESTRUCTIVE SCHEMA CHANGE IN THE SAME DEPLOY AS THE CODE THAT REQUIRES IT
```

## Step 0 — Does this change need a migration?

Run this check when the planned diff touches any of: ORM models/entities, `migrations/`, `schema.*`, `*.sql`, serializer/DTO field definitions, or queue/event message shapes. If none are touched, exit this skill and proceed.

## Process

1. **Classify the change.**

   | Class | Examples | Risk |
   |---|---|---|
   | Additive | new nullable column, new table, new index (concurrent), new optional field | Safe — old code ignores it |
   | Destructive | drop/rename column or table, narrow a type, add NOT NULL to existing column | Breaks old code or old data |
   | Transform | split/merge columns, change units or encoding, backfill derived values | Breaks both directions until complete |

2. **Additive:** generate the migration, confirm the down-migration exists and actually reverses it, proceed. (An index on a large table must be created concurrently/online — a blocking index build is an outage, not a migration.)

3. **Destructive or Transform: expand-contract.** Plan and execute as separate, independently deployable steps — each step leaves old AND new code working:
   - **Expand:** add the new column/table/field alongside the old. Backfill in batches (bounded, resumable — never one giant UPDATE). New code writes both, reads old.
   - **Migrate reads:** switch reads to the new shape behind a flag or config toggle. Old shape still written.
   - **Contract:** only after the new path has held in production and no consumer reads the old shape, drop the old column/field in its own later migration.
   The contract step never ships in the same release as expand. If the lane is `/change` with a single deploy, deliver expand + migrate-reads only, and file the contract step as explicit follow-up work — do not "save a deploy" by contracting early.

4. **Prove reversibility.** Run the migration **and its down-migration** against a seeded copy of the schema before marking the work done — the harness ships the runner:

   ```bash
   .claude/scripts/migration-roundtrip.sh --ephemeral-postgres   # docker spins a disposable DB
   # or: DATABASE_URL=<disposable-db-url> .claude/scripts/migration-roundtrip.sh
   ```

   It detects the tool (alembic/django/prisma/knex) and runs up → down → up. Exit 0 = proven; exit 1 = a step failed (a real finding — fix the migration); exit 2 = could not prove (prisma has no down migrations; django needs an explicit downgrade target; no DB available) — report exit 2 as "reversibility NOT proven", never as a pass. A down-migration that exists but has never run is documentation, not a rollback path. If the operation is genuinely irreversible (dropped data), say so explicitly in the migration's docstring and in your report — never imply rollback that does not exist.

5. **Check old-code compatibility (N/N+1 rule).** During a rolling deploy, the previous code version runs against the migrated schema. Ask: "does yesterday's code still work on tomorrow's schema?" If no — the change is Destructive; return to step 3.

6. **Cross-service coordination.** If the schema is read by more than one service (check `specs/brownfield/architecture-map.md` and the code graph for readers), every consumer must tolerate the expand state before any contract. List the consumers in your plan; an unlisted consumer found later is a blocked contract step, not a surprise outage.

## Common Rationalizations

| Excuse | Reality |
|---|---|
| "It's just a rename" | A rename is a drop plus an add — the most common destructive change. Expand-contract it (add new, dual-write, contract later). |
| "The table is small, I'll do it in one step" | Table size changes nothing about old code reading a dropped column during the deploy window. |
| "The down-migration is obvious, no need to run it" | Untested rollback paths fail exactly when you need them. Run it once on seeded data. |
| "No one else reads this table" | Prove it from the code graph and architecture map, then write the consumer list down. "I believe" is not evidence. |
| "The ORM auto-generates the migration, so it's safe" | Auto-generated migrations happily emit blocking index builds and NOT NULL on populated columns. Read what it generated. |
| "We can backfill in the migration itself" | A backfill inside a schema migration locks the table for its duration. Batch it as a separate data migration. |
