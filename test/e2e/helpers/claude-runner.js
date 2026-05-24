'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const HARNESS_ROOT = path.join(__dirname, '..', '..', '..');

function runClaude(prompt, options = {}) {
  const {
    cwd = process.cwd(),
    model = 'haiku',
    budgetUsd = '1.00',
    timeoutMs = 300000,
  } = options;

  const args = [
    '-p',
    '--model', model,
    '--no-session-persistence',
    '--max-budget-usd', budgetUsd,
    '--bare',
  ];

  const result = spawnSync('claude', args, {
    input: prompt,
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    env: { ...process.env, CLAUDE_CODE_ENABLE_TELEMETRY: '1' },
  });

  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    exitCode: result.status,
    signal: result.signal,
    error: result.error,
  };
}

module.exports = { runClaude, HARNESS_ROOT };
