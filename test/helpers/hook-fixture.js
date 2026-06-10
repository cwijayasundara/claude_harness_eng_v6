const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');

// Hooks locate their project dir by walking up from their own location looking
// for `.claude`, so they must run from a copy inside a temp project — never
// from the repo, or tests would read/write the repo's real state files.
function makeHookProject(hookNames) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-fixture-'));
  const hooksDir = path.join(dir, '.claude', 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.mkdirSync(path.join(dir, '.claude', 'state'), { recursive: true });
  for (const name of hookNames) {
    fs.copyFileSync(
      path.join(REPO_ROOT, '.claude', 'hooks', name),
      path.join(hooksDir, name)
    );
  }
  return dir;
}

function runHook(projectDir, hookName, input, env) {
  const hookPath = path.join(projectDir, '.claude', 'hooks', hookName);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [hookPath], {
      cwd: projectDir,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
    child.stdin.end(JSON.stringify(input));
  });
}

module.exports = { REPO_ROOT, makeHookProject, runHook };
