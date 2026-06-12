'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeLinearIssue } = require('./linear');

test('blockedBy includes only blocked_by relations, not issues this one blocks', () => {
  const issue = {
    id: 'issue-a',
    identifier: 'ENG-1',
    title: 'A',
    relations: {
      nodes: [
        {
          type: 'blocked_by',
          relatedIssue: { id: 'issue-b', identifier: 'ENG-2', state: { name: 'Todo' } }
        },
        {
          // From ENG-1's perspective this means ENG-1 BLOCKS ENG-3 —
          // ENG-3 must never appear in ENG-1's own blockedBy list.
          type: 'blocks',
          relatedIssue: { id: 'issue-c', identifier: 'ENG-3', state: { name: 'Todo' } }
        }
      ]
    }
  };

  const normalized = normalizeLinearIssue(issue);

  assert.deepEqual(normalized.blockedBy.map((b) => b.key), ['ENG-2']);
});
