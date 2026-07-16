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

// --- Semantic sync (the agent-judged half of code->prompt sync) ---
// The sync check above is path-level: does the Canvas still LIST the changed files.
// This half is about whether the Canvas PROSE still DESCRIBES them. A code change
// can honor Governs/Operations membership yet silently violate an Approach choice,
// a Norm, or a Safeguard. Those narrative sections are global claims a diff can
// falsify, so they can't be checked by a regex — the judgement is an agent's.

// Design-narrative sections whose claims a code change can invalidate.
const SEMANTIC_SECTIONS = ['Approach', 'Structure', 'Norms', 'Safeguards'];

// Deterministically select WHICH claims an agent must re-verify for a change:
// the global narrative sections, plus the specific Operations steps that name a
// changed governed file (the most directly falsifiable). Empty when no governed
// source changed — an ungoverned change is the sync check's concern, not this one.
function buildSemanticReview({ canvasText, changedFiles }) {
  const governs = canvas.extractGoverns(canvasText);
  const changed = (changedFiles || []).map(normalize).filter(Boolean);
  const changedGoverned = changed.filter((f) => matchesGoverned(f, governs));
  if (!changedGoverned.length) return { changedGoverned: [], claims: [] };

  const claims = [];
  for (const section of SEMANTIC_SECTIONS) {
    const body = canvas.sectionBody(canvasText, section).trim();
    if (body) claims.push({ section, body });
  }
  const opsLines = canvas.sectionBody(canvasText, 'Operations')
    .split('\n')
    .filter((l) => changedGoverned.some((f) => l.includes(f) || l.includes(path.basename(f))))
    .map((l) => l.trim())
    .filter(Boolean);
  if (opsLines.length) claims.push({ section: 'Operations', body: opsLines.join('\n') });
  return { changedGoverned, claims };
}

// The agent-ready review packet: the changed governed files and, per claim, the
// exact prose to judge against the diff. Instructs fix-the-prompt-first on a miss.
function renderSemanticReview(review, opts = {}) {
  const canvasFile = opts.canvasPath || 'specs/design/reasons-canvas.md';
  const lines = ['# Canvas Semantic Review', ''];
  if (!review.changedGoverned.length) {
    lines.push('No governed source changed — nothing to semantically review.');
    return `${lines.join('\n')}\n`;
  }
  lines.push('Changed governed files:', '', ...review.changedGoverned.map((f) => `- ${f}`), '');
  lines.push('For each claim below, judge against the diff of those files whether it STILL holds.');
  lines.push(`If a claim no longer describes the code, fix the Canvas prose in \`${canvasFile}\` first (fix-the-prompt-first), then the code.`, '');
  for (const c of review.claims) lines.push(`## Claim — ${c.section}`, '', c.body, '');
  return `${lines.join('\n')}\n`;
}

module.exports = {
  checkCanvasSync, renderSyncReport, proposeCanvasSync, applyCanvasProposal,
  buildSemanticReview, renderSemanticReview,
};
