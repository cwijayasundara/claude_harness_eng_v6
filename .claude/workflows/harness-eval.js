export const meta = {
  name: 'harness-eval',
  description:
    "Evaluate a sprint contract as a dynamic workflow. Runs the three harness verification layers — API, UI (Playwright), and schema — in parallel against the running app, then aggregates them into one PASS/FAIL verdict with evidence. Dynamic-workflow form of /evaluate.",
  phases: [
    { title: 'Verify', detail: 'API, UI, and schema layers checked in parallel' },
    { title: 'Aggregate', detail: 'combine layers into one verdict + report' },
  ],
}

// The sprint contract to evaluate. Pass the contract id (e.g. "group-01") or a
// path to a sprint-contracts/*.json file as the workflow arg.
const CONTRACT =
  typeof args === 'string' && args.trim() ? args.trim() : null

if (!CONTRACT) {
  log('harness-eval: no contract provided. Re-run as `/harness-eval <contract-id>` (e.g. group-01) or pass a sprint-contracts/*.json path.')
  return { error: 'missing contract argument' }
}

const LAYER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    layer: { type: 'string' },
    applicable: { type: 'boolean', description: 'false if this layer does not apply (e.g. UI layer for an API-only project)' },
    pass: { type: 'boolean', description: 'true only if every applicable check passed' },
    checks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          criterion: { type: 'string' },
          pass: { type: 'boolean' },
          evidence: { type: 'string', description: 'Status code, response body excerpt, screenshot ref, or schema error' },
        },
        required: ['criterion', 'pass', 'evidence'],
      },
    },
    notes: { type: 'string' },
  },
  required: ['layer', 'applicable', 'pass', 'checks', 'notes'],
}

// The three verification layers. Each reads the project's verification config to
// learn how to reach the running app before testing.
const LAYERS = [
  {
    key: 'api',
    prompt:
      "Verify the contract's acceptance criteria at the API layer. Read project-manifest.json (evaluation + verification blocks) for the base URL and health check, confirm the app is reachable, then exercise the relevant endpoints and assert status codes and response bodies against each acceptance criterion.",
  },
  {
    key: 'ui',
    prompt:
      "Verify the contract's user-facing acceptance criteria via Playwright. Read project-manifest.json for the UI base URL. If the project is API-only / has no UI (no ui_base_url or calibration indicates API-only), set applicable=false and pass=true with a note. Otherwise drive the real UI flows and assert the criteria, capturing evidence.",
  },
  {
    key: 'schema',
    prompt:
      'Validate API responses against the contract schema. Read specs/design/api-contracts.schema.json (or the schema_source named in the verification block). For each relevant endpoint, confirm the response conforms to the schema; report any violations as failed checks.',
  },
]

phase('Verify')

// Barrier: the verdict must weigh all three layers together, so parallel() is
// the correct shape — collect every layer before aggregating.
const layers = (
  await parallel(
    LAYERS.map((l) => () =>
      agent(
        `Evaluate sprint contract "${CONTRACT}" — locate sprint-contracts/${CONTRACT}.json (or the provided path) and read its acceptance criteria.\n\nLayer: ${l.key}\n${l.prompt}\n\nReport an honest pass/fail per criterion with concrete evidence. Do not claim a pass without observed evidence; an unreachable app is a FAIL, not a skip.`,
        { label: `verify:${l.key}`, phase: 'Verify', schema: LAYER_SCHEMA },
      ),
    ),
  )
).filter(Boolean)

const applicable = layers.filter((l) => l.applicable)
const overallPass = applicable.length > 0 && applicable.every((l) => l.pass)

log(
  `harness-eval: ${applicable.filter((l) => l.pass).length}/${applicable.length} applicable layers passed — ` +
    `verdict: ${overallPass ? 'PASS' : 'FAIL'}`,
)

phase('Aggregate')

const report = await agent(
  `Write a concise Markdown evaluation verdict for sprint contract "${CONTRACT}".\n\nOverall verdict: ${overallPass ? 'PASS' : 'FAIL'}\n\nLayer results:\n${JSON.stringify(layers, null, 2)}\n\nLead with the verdict, then a per-layer breakdown, then a bulleted list of every failed or unverified criterion with its evidence. Be factual — do not soften a FAIL.`,
  { label: 'aggregate', phase: 'Aggregate' },
)

return { contract: CONTRACT, pass: overallPass, layers, report }
