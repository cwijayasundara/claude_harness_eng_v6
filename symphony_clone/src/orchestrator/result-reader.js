'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

async function readResult(workspacePath, groupId) {
  const resultPath = path.join(workspacePath, '.claude', 'state', 'tracker-runs', groupId, 'result.json');
  const raw = await fs.readFile(resultPath, 'utf8');
  const result = JSON.parse(raw);

  if (!result.status) {
    throw new Error(`Result file missing status: ${resultPath}`);
  }

  return {
    path: resultPath,
    result
  };
}

function buildProofComment(issue, group, runResult, prUrl) {
  const result = runResult.result;
  const lines = [
    '## Claude Harness Proof',
    '',
    `- Tracker: ${issue.key}`,
    `- Group: ${group.id}`,
    `- Status: ${result.status}`,
    result.summary ? `- Summary: ${result.summary}` : null,
    result.branch ? `- Branch: ${result.branch}` : null,
    result.commit ? `- Commit: ${result.commit}` : null,
    prUrl ? `- PR: ${prUrl}` : null,
    '',
    '### Tests',
    ...arrayOrEmpty(result.tests).map((item) => `- ${item}`),
    '',
    '### Reports',
    ...arrayOrEmpty(result.reports).map((item) => `- ${item}`),
    '',
    '### Features Updated',
    ...arrayOrEmpty(result.features_updated).map((item) => `- ${item}`)
  ].filter((line) => line !== null);

  if (result.blocker) {
    lines.push('', '### Blocker', result.blocker);
  }

  return lines.join('\n');
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

module.exports = { readResult, buildProofComment };
