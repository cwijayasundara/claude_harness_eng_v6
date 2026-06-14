'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const SCRIPT = path.join(__dirname, '..', '.claude', 'scripts', 'telemetry-skill-helpers.js');
const {
  parseSkillFrontmatter,
  truncateLabel,
  readSkillCatalog,
  collectSkillInventory,
  inferRecordSkills,
  addSkillUsage,
} = require(SCRIPT);

// Pure helpers behind the skill-telemetry metrics. Tested directly with fake
// metric sinks (labelPairs/setGauge/addCounter) so no Prometheus is needed.

test('parseSkillFrontmatter reads name/description and strips quotes', () => {
  const raw = '---\nname: test\ndescription: "Generate a test plan"\nagent: generator\n---\nbody';
  const fm = parseSkillFrontmatter(raw);
  assert.strictEqual(fm.name, 'test');
  assert.strictEqual(fm.description, 'Generate a test plan');
  assert.strictEqual(fm.agent, 'generator');
});

test('parseSkillFrontmatter returns {} when there is no frontmatter', () => {
  assert.deepStrictEqual(parseSkillFrontmatter('# just markdown'), {});
});

test('truncateLabel collapses whitespace and caps length with an ellipsis', () => {
  assert.strictEqual(truncateLabel('  multi   line\n text '), 'multi line text');
  const long = truncateLabel('x'.repeat(200), 10);
  assert.strictEqual(long.length, 10);
  assert.ok(long.endsWith('…'));
});

test('readSkillCatalog reads SKILL.md frontmatter into a sorted catalog', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cat-'));
  const mk = (name, desc) => {
    const d = path.join(dir, '.claude', 'skills', name);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'SKILL.md'), `---\nname: ${name}\ndescription: ${desc}\n---\n`);
  };
  mk('zeta', 'last one');
  mk('alpha', 'first one');
  const catalog = readSkillCatalog(dir);
  assert.deepStrictEqual(catalog.map((s) => s.name), ['alpha', 'zeta'], 'sorted by name');
  assert.strictEqual(catalog[0].path, '.claude/skills/alpha/SKILL.md');
  assert.strictEqual(catalog[0].description, 'first one');
});

test('readSkillCatalog returns [] when the skills directory is absent', () => {
  assert.deepStrictEqual(readSkillCatalog(os.tmpdir() + '/definitely-not-a-project'), []);
});

test('collectSkillInventory emits one gauge per inventoried skill', () => {
  const gauges = [];
  const sink = {
    labelPairs: (pairs) => Object.fromEntries(pairs),
    setGauge: (_metricObj, name, labels, value) => gauges.push({ name, labels, value }),
  };
  const record = { skill_inventory: [{ name: 'test', directory: 'test', path: 'p', description: 'd' }] };
  collectSkillInventory(record, {}, sink);
  assert.strictEqual(gauges.length, 1);
  assert.strictEqual(gauges[0].name, 'harness_skill_info');
  assert.strictEqual(gauges[0].labels.skill, 'test');
  assert.strictEqual(gauges[0].value, 1);
});

test('inferRecordSkills prefers explicit record.skills', () => {
  const record = { skills: [{ name: 'explicit' }] };
  assert.deepStrictEqual(inferRecordSkills(record, []), [{ name: 'explicit' }]);
});

test('inferRecordSkills falls back to command/lane against the inventory', () => {
  const inventory = [{ name: 'vibe', directory: 'vibe' }];
  const record = { command: 'vibe' };
  const inferred = inferRecordSkills(record, inventory);
  assert.strictEqual(inferred.length, 1);
  assert.strictEqual(inferred[0].name, 'vibe');
  assert.strictEqual(inferred[0].source, 'command');
});

test('addSkillUsage emits a usage counter per inferred skill', () => {
  const counters = [];
  const sink = {
    labelPairs: (pairs) => Object.fromEntries(pairs),
    addCounter: (_obj, name, labels) => counters.push({ name, labels }),
  };
  const inventory = [{ name: 'vibe', directory: 'vibe' }];
  addSkillUsage({ command: 'vibe', kind: 'command' }, {}, inventory, sink);
  assert.strictEqual(counters.length, 1);
  assert.strictEqual(counters[0].name, 'harness_skill_usage_total');
  assert.strictEqual(counters[0].labels.skill, 'vibe');
});
