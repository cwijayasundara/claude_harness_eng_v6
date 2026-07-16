'use strict';

// Encoded "This Project" block for a scaffolded CLAUDE.md / REVIEW.md
// (Boris-thesis: encode domain knowledge as infrastructure). Composed from the
// normalized manifest — the fields the scaffold interview already captured — so
// a scaffolded project carries project-SPECIFIC rules, not a generic ToC. Kept
// in its own module so scaffold-render.js stays under the file-length limit.

function encLayers(arch) {
  if (arch && Array.isArray(arch.layers) && arch.layers.length) {
    return `**Import hierarchy (one-way):** ${arch.layers.join(' → ')}. An upstream→downstream import is a layer violation the pre-commit gate blocks.`;
  }
  return '**Import hierarchy:** not configured — see `.claude/architecture.md`.';
}

function encContexts(arch) {
  const ctx = arch && arch.contexts;
  if (!ctx || ctx.enabled === false) return null;
  const allow = Array.isArray(ctx.allow) ? ctx.allow : [];
  const edges = allow.length ? allow.map((e) => `\`${e}\``).join(', ') : 'none (contexts fully isolated)';
  return `**Bounded contexts:** enforced; the only allowed cross-context edges are ${edges}.`;
}

function encQuality(m) {
  const out = [];
  const tier = m.quality && m.quality.sensor_tier;
  if (tier) out.push(`**Sensor tier:** \`${tier}\` — the pre-commit gate set enforced in this project.`);
  out.push(`**Topology:** ${m.topology || 'unset'} · **agent model tier:** ${(m.execution && m.execution.model_tier) || 'unset'}.`);
  const slo = m.observability && m.observability.slo;
  if (slo && Object.keys(slo).length) out.push(`**Runtime SLO:** \`${JSON.stringify(slo)}\` — enforced by the runtime-SLO sensor.`);
  return out;
}

function encDomain(m) {
  const packs = Array.isArray(m.domain_vertical_packs) ? m.domain_vertical_packs : [];
  const where = 'Ubiquitous-language terms live in `specs/design/CONTEXT.md` (seeded by `/brd`) and are enforced by the vocabulary-check sensor.';
  return packs.length
    ? `**Domain vertical:** ${packs.join(', ')}. ${where}`
    : `**Domain vocabulary:** ${where}`;
}

function projectEncodingBlock(manifest) {
  const m = manifest || {};
  const arch = m.architecture || null;
  const lines = [
    '## This Project',
    '',
    'Project-specific rules an agent or new contributor must follow here — encoded from the scaffold interview, not generic advice:',
    '',
    encLayers(arch),
  ];
  const ctx = encContexts(arch);
  if (ctx) lines.push(ctx);
  lines.push(...encQuality(m), encDomain(m));
  return lines.join('\n');
}

module.exports = { projectEncodingBlock, encLayers, encContexts, encQuality, encDomain };
