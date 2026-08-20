'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { renderStoryMd } = require('../.claude/hooks/lib/spec-render-format');

// The Generation Contract's Safeguards list is what the generator is handed at
// implement time. It rendered `safeguards.slice(0, 3)` — the first three
// deny-list entries of the project, identical on every story regardless of what
// the story does. A live review caught it: every story claimed SG-1/2/3 while
// E3-S1, the one story creating links from user-supplied URLs, never received
// SG-10 (no DNS lookup, no outbound fetch) — the deny-list entry that carries
// its SSRF constraint.

const STORY = { id: 'E3-S1', epic: 'E3', title: 'Create short link' };
const DENY = [
  { id: 'SG-1' }, { id: 'SG-2' }, { id: 'SG-3' }, { id: 'SG-8' }, { id: 'SG-10' },
];

function safeguardsBlock(md) {
  const section = md.split('### Safeguards')[1] || '';
  return section.split('###')[0].trim();
}

test('renderStoryMd cites the safeguards scoped to the story', () => {
  const md = renderStoryMd({ ...STORY, safeguards: ['SG-8', 'SG-10'] }, null, [], DENY);
  const block = safeguardsBlock(md);

  assert.match(block, /SG-8/);
  assert.match(block, /SG-10/);
  assert.doesNotMatch(block, /SG-1\b/, 'an unscoped deny-list head must not appear');
  assert.doesNotMatch(block, /SG-2\b/);
});

test('renderStoryMd cites the whole deny-list when the story scopes none', () => {
  // Silently naming the first three is a scoping claim nobody made, and it
  // withholds the rest from the generator. Unscoped means all of them apply.
  const block = safeguardsBlock(renderStoryMd(STORY, null, [], DENY));

  for (const s of DENY) assert.match(block, new RegExp(`${s.id}\\b`));
});

test('renderStoryMd states a reason when the project lists no safeguards', () => {
  const block = safeguardsBlock(renderStoryMd(STORY, null, [], []));

  assert.match(block, /^- none — .{25,}/m, 'the none line needs a reason the contract validator accepts');
});
