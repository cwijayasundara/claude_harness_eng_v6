---
name: story-sync
description: "Sync refactor-only code changes back into story bundles and the REASONS Canvas. Use after /implement, /change, or /refactor when owned files moved and acceptance criteria did not. Fails closed if ACs drifted — update the story and run bundle-write instead."
argument-hint: "[--write]"
---

# Story Sync

Keep `specs/bundles/{id}.json` (and the Canvas `Governs` list) aligned with the code after a refactor. This is the SPDD reverse sync with the **story bundle** as the contract, not a prompt file.

Behaviour changes do not belong here. If acceptance-criterion ids on the story no longer match the bundle, stop and run `bundle-write.js` after editing the story.

## Usage

```bash
node .claude/scripts/story-sync.js            # report
node .claude/scripts/story-sync.js --write    # update bundles + canvas Governs
```

`npm run story-sync` is the same script.

## When to run

- After `/implement` validation, before the next group.
- After `/change` Step S5 when the AC set did not change.
- After `/refactor` moves or extracts files that a bundle already owns.

Do not run this to invent new ACs, new stories, or new matrix rows.

## Output

Writes `specs/reviews/story-sync.json`. On `--write`, updates matching `specs/bundles/*.json` (`structure.owned_files`, `operations`, `provenance.synced_at`). Then run `npm run canvas-sync -- --write` when `specs/design/reasons-canvas.md` exists so Governs stays aligned.
