'use strict';

// CI ingestion: a brownfield project's REAL gates live in its CI config, not
// the harness defaults. ci-ingest.js extracts test/lint/coverage commands from
// GitHub/GitLab/CircleCI/Jenkins configs into specs/brownfield/ci-map.md so
// the harness gates can be reconciled with what the project actually enforces.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { test } = require('node:test');

const script = path.join(__dirname, '..', '.claude', 'scripts', 'ci-ingest.js');
const { extractCommands, classify } = require(script);

const GH_WORKFLOW = `
name: ci
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - name: tests
        run: npm test -- --coverage
      - name: lint
        run: |
          npx eslint src/
          npx tsc --noEmit
`;

const GITLAB = `
test:
  stage: test
  script:
    - uv run pytest --cov=src
    - uv run ruff check .
deploy:
  script:
    - ./deploy.sh
`;

const JENKINS = `
pipeline {
  stages {
    stage('Test') {
      steps {
        sh 'mvn test'
        sh "mvn verify -Pcoverage"
      }
    }
  }
}
`;

test('extracts run commands from a GitHub workflow, including block scalars', () => {
  const cmds = extractCommands('github', GH_WORKFLOW).map((c) => c.cmd);
  assert.ok(cmds.includes('npm test -- --coverage'), cmds.join('|'));
  assert.ok(cmds.includes('npx eslint src/'), cmds.join('|'));
  assert.ok(cmds.includes('npx tsc --noEmit'), cmds.join('|'));
});

test('extracts script items from GitLab CI', () => {
  const cmds = extractCommands('gitlab', GITLAB).map((c) => c.cmd);
  assert.ok(cmds.includes('uv run pytest --cov=src'), cmds.join('|'));
  assert.ok(cmds.includes('uv run ruff check .'), cmds.join('|'));
});

test('extracts sh steps from a Jenkinsfile', () => {
  const cmds = extractCommands('jenkins', JENKINS).map((c) => c.cmd);
  assert.ok(cmds.includes('mvn test'), cmds.join('|'));
  assert.ok(cmds.includes('mvn verify -Pcoverage'), cmds.join('|'));
});

test('classifies commands into harness-relevant categories', () => {
  assert.strictEqual(classify('npm test -- --coverage'), 'coverage');
  assert.strictEqual(classify('uv run pytest --cov=src'), 'coverage');
  assert.strictEqual(classify('npx eslint src/'), 'lint');
  assert.strictEqual(classify('npx tsc --noEmit'), 'typecheck');
  assert.strictEqual(classify('mvn test'), 'test');
  assert.strictEqual(classify('./deploy.sh'), null);
});

test('CLI writes ci-map.md with per-source commands and an alignment section', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-ingest-'));
  fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.github', 'workflows', 'ci.yml'), GH_WORKFLOW);
  fs.writeFileSync(path.join(dir, '.gitlab-ci.yml'), GITLAB);
  const res = spawnSync('node', [script, '--root', dir], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  const out = fs.readFileSync(path.join(dir, 'specs', 'brownfield', 'ci-map.md'), 'utf8');
  assert.ok(out.includes('.github/workflows/ci.yml'), out);
  assert.ok(out.includes('npm test -- --coverage'), out);
  assert.ok(out.includes('uv run pytest --cov=src'), out);
  assert.ok(/alignment/i.test(out), out);
});

test('CLI reports no CI config without failing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-ingest-empty-'));
  const res = spawnSync('node', [script, '--root', dir], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  assert.ok(/no ci config/i.test(res.stdout), res.stdout);
});
