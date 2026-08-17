'use strict';

// Story generation contract — the per-change delta prompt (not the system
// REASONS Canvas). A story is the ticket; this section is what /implement
// and /change execute against.
//
// skeleton      — spec-render may leave Operations as `pending`
// implementable — Operations must name at least one target file

const REQUIRED_SUBSECTIONS = ['Requirements', 'Entities', 'Operations', 'Safeguards'];
const ENTITY_STATUSES = new Set(['existing', 'new', 'unknown']);
const AC_ID = /\bE\d+-S\d+-AC\d+\b/;
const GWT = /\bgiven\b[\s\S]{0,200}\bwhen\b[\s\S]{0,200}\bthen\b/i;
const FILE_PATH = /(?:`([^`]+\/[^`]+)`|(?:^|\s)([A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+))/;
const SG_ID = /\bSG-\d+\b/g;

function headingBody(md, pattern) {
  const lines = String(md || '').split('\n');
  const start = lines.findIndex((l) => pattern.test(l));
  if (start === -1) return '';
  const level = (lines[start].match(/^#+/) || ['#'])[0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const m = lines[i].match(/^(#+)\s+/);
    if (m && m[1].length <= level) { end = i; break; }
  }
  return lines.slice(start + 1, end).join('\n');
}

function extractContract(md) {
  const full = String(md || '');
  const hasH2 = /^##\s+Generation Contract\b/im.test(full);
  const block = hasH2 ? headingBody(full, /^##\s+Generation Contract\b/i) : full;
  const body = (title) => headingBody(block, new RegExp(`^###\\s+${title}\\b`, 'i'));
  return {
    present: hasH2 || REQUIRED_SUBSECTIONS.every((t) => new RegExp(`^###\\s+${t}\\b`, 'm').test(full)),
    requirements: body('Requirements'),
    entities: body('Entities'),
    operations: body('Operations'),
    safeguards: body('Safeguards'),
  };
}

function nonEmptyLines(text) {
  return String(text || '')
    .split('\n')
    .map((l) => l.replace(/^\s*[-*]\s*/, '').trim())
    .filter((l) => l && !/^<!--/.test(l));
}

function parseEntities(text) {
  return nonEmptyLines(text).map((line) => {
    const m = line.match(/^(.+?)\s+[—–-]\s+(existing|new|unknown)\b/i);
    if (!m) return { raw: line, name: null, status: null };
    return { raw: line, name: m[1].replace(/^\*+|\*+$/g, '').trim(), status: m[2].toLowerCase() };
  });
}

function operationsArePending(text) {
  const lines = nonEmptyLines(text);
  if (!lines.length) return true;
  return lines.every((l) => /^pending\b/i.test(l));
}

function operationsHaveFile(text) {
  return FILE_PATH.test(String(text || ''));
}

function citedSafeguards(text) {
  return [...String(text || '').matchAll(SG_ID)].map((m) => m[0]);
}

function validateGenerationContract(md, { mode = 'skeleton', safeguards = [] } = {}) {
  const errors = [];
  const warnings = [];
  const c = extractContract(md);
  if (!c.present) {
    errors.push('missing ## Generation Contract section');
    return { pass: false, errors, warnings, contract: c };
  }
  for (const name of REQUIRED_SUBSECTIONS) {
    if (!String(c[name.toLowerCase()] || '').trim()) {
      errors.push(`empty ### ${name}`);
    }
  }

  const req = c.requirements || '';
  if (req.trim() && !AC_ID.test(req) && !GWT.test(req)) {
    errors.push('Requirements must cite a story AC id or a Given/When/Then triple');
  }

  const entities = parseEntities(c.entities);
  if (!entities.length) {
    errors.push('Entities must list at least one term');
  } else {
    for (const e of entities) {
      if (!e.status || !ENTITY_STATUSES.has(e.status)) {
        errors.push(`entity line must be "Name — existing|new|unknown": ${e.raw}`);
      }
    }
  }

  const pending = operationsArePending(c.operations);
  if (mode === 'implementable') {
    if (pending) errors.push('Operations is still pending — write ordered steps with target files before implementing');
    else if (!operationsHaveFile(c.operations)) {
      errors.push('Operations must name at least one repo-relative file path');
    }
  }

  const spine = Array.isArray(safeguards) ? safeguards.filter((s) => s && s.id) : [];
  const cited = citedSafeguards(c.safeguards);
  const known = new Set(spine.map((s) => s.id));
  const noneLine = nonEmptyLines(c.safeguards).find((l) => /^none\b/i.test(l));
  if (spine.length && !cited.length && !noneLine) {
    warnings.push('Safeguards cites no SG-n; add citations or a "none — <reason>" line');
  }
  if (noneLine && noneLine.replace(/^none\s*[—–-]\s*/i, '').length < 25 && !cited.length) {
    errors.push('a "none" Safeguards line needs a reason of at least 25 characters');
  }
  for (const id of cited) {
    if (spine.length && !known.has(id)) errors.push(`UNKNOWN ${id} cited but absent from brd-safeguards.json`);
  }

  return { pass: errors.length === 0, errors, warnings, contract: c };
}

module.exports = {
  extractContract,
  parseEntities,
  operationsArePending,
  operationsHaveFile,
  validateGenerationContract,
};
