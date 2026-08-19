'use strict';

// Render a story bundle as the tracker issue body. The board is a view;
// specs/bundles/{id}.json stays canonical.

function lines(values, prefix = '- ') {
  const items = (values || []).filter(Boolean);
  if (!items.length) return `${prefix}(none)`;
  return items.map((v) => `${prefix}${v}`).join('\n');
}

function renderBundleMarkdown(bundle, extra = {}) {
  if (!bundle || !bundle.story_id) return '';
  const req = bundle.requirements || {};
  const structure = bundle.structure || {};
  const tests = bundle.tests || {};
  const approach = bundle.approach || {};
  const group = extra.group || extra.groupId || '';
  const cmd = extra.harnessCommand || extra.harness_command || '/auto';
  const parts = [
    `## Harness Story`,
    '',
    `- Story: ${bundle.story_id}`,
    `- Title: ${bundle.title || bundle.story_id}`,
    `- Sprint: ${bundle.sprint || 1}`,
    group ? `- Group: ${group}` : null,
    `- Harness command: ${cmd}`,
    `- Parents: ${(bundle.provenance && bundle.provenance.parents || []).join(', ') || 'none'}`,
    '',
    '## Acceptance Criteria',
    '',
    lines(req.ac_ids),
    '',
    '## Original requirements',
    '',
    lines(req.br_acceptance_ids && req.br_acceptance_ids.length ? req.br_acceptance_ids : req.brd_ids),
    '',
    '## Scope out',
    '',
    lines(req.scope_out),
    '',
    '## Owned files',
    '',
    lines(structure.owned_files),
    '',
    '## Design',
    '',
    `- ${approach.program_design || 'specs/design/program-design.md'}`,
    `- ${approach.canvas || 'specs/design/reasons-canvas.md'}`,
    approach.amendment ? `- ${approach.amendment}` : null,
    '',
    '## Tests (verification matrix)',
    '',
    lines(tests.matrix_ids),
    '',
    '## Expected Proof',
    '',
    '- Branch or PR URL',
    '- Unit/lint/typecheck result for the owned files',
    `- Updated \`features.json\` entry for ${bundle.story_id}`,
    '',
  ];
  return parts.filter((p) => p !== null).join('\n');
}

function renderGroupMarkdown(bundles, extra = {}) {
  const ids = (bundles || []).map((b) => b && b.story_id).filter(Boolean);
  const group = extra.group || extra.groupId || 'A';
  const cmd = extra.harnessCommand || `/auto --group ${group}`;
  const heads = [
    '## Harness Group',
    '',
    `- Group: ${group}`,
    `- Harness command: ${cmd}`,
    `- Stories: ${ids.join(', ') || '(none)'}`,
    '',
  ];
  const bodies = (bundles || []).map((b) => renderBundleMarkdown(b, extra));
  return `${heads.join('\n')}${bodies.join('\n---\n')}\n`;
}

module.exports = { renderBundleMarkdown, renderGroupMarkdown };
