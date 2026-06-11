---
name: upgrading-dependencies
description: Use when bumping a dependency version — package.json, pyproject.toml, requirements, or lockfile changes — in an existing codebase. Classifies the bump, audits the usage surface from the code graph, and isolates the upgrade in its own proven commit.
---

# Upgrading Dependencies

A dependency upgrade is a behavior change you didn't write, applied to every call site at once. Treat it like any other brownfield change: know the blast radius before you bump, prove behavior with the existing suite, and never mix the upgrade with code changes that would hide which one broke the build.

## The Iron Law

```
ONE DEPENDENCY UPGRADE PER COMMIT, PROVEN BY THE SUITE — NEVER MIXED WITH CODE CHANGES
```

## Process

1. **Classify the bump.** Patch (x.y.Z) → proceed with suite proof. Minor (x.Y.z) → read the release notes first. Major (X.y.z) → full protocol below. A lockfile-only refresh that pulls many transitive bumps counts as one upgrade unit, proven the same way.

2. **Read the changelog/release notes for the traversed range** — not just the target version. Breaking changes, deprecations, and behavior changes (defaults flipping, stricter validation) accumulate across every version you skip. No changelog available → diff the library's source tags or treat the bump as major.

3. **Map the usage surface.** Grep the import name across the repo and check `specs/brownfield/code-graph.json` `ext:` edges for the package (when present) — every importing file is blast radius. For each breaking change in the notes, check whether any usage site hits it. Usage you cannot see (config-file conventions, plugin auto-discovery, peer-dependency contracts) is found by running the suite, which is why step 5 is not optional.

4. **Security context.** Run the ecosystem audit (`npm audit` / `pip-audit`) before and after — an upgrade motivated by a CVE must show the advisory cleared; an unrelated upgrade must not introduce new HIGH/CRITICAL advisories via transitive bumps.

5. **Prove it.** Full test suite + typecheck + lint on the bumped lockfile. If `checking-coverage-before-change` artifacts exist, also run the coverage-map oracle tests for the files in the usage surface. A green suite on an uncovered usage surface proves little — say so in the report rather than claiming safety you don't have.

6. **Required code changes go in a follow-up commit.** When a major bump forces call-site rewrites: first commit = version bump + the minimal mechanical adaptations to compile/import (suite green), labeled as the upgrade; subsequent commits = any refactoring or improvement the new version enables. If the mechanical adaptations are themselves large, do the inverse — ship compatibility shims first, then the bump, then remove the shims.

7. **Stuck between versions?** When the target version needs changes you cannot safely make yet (an unpinnable usage surface), pin the current version explicitly with a dated comment stating what blocks the upgrade, and surface it in the report — an undocumented stale pin is how 3-year-old CVEs happen.

## Common Rationalizations

| Excuse | Reality |
|---|---|
| "It's just a patch bump" | Patch bumps ship behavior fixes — something changed, or there'd be no release. The suite run costs minutes. |
| "I'll upgrade five packages at once to save CI runs" | When the suite fails you now bisect five suspects. One unit per commit; the bisect is the saving. |
| "Tests pass, ship it" | Pass on what coverage? If the usage surface is uncovered, the green is vacuous — check before claiming safety. |
| "I'll clean up these deprecated calls while I'm here" | That's a second change hiding in the upgrade commit. Follow-up commit. |
| "The changelog is too long to read" | Then read the BREAKING CHANGES sections of each major heading in the traversed range. That part is never optional. |
