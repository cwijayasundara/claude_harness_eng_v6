const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Shared test fixtures for pre-commit hook tests
// Eliminates duplication between main and matrix-specific tests

function stage(projectDir, rel, content) {
  const p = path.join(projectDir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  execFileSync('git', ['add', rel], { cwd: projectDir });
  return p;
}

const VALID_CONTRACT = JSON.stringify({
  group: 'group-01',
  stories: ['S1'],
  features: ['F1'],
  contract: { api_checks: [{ id: 'a1', method: 'GET', path: '/health', expected_status: 200 }] },
});

function installContractSchema(projectDir) {
  const dir = path.join(projectDir, '.claude', 'skills', 'evaluate', 'references');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(
    path.join(__dirname, '..', '..', '.claude', 'skills', 'evaluate', 'references', 'contract-schema.json'),
    path.join(dir, 'contract-schema.json')
  );
}

function armContractGate(projectDir, contractJson) {
  fs.writeFileSync(path.join(projectDir, 'claude-progress.txt'), 'current_group: group-01\n');
  fs.mkdirSync(path.join(projectDir, 'sprint-contracts'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'sprint-contracts', 'group-01.json'), contractJson);
  fs.mkdirSync(path.join(projectDir, 'specs', 'reviews'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'specs', 'reviews', 'evaluator-report.md'), 'VERDICT: PASS\n');
}

module.exports = {
  stage,
  VALID_CONTRACT,
  installContractSchema,
  armContractGate,
};
