# `/spec` — render (Step 6)

SSDD: expand the decided scope into stories, Generation Contract skeletons, and
skeleton bundles. Do not re-open shaping.

```bash
node .claude/scripts/handoff-check.js --phase spec --stage render
```

Exit 1 means Step 5.5 was skipped. Stop and hand off rather than work around it.

Invoke the `spec-render` skill, passing the BRD path and any `--sprint N`. It
forks onto the sidekick model, re-runs `validate-spec-decisions.js`, writes
`stories.json`, and runs `spec-render-write.js` (which also runs
`bundle-write.js`). `/spec` is not done until `specs/stories/` exists.

**One dispatch, not one per story.** Do not `cat` story files or gate scripts
back into this session.

When it returns, read `specs/decisions/spec-unresolved.json` if present. Put
those to the human as in shape Step 3, append to `decisions[]`, re-dispatch with
`--render-only`. A renderer that returns unresolved items is working correctly.
