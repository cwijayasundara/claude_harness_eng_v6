export const meta = {
  name: 'harness-review',
  description:
    'Multi-dimension review of the current change. Fans out one reviewer per dimension (correctness, security, architecture, quality) over the diff, adversarially verifies every finding before trusting it, then synthesizes a single report. Mirrors the harness /review gate as a dynamic workflow.',
  phases: [
    { title: 'Review', detail: 'one reviewer per dimension over the diff' },
    { title: 'Verify', detail: 'an independent skeptic confirms or refutes each finding' },
    { title: 'Synthesize', detail: 'merge confirmed findings into one report' },
  ],
}

// What to review. Pass a path, a PR ref, or a description as the workflow arg.
// Default: uncommitted changes, falling back to the most recent commit on a clean tree.
const TARGET =
  typeof args === 'string' && args.trim()
    ? args.trim()
    : 'the uncommitted changes (run `git diff HEAD`); if the working tree is clean, review the most recent commit (`git show HEAD`)'

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', description: 'One-line summary of the issue' },
          file: { type: 'string', description: 'Path to the file, or "(general)" if not file-specific' },
          line: { type: 'string', description: 'Line number or range as a string; "" if unknown' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          detail: { type: 'string', description: 'What is wrong and why it matters' },
        },
        required: ['title', 'file', 'line', 'severity', 'detail'],
      },
    },
  },
  required: ['findings'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    isReal: { type: 'boolean', description: 'true only if the issue genuinely exists in the reviewed code' },
    reasoning: { type: 'string', description: 'Evidence for the verdict, citing the actual code' },
  },
  required: ['isReal', 'reasoning'],
}

// Each dimension maps onto a harness review lens. Teams can swap the default
// workflow subagent for a harness agent by adding `agentType` to the agent()
// call (e.g. agentType: 'security-reviewer' for the security dimension) once
// they have confirmed that agent is registered in the target project.
const DIMENSIONS = [
  {
    key: 'correctness',
    prompt:
      'Hunt for correctness bugs: wrong logic, off-by-one, unhandled null/undefined, race conditions, broken error handling, and edge cases the change does not cover. Report only defects you can point at in the actual code.',
  },
  {
    key: 'security',
    prompt:
      'Apply an OWASP Top 10 lens: injection, auth bypass, hardcoded secrets, SSRF, path traversal, unsafe deserialization, missing authz checks, and sensitive-data exposure. Report only concrete vulnerabilities present in the change.',
  },
  {
    key: 'architecture',
    prompt:
      'Check against the project layered-architecture rules in .claude/architecture.md: one-way imports, module boundaries, no business logic in API/UI layers, no repository access from services-skipping layers. Report only real boundary or layering violations introduced by the change.',
  },
  {
    key: 'quality',
    prompt:
      'Apply the project code-gen principles in .claude/skills/code-gen/SKILL.md: dead code, duplication, oversized functions/files, missing types, silent failures, and missing tests for new behavior. Report only issues the change actually introduces.',
  },
]

phase('Review')

// Pipeline (no barrier): each dimension's findings start verifying the instant
// that dimension's review returns, while slower dimensions are still reviewing.
const results = await pipeline(
  DIMENSIONS,
  (d) =>
    agent(
      `Review ${TARGET}.\n\nFocus ONLY on this dimension — ${d.key}:\n${d.prompt}\n\nInspect the real diff with the tools available to you before reporting. Do not invent issues to look thorough; an empty findings list is a valid and good answer.`,
      { label: `review:${d.key}`, phase: 'Review', schema: FINDINGS_SCHEMA },
    ),
  (review, d) =>
    parallel(
      (review.findings || []).map((f) => () =>
        agent(
          `Adversarially verify this ${d.key} finding against the real code in ${TARGET}.\n\nFinding: ${JSON.stringify(f)}\n\nTry to REFUTE it. Read the actual code. Set isReal=false if the issue does not genuinely exist, is already handled elsewhere, or is speculative. Default to isReal=false when uncertain.`,
          { label: `verify:${d.key}:${f.file}`, phase: 'Verify', schema: VERDICT_SCHEMA },
        ).then((v) => ({ ...f, dimension: d.key, verdict: v })),
      ),
    ),
)

const confirmed = results
  .flat()
  .filter(Boolean)
  .filter((f) => f.verdict && f.verdict.isReal)

const order = { critical: 0, high: 1, medium: 2, low: 3 }
confirmed.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9))

log(`harness-review: ${confirmed.length} confirmed finding(s) across ${DIMENSIONS.length} dimensions`)

phase('Synthesize')

const report = await agent(
  `Write a concise Markdown review report for ${TARGET} from these ADVERSARIALLY CONFIRMED findings (already verified to be real):\n\n${JSON.stringify(confirmed, null, 2)}\n\nGroup by severity (critical → low). For each finding give file:line, the problem, and a concrete fix. If the list is empty, state clearly that the change passed multi-dimension review with no confirmed issues. Do not add findings that are not in the list.`,
  { label: 'synthesize', phase: 'Synthesize' },
)

return { confirmed, report }
