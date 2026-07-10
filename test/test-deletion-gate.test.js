'use strict';

// Gap G31: test-deletion / skip guard. Behaviour-preservation gates (G7
// mutation-gate, G17 legacy-discipline, G30 sprout-diff) all prove a change
// didn't silently regress PRODUCTION code; nothing caught a refactor or
// dependency bump making its own suite pass by deleting, or newly skipping,
// an inconvenient test. Pure content-classification logic only — git
// plumbing lives in .claude/scripts/test-deletion-gate.js (same split
// cycle-gate.js / legacy-discipline-gate.js use).

const { test } = require('node:test');
const assert = require('node:assert');
const {
  countTestMarkers,
  countSkipMarkers,
  classifyTestFileChange,
  classifyTestFileChanges,
} = require('../.claude/hooks/lib/test-deletion-gate');

test('countTestMarkers counts JS it()/test() and Python def test_ cases', () => {
  const js = "it('a', () => {});\ntest('b', () => {});\nit.each([1])('c', () => {});\n";
  assert.strictEqual(countTestMarkers(js), 3);
  const py = 'def test_a():\n    pass\n\nasync def test_b():\n    pass\n';
  assert.strictEqual(countTestMarkers(py), 2);
});

test('countTestMarkers does not count it.skip()/xit() as live tests', () => {
  const js = "it.skip('a', () => {});\nxit('b', () => {});\n";
  assert.strictEqual(countTestMarkers(js), 0);
});

test('countSkipMarkers counts JS and Python skip annotations', () => {
  const js = "it.skip('a', () => {});\nxdescribe('b', () => {});\nxtest('c', () => {});\nit.todo('d');\n";
  assert.strictEqual(countSkipMarkers(js), 4);
  const py = "@pytest.mark.skip\ndef test_a():\n    pass\n\n@unittest.skip('why')\ndef test_b():\n    pass\n";
  assert.strictEqual(countSkipMarkers(py), 2);
});

test('classifyTestFileChange: new file (no prior content) is never a finding', () => {
  assert.strictEqual(classifyTestFileChange('x.test.js', null, "it('a', () => {});\n"), null);
});

test('classifyTestFileChange: unchanged test count and skip count -> no finding', () => {
  const content = "it('a', () => {});\nit('b', () => {});\n";
  assert.strictEqual(classifyTestFileChange('x.test.js', content, content), null);
});

test('classifyTestFileChange: more tests added -> no finding', () => {
  const oldC = "it('a', () => {});\n";
  const newC = "it('a', () => {});\nit('b', () => {});\n";
  assert.strictEqual(classifyTestFileChange('x.test.js', oldC, newC), null);
});

test('classifyTestFileChange: fewer tests -> count-decreased finding', () => {
  const oldC = "it('a', () => {});\nit('b', () => {});\n";
  const newC = "it('a', () => {});\n";
  const finding = classifyTestFileChange('x.test.js', oldC, newC);
  assert.deepStrictEqual(finding, { file: 'x.test.js', kind: 'count-decreased', oldTests: 2, newTests: 1 });
});

test('classifyTestFileChange: file deleted with tests -> deleted finding', () => {
  const oldC = "it('a', () => {});\nit('b', () => {});\n";
  const finding = classifyTestFileChange('x.test.js', oldC, null);
  assert.deepStrictEqual(finding, { file: 'x.test.js', kind: 'deleted', oldTests: 2, newTests: 0 });
});

test('classifyTestFileChange: file deleted with no test markers -> no finding', () => {
  const oldC = '// just a helper, no test cases\nmodule.exports = { helper: 1 };\n';
  assert.strictEqual(classifyTestFileChange('x.test.js', oldC, null), null);
});

test('classifyTestFileChange: same test count but a new skip marker -> new-skip finding', () => {
  const oldC = "it('a', () => {});\n";
  const newC = "it.skip('a', () => {});\nit('b', () => {});\n";
  // count stays at 1 (a's it() no longer matches, b's does) but a skip was added
  const finding = classifyTestFileChange('x.test.js', oldC, newC);
  assert.deepStrictEqual(finding, { file: 'x.test.js', kind: 'new-skip', oldSkips: 0, newSkips: 1 });
});

test('classifyTestFileChange: pytest skip decorator added over an existing test -> new-skip finding', () => {
  const oldC = 'def test_a():\n    assert True\n';
  const newC = '@pytest.mark.skip\ndef test_a():\n    assert True\n';
  const finding = classifyTestFileChange('test_x.py', oldC, newC);
  assert.deepStrictEqual(finding, { file: 'test_x.py', kind: 'new-skip', oldSkips: 0, newSkips: 1 });
});

test('classifyTestFileChanges filters a batch down to only real findings', () => {
  const changes = [
    { file: 'clean.test.js', oldContent: "it('a', () => {});\n", newContent: "it('a', () => {});\n" },
    { file: 'shrunk.test.js', oldContent: "it('a', () => {});\nit('b', () => {});\n", newContent: "it('a', () => {});\n" },
    { file: 'new.test.js', oldContent: null, newContent: "it('a', () => {});\n" },
  ];
  const findings = classifyTestFileChanges(changes);
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].file, 'shrunk.test.js');
});
