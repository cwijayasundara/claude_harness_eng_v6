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

function renderSyncReport(result) {
  const lines = ['# Canvas Sync Check', ''];
  lines.push(`Changed files checked: ${result.changedFiles.length}`);
  lines.push(`Missing from Governs: ${result.missingFromGoverns.length}`);
  for (const f of result.missingFromGoverns) lines.push(`- ${f}`);
  lines.push('');
  lines.push(`Missing from Operations: ${result.missingFromOperations.length}`);
  for (const f of result.missingFromOperations) lines.push(`- ${f}`);
  lines.push('');
  if (result.missingFromGoverns.length || result.missingFromOperations.length) {
    lines.push('Update `specs/design/reasons-canvas.md` before treating the design as synchronized.');
  } else {
    lines.push('Canvas and changed files are synchronized.');
  }
  return `${lines.join('\n')}\n`;
}

module.exports = { checkCanvasSync, renderSyncReport };
