'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  parseGlossaryTerms,
  parseClusterTerms,
  frequentTerms,
  buildAnalysisSeed,
} = require('../.claude/hooks/lib/analysis-seed');

const ROOT = path.resolve(__dirname, '..');

test('frequentTerms keeps words that appear in two requirements and drops stopwords', () => {
  const terms = frequentTerms([
    { text: 'Create a short link from a target URL' },
    { text: 'List the signed-in user links, newest first' },
    { text: 'Delete one of the user links' },
  ]);
  const words = terms.map((t) => t.word);
  assert.ok(words.includes('link') || words.includes('links'));
  assert.ok(!words.includes('from'));
  assert.ok(!words.includes('the'));
});

test('glossary and cluster parsers read their documented heading shapes', () => {
  assert.deepStrictEqual(
    parseGlossaryTerms('# Context\n\n## Terms\n\n### Shortlink\nA code.\n\n## Other\n'),
    ['Shortlink'],
  );
  assert.deepStrictEqual(
    parseClusterTerms('- **Account** — 3 symbol(s): `AccountService` (src/a.py)\n'),
    ['Account'],
  );
});

test('buildAnalysisSeed marks cluster hits existing and copies PRD questions verbatim', () => {
  const seed = buildAnalysisSeed({
    requirements: [
      { id: 'FR-1', text: 'Create a short link from a target URL' },
      { id: 'FR-2', text: 'Redirect a known short link code' },
    ],
    questions: [{ id: 'Q1', text: 'How long may a code live?' }],
    risks: [{ id: 'R1', text: 'Open redirects' }],
    safeguards: [{ id: 'SG-1', kind: 'prohibition', text: 'Must not follow private hosts' }],
    glossaryMarkdown: '## Terms\n\n### Link\nA short URL.\n',
    clustersMarkdown: '- **Link** — 4 symbol(s): `LinkService` (src/link.py)\n',
  });
  assert.strictEqual(seed.kind, 'lean-analysis-seed');
  const link = seed.domain_concepts.find((c) => c.name.toLowerCase() === 'link');
  assert.ok(link, JSON.stringify(seed.domain_concepts));
  assert.strictEqual(link.status, 'existing');
  assert.match(link.evidence, /naming-clusters/);
  assert.strictEqual(seed.open_questions[0].text, 'How long may a code live?');
  assert.strictEqual(seed.safeguards[0].id, 'SG-1');
});

test('CLI writes analysis-seed.json next to the adopted spine', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analysis-seed-'));
  const brd = path.join(dir, 'specs', 'brd');
  fs.mkdirSync(brd, { recursive: true });
  fs.writeFileSync(path.join(brd, 'brd-requirements.json'), JSON.stringify([
    { id: 'FR-1', text: 'Create a short link from a target URL' },
    { id: 'FR-2', text: 'List the signed-in user short links' },
  ]));
  fs.writeFileSync(path.join(brd, 'brd-open-questions.json'), JSON.stringify([{ id: 'Q1', text: 'TTL?' }]));
  fs.writeFileSync(path.join(brd, 'brd-risks.json'), '[]');
  fs.writeFileSync(path.join(brd, 'brd-safeguards.json'), '[]');
  const out = execFileSync(process.execPath, [
    path.join(ROOT, '.claude/scripts/analysis-seed.js'),
    '--root', dir,
  ], { encoding: 'utf8' });
  assert.match(out, /analysis-seed:/);
  const seed = JSON.parse(fs.readFileSync(path.join(brd, 'analysis-seed.json'), 'utf8'));
  assert.ok(seed.domain_concepts.length >= 1);
});

test('clarifications that record a risk are copied into the seed', () => {
  const seed = buildAnalysisSeed({
    requirements: [{ id: 'FR-1', text: 'Create a short link from a target URL' }],
    risks: [],
    clarifications: [
      {
        id: 'C2',
        question: 'Should the FR-7 vs NFR-1 tension be recorded as a risk?',
        answer: 'Yes - recorded as a risk. Redirect insert vs 50ms p95.',
      },
      {
        id: 'C4',
        question: 'Which SLO governs?',
        answer: 'The NFRs govern.',
      },
    ],
  });
  assert.strictEqual(seed.risks.length, 1);
  assert.strictEqual(seed.risks[0].id, 'C2');
  assert.match(seed.risks[0].text, /FR-7/);
  assert.strictEqual(seed.risks[0].source, 'clarification');
});
