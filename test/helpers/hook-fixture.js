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
  const libSrc = path.join(REPO_ROOT, '.claude', 'hooks', 'lib');
  if (fs.existsSync(libSrc)) {
    fs.cpSync(libSrc, path.join(hooksDir, 'lib'), { recursive: true });
  }
  for (const name of hookNames) {
    fs.copyFileSync(
      path.join(REPO_ROOT, '.claude', 'hooks', name),
      path.join(hooksDir, name)
    );
  }
  return dir;
}

// For the git pre-commit hook: a real temp git repo with .claude/ and the hook installed.
function makeGitProject() {
  const dir = makeHookProject([]);
  const gitHooksSrc = path.join(REPO_ROOT, '.claude', 'git-hooks');
  if (fs.existsSync(gitHooksSrc)) {
    fs.cpSync(gitHooksSrc, path.join(dir, '.claude', 'git-hooks'), { recursive: true });
  }
  const { execSync } = require('child_process');
  execSync('git init -q && git config user.email t@t.t && git config user.name t', { cwd: dir });
  return dir;
}

// args: optional array of positional arguments forwarded to the hook script
// (e.g. the commit-message file path for commit-msg hooks).
function runGitHook(projectDir, hookName, env, args) {
  const hookPath = path.join(projectDir, '.claude', 'git-hooks', hookName);
  const hookArgs = Array.isArray(args) ? args : [];
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [hookPath, ...hookArgs], {
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
    child.stdin.end();
  });
}

function runHook(projectDir, hookName, input, env) {
  const hookPath = path.join(projectDir, '.claude', 'hooks', hookName);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [hookPath], {
      cwd: projectDir,
      // CLAUDE_PROJECT_DIR is what Claude Code sets for hook processes; it must
      // point at the fixture project, not whatever repo is running the tests.
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, ...env },
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

module.exports = { REPO_ROOT, makeHookProject, makeGitProject, runHook, runGitHook };
