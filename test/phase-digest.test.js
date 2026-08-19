'use strict';

// The upstream digest that keeps full planning artifacts out of the shaping
// session. `/spec` Step 1 used to read brd-requirements.json (33 KB) + brd.md
// (26 KB) into the main context, where they were then re-billed on every
// remaining turn. These assertions pin the two properties that matter: the
// digest reports the decisions the phase actually makes, and it does not carry
// requirement or story prose.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { digestFor } = require(path.join(ROOT, '.claude/hooks/lib/phase-digest.js'));
const { render } = require(path.join(ROOT, '.claude/scripts/phase-digest.js'));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const LONG_TEXT = 'x'.repeat(4000);

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'digest-'));
  const write = (rel, value) => {
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), JSON.stringify(value));
  };
  write('specs/brd/brd-requirements.json', [
    { id: 'FRD-1', text: LONG_TEXT, taxonomy: ['functional'], acceptance: ['AC-1'] },
    { id: 'FRD-2', text: LONG_TEXT, taxonomy: ['security_authz'] },
    { id: 'FRD-3', text: LONG_TEXT, taxonomy: ['functional'] },
  ]);
  write('specs/brd/brd-acceptance.json', [{ id: 'AC-1', requirement: 'FRD-1', text: 'Given…' }]);
  write('specs/brd/brd-safeguards.json', [{ id: 'SG-1', text: `no deploy ${LONG_TEXT}` }]);
  write('specs/brd/brd-milestones.json', [{ id: 'P0', done_when: 'corpus exists' }]);
  write('specs/brd/brd-open-questions.json', [{ id: 'Q-1', text: `what is this for ${LONG_TEXT}` }]);
  write('specs/brd/clarification-log.json', [{ id: 'C1' }, { id: 'C2' }]);
  write('specs/brd/brd-risks.json', [
    { id: 'R-1', text: 'Risk (High) — corpus too clean' },
    { id: 'R-2', text: 'Risk (Low) — nothing much' },
  ]);
  write('specs/stories/stories.json', [
    { id: 'E1-S1', epic: 'E1', layer: 'Service', readiness: 'ready' },
    { id: 'E1-S2', epic: 'E1', layer: 'UI', readiness: 'needs_breakdown' },
  ]);
  write('specs/stories/story-clusters.json', { cluster_count: 2, unresolved_contracts: ['x'], warnings: [] });
  write('specs/stories/dependency-edges.json', [{ from: 'E1-S1', to: 'E1-S2' }]);
  write('specs/stories/acceptance-criteria.json', [{ id: 'AC-1' }, { id: 'AC-2' }]);
  write('features.json', [{ id: 'F1' }]);
  return dir;
}

test('the spec digest counts uncovered requirements — the phase work-list no gate catches', () => {
  const d = digestFor('spec', fixture());
  assert.strictEqual(d.requirements.n, 3);
  assert.strictEqual(d.acceptance.gated, 1);
  assert.strictEqual(d.acceptance.uncovered, 2, 'FRD-2 and FRD-3 have no criterion');
});

test('the spec digest names the next hop so an empty stories/ cannot be misread as "never shaped"', () => {
  const dir = fixture();
  assert.strictEqual(digestFor('spec', dir).progress.next, 'shape',
    'fixture has stories but no decisions — still a shaping session');
  const write = (rel, value) => {
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), JSON.stringify(value));
  };
  write('specs/decisions/spec-decisions.json', {
    milestone: { name: 'M1', epics: ['E1', 'E2'] },
  });
  fs.rmSync(path.join(dir, 'specs/stories/stories.json'));
  const renderNext = digestFor('spec', dir);
  assert.strictEqual(renderNext.progress.next, 'render');
  assert.strictEqual(renderNext.progress.stories, 0);
  const out = render('spec', renderNext);
  assert.match(out, /NEXT\s+render/);
  assert.match(out, /do not re-shape/);
});

test('the spec digest carries no requirement prose, however long the source', () => {
  const out = render('spec', digestFor('spec', fixture()));
  assert.doesNotMatch(out, /x{200}/, 'requirement bodies must stay in the fork');
  assert.ok(out.length < 4000, `digest grew to ${out.length}B — it is meant to be a digest`);
  assert.match(out, /SG-1/, 'the deny-list is short and load-bearing, so ids and clipped text stay');
  assert.match(out, /Q-1/, 'open questions must survive — a dropped one is a silent decision');
});

test('High risks are surfaced and low ones are not — the band is the whole point', () => {
  const d = digestFor('spec', fixture());
  assert.deepStrictEqual(d.risks.map((r) => r.id), ['R-1']);
});

test('the design digest reports graph shape and flags needs_breakdown stories', () => {
  const d = digestFor('design', fixture());
  assert.strictEqual(d.stories.total, 2);
  assert.deepStrictEqual(d.needs_breakdown, ['E1-S2']);
  assert.strictEqual(d.dependency_edges, 1);
  assert.match(render('design', d), /NEEDS BREAKDOWN/);
});

test('a missing upstream degrades to empty rather than throwing', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'digest-empty-'));
  assert.strictEqual(digestFor('spec', empty).requirements, null);
  assert.strictEqual(digestFor('design', empty).stories.total, 0);
});

test('an unknown phase has no digest rather than a wrong one', () => {
  assert.strictEqual(digestFor('brd', fixture()), null);
});

test('the three consuming phases orient from the digest, not the full artifacts', () => {
  const spec = read('.claude/skills/spec/SKILL.md');
  assert.match(spec, /phase-digest\.js --phase spec/);
  assert.match(spec, /Two sessions produce the story graph|\/spec --render-only/,
    '/spec must not treat the decisions file as the finished command');
  assert.match(spec, /[Dd]o not read `brd-requirements\.json`/,
    '/spec must say plainly that the spine is not read whole here');
  assert.match(
    read('.claude/skills/design/references/mode-06-prerequisites-full-mode-only-doc-only-has-none.md'),
    /phase-digest\.js --phase design/,
  );
  assert.match(read('.claude/skills/test/SKILL.md'), /phase-digest\.js --phase test/);
});

test('the test digest lists AC ids by story and whether design rendered', () => {
  const dir = fixture();
  const writeJson = (rel, value) => {
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), JSON.stringify(value));
  };
  writeJson('specs/stories/acceptance-criteria.json', [
    { id: 'E1-S1-AC1' },
    { id: 'E1-S1-AC2' },
    { id: 'E1-S2-AC1', story: 'E1-S2' },
  ]);
  const d = digestFor('test', dir);
  assert.strictEqual(d.acceptance_criteria, 3);
  assert.strictEqual(d.design_rendered, false);
  assert.deepStrictEqual(
    d.by_story.map((row) => [row.id, row.acs.join(',')]),
    [['E1-S1', 'E1-S1-AC1,E1-S1-AC2'], ['E1-S2', 'E1-S2-AC1']],
  );
  const out = render('test', d);
  assert.match(out, /E1-S1/);
  assert.match(out, /not rendered/);
  assert.doesNotMatch(out, /x{200}/);
});
