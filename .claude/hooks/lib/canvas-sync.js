'use strict';

const path = require('path');
const canvas = require('./canvas');

function normalize(p) {
  return String(p || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function globToRegExp(glob) {
  const escaped = normalize(glob)
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escaped}$`);
}

function matchesGoverned(changed, governs) {
  const file = normalize(changed);
  return (governs || []).some((g) => {
    const pattern = normalize(g);
    if (pattern.includes('*')) return globToRegExp(pattern).test(file);
    return file === pattern || file.startsWith(`${pattern.replace(/\/$/, '')}/`);
  });
}

function mentionsInOperations(changed, operationsBody) {
  const file = normalize(changed);
  const base = path.basename(file);
  const body = String(operationsBody || '');
  return body.includes(file) || body.includes(base);
}

function checkCanvasSync({ canvasText, changedFiles }) {
  const governs = canvas.extractGoverns(canvasText);
  const operations = canvas.sectionBody(canvasText, 'Operations');
  const changed = (changedFiles || []).map(normalize).filter(Boolean);
  return {
    governs,
    changedFiles: changed,
    missingFromGoverns: changed.filter((f) => !matchesGoverned(f, governs)),
    missingFromOperations: changed.filter((f) => !mentionsInOperations(f, operations)),
  };
}

function uniq(arr) {
  return [...new Set(arr)];
}

// Deterministic line generators — the single source of truth shared by the report
// (what would be added) and the --write apply (what is added), so they can never
// drift apart. Backtick-wrapped so the added Governs bullet parses via
// canvas.extractGoverns and the Operations stub is picked up by mentionsInOperations.
function governsBulletFor(p) {
  return `- \`${normalize(p)}\``;
}
function operationsStubFor(p) {
  return `- TODO(canvas-sync): document the operation that lands in \`${normalize(p)}\``;
}

// Turn a check result into the concrete lines a fix would add. Purely a function of
// the missing sets, so a path already governed / already in Operations is never
// proposed (checkCanvasSync excludes it from the missing set upstream).
function proposeCanvasSync(result) {
  return {
    governsBullets: uniq(result.missingFromGoverns || []).map(governsBulletFor),
    operationsStubs: uniq(result.missingFromOperations || []).map(operationsStubFor),
  };
}

// Append newLines to the end of a `## <title>` section's body, before the next
// `## ` heading (or EOF). Returns lines unchanged if the section is absent.
function insertIntoSection(lines, title, newLines) {
  if (!newLines.length) return lines;
  const start = lines.findIndex((l) => new RegExp(`^##\\s+${title}\\b`).test(l));
  if (start === -1) return lines;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) { end = i; break; }
  }
  let insertAt = start + 1;
  for (let i = start + 1; i < end; i++) {
    if (lines[i].trim() !== '') insertAt = i + 1;
  }
  return [...lines.slice(0, insertAt), ...newLines, ...lines.slice(insertAt)];
}

// Apply the proposed patch to the Canvas text and return the new text. Deterministic,
// no LLM. Inserts the Operations stubs and Governs bullets into their real sections.
function applyCanvasProposal(canvasText, result) {
  const { governsBullets, operationsStubs } = proposeCanvasSync(result);
  let lines = String(canvasText).split('\n');
  lines = insertIntoSection(lines, 'Operations', operationsStubs);
  lines = insertIntoSection(lines, 'Governs', governsBullets);
  return lines.join('\n');
}

// The "## Proposed Canvas patch" block: the exact Governs bullets / Operations
// stubs a fix would add, plus the apply / review cue.
function renderProposalBlock(result, opts) {
  const canvasFile = opts.canvasPath || 'specs/design/reasons-canvas.md';
  const { governsBullets, operationsStubs } = proposeCanvasSync(result);
  const lines = ['## Proposed Canvas patch (deterministic)', ''];
  const addBlock = (label, items) => {
    if (!items.length) return;
    lines.push(label, '', ...items, '');
  };
  addBlock('Add to `## Governs`:', governsBullets);
  addBlock('Add to `## Operations`:', operationsStubs);
  lines.push(opts.applied
    ? `Applied to \`${canvasFile}\` (--write); review and refine the stubs.`
    : 'Run `npm run canvas-sync -- --write` to apply this patch, then review. Or edit the Canvas by hand.');
  lines.push('', `Update \`${canvasFile}\` before treating the design as synchronized.`);
  return lines;
}

function renderSyncReport(result, opts = {}) {
  const lines = ['# Canvas Sync Check', ''];
  lines.push(`Changed files checked: ${result.changedFiles.length}`);
  lines.push(`Missing from Governs: ${result.missingFromGoverns.length}`);
  for (const f of result.missingFromGoverns) lines.push(`- ${f}`);
  lines.push('');
  lines.push(`Missing from Operations: ${result.missingFromOperations.length}`);
  for (const f of result.missingFromOperations) lines.push(`- ${f}`);
  lines.push('');
  if (result.missingFromGoverns.length || result.missingFromOperations.length) {
    lines.push(...renderProposalBlock(result, opts));
  } else {
    lines.push('Canvas and changed files are synchronized.');
  }
  return `${lines.join('\n')}\n`;
}

module.exports = {
  checkCanvasSync, renderSyncReport, proposeCanvasSync, applyCanvasProposal,
};
