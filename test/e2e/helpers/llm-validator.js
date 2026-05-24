'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');

function llmValidate(artifactPath, criteria) {
  const content = fs.readFileSync(artifactPath, 'utf8');
  const trimmed = content.slice(0, 6000);
  const prompt =
    'You are a QA validator. Check this artifact against the criteria.\n\n' +
    'CRITERIA:\n' + criteria + '\n\n' +
    'ARTIFACT:\n' + trimmed + '\n\n' +
    'Respond with ONLY valid JSON matching: {"pass": true/false, "failures": ["..."]}';

  const result = spawnSync('claude', [
    '-p',
    '--model', 'haiku',
    '--no-session-persistence',
    '--max-budget-usd', '0.15',
    '--bare',
  ], {
    input: prompt,
    encoding: 'utf8',
    timeout: 45000,
  });

  const raw = (result.stdout || '').trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { pass: false, failures: ['LLM returned non-JSON'], raw };

  try {
    return JSON.parse(jsonMatch[0]);
  } catch (_) {
    return { pass: false, failures: ['LLM JSON parse error'], raw };
  }
}

module.exports = { llmValidate };
