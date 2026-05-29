export const meta = {
  name: 'harness-brownfield-map',
  description:
    'Map an existing codebase as a dynamic workflow. Runs a multi-modal survey (structure, entry points, dependencies, tests, risk) in parallel — each lens blind to the others — then synthesizes the findings into the brownfield maps under specs/brownfield/. Dynamic-workflow form of /brownfield.',
  phases: [
    { title: 'Survey', detail: 'one agent per discovery lens, run in parallel' },
    { title: 'Synthesize', detail: 'merge all lenses into specs/brownfield/ maps' },
  ],
}

// Optional focus. Pass a subsystem/path as the workflow arg to scope the survey
// (e.g. "the billing module"); otherwise the whole repository is mapped.
const SCOPE =
  typeof args === 'string' && args.trim() ? args.trim() : 'the whole repository'

const SURVEY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    modality: { type: 'string' },
    observations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          area: { type: 'string', description: 'Component, file, or concern' },
          detail: { type: 'string', description: 'What was found' },
          evidence: { type: 'string', description: 'File path(s) / symbols backing the observation' },
        },
        required: ['area', 'detail', 'evidence'],
      },
    },
  },
  required: ['modality', 'observations'],
}

const SYNTH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    filesWritten: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string', description: 'Headline findings and the safest place to start changing this code' },
  },
  required: ['filesWritten', 'summary'],
}

// Each lens is deliberately narrow and blind to the others — one search angle
// will not surface everything a brownfield map needs.
const LENSES = [
  {
    key: 'structure',
    prompt:
      'Map the top-level layout: directories, modules, layering, and how responsibilities are split. Identify the architectural style (layered, MVC, microservice, monolith) from the actual file tree, not assumptions.',
  },
  {
    key: 'entry-points',
    prompt:
      'Find every entry point: HTTP routes, CLI commands, server bootstraps, scheduled jobs, message consumers, and public exported module interfaces. These are the observable surfaces a change must preserve.',
  },
  {
    key: 'dependencies',
    prompt:
      'Map dependencies: package manifests, internal import graph hotspots (most-imported modules), external services/APIs, and databases. Flag tight coupling and shared mutable state.',
  },
  {
    key: 'tests',
    prompt:
      'Map the test landscape: test directories, frameworks, what is well-covered vs. bare, and how to run the suite. Note any modules with behavior but no tests — those are change-risk hotspots.',
  },
  {
    key: 'risk',
    prompt:
      'Map risk: auth/authz code, security-sensitive paths, data migrations, money/PII handling, and anything with TODO/FIXME/HACK markers or obvious fragility. These constrain how aggressively the code can be changed.',
  },
]

phase('Survey')

// Barrier: synthesis genuinely needs ALL lenses at once to merge them into a
// coherent map, so parallel() (not pipeline) is the correct shape here.
const surveys = (
  await parallel(
    LENSES.map((lens) => () =>
      agent(
        `Survey ${SCOPE} through ONE lens — ${lens.key}:\n${lens.prompt}\n\nRead the real code with the tools available to you. Report concrete observations with file-path evidence. This is read-only discovery — do NOT modify any files.`,
        { label: `survey:${lens.key}`, phase: 'Survey', schema: SURVEY_SCHEMA },
      ),
    ),
  )
).filter(Boolean)

log(`harness-brownfield-map: ${surveys.length}/${LENSES.length} lenses returned; synthesizing maps`)

phase('Synthesize')

const synthesis = await agent(
  `Synthesize these multi-lens survey results for ${SCOPE} into the harness brownfield maps. Write Markdown files under specs/brownfield/ (create the directory if needed):\n` +
    `  - specs/brownfield/architecture-map.md  (structure + entry points + dependencies)\n` +
    `  - specs/brownfield/test-map.md          (test coverage landscape + how to run)\n` +
    `  - specs/brownfield/risk-map.md          (security/data/fragility hotspots)\n` +
    `  - specs/brownfield/change-strategy.md   (safest seams to change, contracts to preserve, recommended lane)\n\n` +
    `Survey data:\n${JSON.stringify(surveys, null, 2)}\n\n` +
    `Ground every claim in the evidence provided; do not invent components. Follow the conventions in .claude/skills/brownfield/SKILL.md if present. Return the list of files written and a short summary.`,
  { label: 'synthesize', phase: 'Synthesize', schema: SYNTH_SCHEMA },
)

log(`harness-brownfield-map: wrote ${synthesis.filesWritten.length} map file(s) under specs/brownfield/`)

return { scope: SCOPE, surveys, synthesis }
