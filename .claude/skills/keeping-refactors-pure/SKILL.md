---
name: keeping-refactors-pure
description: Use when committing any change that includes structural work (rename, move, extract, reorder) in an existing codebase — keeps refactor commits behavior-free and behavior commits refactor-free so regressions stay attributable.
---

# Keeping Refactors Pure

Tangled commits are how agents break brownfield code: published analyses show refactorings mixed into behavior fixes strongly correlate with broken builds, and renames routinely miss call sites. Purity makes every regression attributable to exactly one commit.

## The Iron Law

```
A REFACTOR COMMIT CHANGES NO BEHAVIOR; A BEHAVIOR COMMIT REFACTORS NOTHING
```

## Process

1. **Classify every hunk** before committing: *structural* (rename, move, extract, formatting, dead-code removal) or *behavioral* (any observable difference). Mixed staging → split into two commits, structural first. An **urgent** behavioral bug discovered mid-refactor goes further: onto its own hotfix branch off main (issue filed and cited), so the fix ships on the smallest review while the refactor stays pure.
2. **In a refactor commit:**
   - All existing tests and pin-down snapshots pass **byte-identical** — no snapshot updates, no test edits, no assertion changes.
   - Every renamed/moved symbol: enumerate its callers from `specs/brownfield/code-graph.json` (`edges` targeting the symbol's file) and verify each call site updated. No orphaned imports or dead copies left behind.
   - If an OpenAPI spec exists: run `npm run contract-drift` (it also fires automatically in `/gate` when the OpenAPI spec changes). It runs `oasdiff breaking` against the git-base spec and must report zero breaking changes; a breaking verdict blocks.
3. **In a behavior commit:** a test may be *updated* (not deleted) only with the authorizing story/issue cited in the commit message.
4. **Ratchet:** test count and changed-line coverage (`diff-cover --fail-under`) may not decrease in either commit type.

## Common Rationalizations

| Excuse | Reality |
|---|---|
| "I'll fix that little bug while I'm in here" | That converts an attributable refactor into an unattributable mixed change. Separate commit. |
| "The test needed a tiny update for the rename" | A pure rename never changes assertions. If it did, behavior moved. |
| "Splitting commits is ceremony" | Bisecting a tangled regression costs hours; splitting costs seconds. |
| "I updated the snapshot because the output is equivalent" | Equivalent-but-different output IS a behavior change. Prove it in a behavior commit. |
| "The git log is full of mixed commits and nobody complained" | Survivorship bias — nobody complains until the first tangled bisect on a money path. Precedent is not justification. |
| "The bug is urgent, splitting delays the fix" | Urgency argues FOR splitting: an urgent fix belongs on the smallest, fastest-reviewed branch (hotfix off main), not bolted to a 200-file refactor review. |

## Red Flags — STOP

- A commit message saying "refactor" with a diff touching test or snapshot files
- A rename where the code graph still shows callers of the old name
- Coverage or test count dropping across the commit
- "and" in your commit subject joining structural + behavioral work

## Checklist

- [ ] Every hunk classified; mixed work split (structural commit first)
- [ ] Refactor commit made with `HARNESS_COMMIT_KIND=refactor git commit …` — this env var is what arms the pre-commit purity gate (staged test/snapshot edits get blocked); without it the gate is inert
- [ ] Refactor commit: tests + snapshots byte-identical green
- [ ] Renames: all graph-listed call sites verified, no dead code left
- [ ] Behavior commit: test updates cite the authorizing story/issue
- [ ] Ratchet held (test count, diff coverage)

One commit, one kind of change. No exceptions without your human partner's permission.
