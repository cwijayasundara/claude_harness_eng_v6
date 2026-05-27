'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const HARNESS_ROOT = path.join(__dirname, '..', '..');
const E2E_SETTINGS = path.join(__dirname, '..', 'fixtures', 'e2e-settings.json');

function runClaude(prompt, options = {}) {
  const {
    cwd = process.cwd(),
    model = 'sonnet',
    budgetUsd = '1.00',
    timeoutMs = 300000,
    continueSession = false,
  } = options;

  const args = [
    '-p',
    '--model', model,
    '--max-budget-usd', budgetUsd,
    '--settings', E2E_SETTINGS,
    '--exclude-dynamic-system-prompt-sections',
  ];

  if (continueSession) {
    args.push('--continue');
  }

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
