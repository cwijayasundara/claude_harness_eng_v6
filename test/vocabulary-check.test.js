'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { test } = require('node:test');

const SCRIPT = path.join(__dirname, '..', '.claude', 'scripts', 'vocabulary-check.js');
const {
  checkVocabulary, parseGlossaryTerms, normalizeTerm,
  candidatesFromDomainConcepts, candidatesFromDataModels, candidatesFromApiContracts,
} = require(SCRIPT);

test('normalizeTerm lowercases, strips punctuation, and naive-singularizes', () => {
  assert.strictEqual(normalizeTerm('Account'), 'account');
  assert.strictEqual(normalizeTerm('Accounts'), 'account');
  assert.strictEqual(normalizeTerm('Sub-Scription Plan'), 'subscriptionplan');
  assert.strictEqual(normalizeTerm('Address'), 'address'); // ends in "ss" after strip -> not singularized past "address"
});

test('parseGlossaryTerms extracts ### headings under ## Terms only', () => {
  const md = [
    '# Context', '', '## Terms', '', '### Account', 'Definition.', '',
    '### User', 'Definition.', '', '## Invariants', '', '### Not a term',
  ].join('\n');
  assert.deepStrictEqual(parseGlossaryTerms(md), ['Account', 'User']);
});

test('parseGlossaryTerms returns empty array when no Terms section exists', () => {
  assert.deepStrictEqual(parseGlossaryTerms('# Context\n\nNothing here.'), []);
});

test('checkVocabulary passes when every candidate resolves to a glossary term', () => {
  const v = checkVocabulary({
    glossaryTerms: ['Account', 'User'],
    candidates: [{ name: 'Account', source: 'a.json' }, { name: 'User', source: 'b.json' }],
  });
  assert.strictEqual(v.pass, true);
  assert.deepStrictEqual(v.undocumented, []);
});

test('checkVocabulary matches Accounts (candidate) against Account (glossary) via singularization', () => {
  const v = checkVocabulary({ glossaryTerms: ['Account'], candidates: [{ name: 'Accounts', source: 'a.json' }] });
  assert.strictEqual(v.pass, true);
});

test('checkVocabulary flags a candidate with no matching glossary term as undocumented', () => {
  const v = checkVocabulary({ glossaryTerms: ['Account'], candidates: [{ name: 'User', source: 'api-contracts.schema.json' }] });
  assert.strictEqual(v.pass, false);
  assert.deepStrictEqual(v.undocumented, [{ name: 'User', source: 'api-contracts.schema.json' }]);
});

test('checkVocabulary reports unused glossary terms but does not fail the gate', () => {
  const v = checkVocabulary({ glossaryTerms: ['Account', 'Invoice'], candidates: [{ name: 'Account', source: 'a.json' }] });
  assert.strictEqual(v.pass, true);
  assert.deepStrictEqual(v.unused, ['Invoice']);
});

test('candidatesFromDomainConcepts extracts domain_concepts[].name', () => {
  const c = candidatesFromDomainConcepts({ domain_concepts: [{ name: 'Account', status: 'new' }] }, 'brd-analysis.json');
  assert.deepStrictEqual(c, [{ name: 'Account', source: 'brd-analysis.json' }]);
});

test('candidatesFromDataModels extracts $defs keys', () => {
  const c = candidatesFromDataModels({ $defs: { Account: {}, User: {} } }, 'data-models.schema.json');
  assert.deepStrictEqual(c.map((x) => x.name).sort(), ['Account', 'User']);
});

test('candidatesFromApiContracts extracts components.schemas keys', () => {
  const c = candidatesFromApiContracts({ components: { schemas: { Account: {} } } }, 'api-contracts.schema.json');
  assert.deepStrictEqual(c, [{ name: 'Account', source: 'api-contracts.schema.json' }]);
});

// --- CLI ----------------------------------------------------------------------

function writeFile(dir, name, content) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
}

test('CLI: passes when all candidates resolve, writes verdict, exit 0', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vocab-'));
  const glossary = writeFile(dir, 'CONTEXT.md', '# Context\n\n## Terms\n\n### Account\nDef.\n');
  const domainConcepts = writeFile(dir, 'brd-analysis.json', JSON.stringify({ domain_concepts: [{ name: 'Account' }] }));
  const out = path.join(dir, 'verdict.json');
  execFileSync(process.execPath, [SCRIPT, '--glossary', glossary, '--domain-concepts', domainConcepts, '--out', out]);
  const v = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.strictEqual(v.pass, true);
});

test('CLI: exits 1 when a schema entity has no glossary term', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vocab-'));
  const glossary = writeFile(dir, 'CONTEXT.md', '# Context\n\n## Terms\n\n### Account\nDef.\n');
  const dataModels = writeFile(dir, 'data-models.schema.json', JSON.stringify({ $defs: { Invoice: {} } }));
  const out = path.join(dir, 'verdict.json');
  let code = 0;
  try {
    execFileSync(process.execPath, [SCRIPT, '--glossary', glossary, '--data-models', dataModels, '--out', out], { stdio: 'pipe' });
  } catch (e) {
    code = e.status;
  }
  assert.strictEqual(code, 1);
  assert.strictEqual(JSON.parse(fs.readFileSync(out, 'utf8')).pass, false);
});

test('CLI: exits 2 when --glossary path does not exist', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vocab-'));
  let code = 0;
  try {
    execFileSync(process.execPath, [SCRIPT, '--glossary', path.join(dir, 'nope.md')], { stdio: 'pipe' });
  } catch (e) {
    code = e.status;
  }
  assert.strictEqual(code, 2);
});

test('CLI: combines domain-concepts, data-models, and api-contracts candidates', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vocab-'));
  const glossary = writeFile(dir, 'CONTEXT.md', '# Context\n\n## Terms\n\n### Account\nDef.\n\n### User\nDef.\n');
  const domainConcepts = writeFile(dir, 'brd-analysis.json', JSON.stringify({ domain_concepts: [{ name: 'Account' }] }));
  const apiContracts = writeFile(dir, 'api-contracts.schema.json', JSON.stringify({ components: { schemas: { User: {} } } }));
  const out = path.join(dir, 'verdict.json');
  execFileSync(process.execPath, [SCRIPT, '--glossary', glossary, '--domain-concepts', domainConcepts, '--api-contracts', apiContracts, '--out', out]);
  const v = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.strictEqual(v.pass, true);
  assert.strictEqual(v.candidate_total, 2);
});
