export const meta = {
  name: 'harness-implement-group',
  description:
    "Implement a sprint group's stories in parallel as a dynamic workflow. Loads the group, gives each story its own git worktree and a TDD implementer, then runs an independent acceptance-criteria reviewer over each implementer's reported work. Produces a per-story status report; worktrees are left in place for human integration. Mirrors the harness /implement agent-team lane.",
  phases: [
    { title: 'Plan', detail: 'load the sprint group and its stories' },
    { title: 'Implement', detail: 'one TDD agent per story, each in an isolated worktree' },
    { title: 'Verify', detail: 'independent reviewer scores each story against its acceptance criteria' },
  ],
}

// The sprint group to build. Pass the group id (e.g. "group-01") or a path to a
// sprint contract as the workflow arg.
const GROUP =
  typeof args === 'string' && args.trim()
    ? args.trim()
    : null

if (!GROUP) {
  log('harness-implement-group: no group provided. Re-run as `/harness-implement-group <group-id>` (e.g. group-01) or pass a sprint-contract path.')
  return { error: 'missing group argument' }
}

const STORIES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    group: { type: 'string' },
    found: { type: 'boolean', description: 'false if the group / contract could not be located' },
    stories: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          acceptance_criteria: { type: 'array', items: { type: 'string' } },
          files_hint: { type: 'string', description: 'Likely files/dirs to touch; "" if unknown' },
        },
        required: ['id', 'title', 'acceptance_criteria', 'files_hint'],
      },
    },
  },
  required: ['group', 'found', 'stories'],
}

const IMPL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    story: { type: 'string' },
    summary: { type: 'string', description: 'What was implemented' },
    changedFiles: { type: 'array', items: { type: 'string' } },
    testsAdded: { type: 'array', items: { type: 'string' } },
    testsPass: { type: 'boolean', description: 'Whether the story tests pass in this worktree' },
    testOutput: { type: 'string', description: 'Key lines of the test run output' },
  },
  required: ['story', 'summary', 'changedFiles', 'testsAdded', 'testsPass', 'testOutput'],
}

const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    story: { type: 'string' },
    pass: { type: 'boolean' },
    evidence: { type: 'string' },
    gaps: { type: 'array', items: { type: 'string' }, description: 'Acceptance criteria not yet met' },
  },
  required: ['story', 'pass', 'evidence', 'gaps'],
}

phase('Plan')

const plan = await agent(
  `Locate sprint group "${GROUP}" in this project. Look for sprint-contracts/${GROUP}.json, then specs/stories/ entries belonging to that group, then features.json. Return the group's stories with their ids, titles, and acceptance criteria. Set found=false with an empty stories array if you cannot locate the group. Do NOT write any code in this phase.`,
  { label: `plan:${GROUP}`, phase: 'Plan', schema: STORIES_SCHEMA },
)

if (!plan.found || !plan.stories.length) {
  log(`harness-implement-group: group "${GROUP}" not found or has no stories. Run /spec first, or check the group id.`)
  return { group: GROUP, found: false, outcomes: [] }
}

log(`harness-implement-group: building ${plan.stories.length} story(ies) for ${GROUP} in isolated worktrees`)

// Pipeline: each story is implemented in its own worktree (parallel writes are
// safe because worktrees are isolated), then reviewed against its acceptance
// criteria the moment its implementation returns. The reviewer reasons over the
// implementer's reported diff + test results (it does not re-run the worktree).
const outcomes = await pipeline(
  plan.stories,
  (story) =>
    agent(
      `Implement story ${story.id} — "${story.title}" — using strict TDD (red → green → refactor). Acceptance criteria:\n${story.acceptance_criteria.map((c, i) => `  ${i + 1}. ${c}`).join('\n')}\n\nLikely files: ${story.files_hint || '(discover them)'}\n\nFollow the project's .claude/skills/code-gen/SKILL.md and the test-driven-development skill. Write the failing test first, then the minimum code to pass it. Run the project's test command in THIS worktree and report whether the story's tests pass. Keep the change surgical and scoped to this story only.`,
      { label: `impl:${story.id}`, phase: 'Implement', isolation: 'worktree', schema: IMPL_SCHEMA },
    ),
  (impl, story) =>
    agent(
      `Independently review story ${story.id} — "${story.title}" — for acceptance-criteria coverage. You are a skeptical reviewer; you did NOT write this code.\n\nAcceptance criteria:\n${story.acceptance_criteria.map((c, i) => `  ${i + 1}. ${c}`).join('\n')}\n\nThe implementer reported:\n${JSON.stringify(impl, null, 2)}\n\nDecide pass=true only if every acceptance criterion is plausibly met AND the implementer reports passing tests. List any criterion that is unmet or unverified in gaps. Be strict — an implementer claiming success is not evidence by itself.`,
      { label: `verify:${story.id}`, phase: 'Verify', schema: VERIFY_SCHEMA },
    ).then((verify) => ({ story: story.id, title: story.title, impl, verify })),
)

const built = outcomes.filter(Boolean)
const passed = built.filter((o) => o.verify && o.verify.pass)

log(
  `harness-implement-group: ${passed.length}/${plan.stories.length} stories passed acceptance review. ` +
    `Per-story worktrees remain on disk for human integration (review, then merge the ones you accept).`,
)

return { group: GROUP, total: plan.stories.length, passed: passed.length, outcomes: built }
