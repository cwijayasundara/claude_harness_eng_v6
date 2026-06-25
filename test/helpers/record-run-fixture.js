const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');

// record-run.js requires telemetry-memory, which in turn requires
// telemetry-skill-helpers, telemetry-phase-eval, telemetry-ledger-rotate, and
// telemetry-pipeline-gauges (→ pipeline-snapshot → pipeline-state-readers →
// budget-state) — all must be present in the temp project or the hook child
// crashes with MODULE_NOT_FOUND.
const HOOK_DEP_SCRIPTS = [
  'telemetry-memory.js',
  'replay-telemetry.js',
  'telemetry-skill-helpers.js',
  'telemetry-phase-eval.js',
  'telemetry-ledger-rotate.js',
  'telemetry-pipeline-gauges.js',
  'pipeline-snapshot.js',
  'pipeline-state-readers.js',
  'budget-state.js',
];

const STATE_FILES = {
  'current-lane': 'improve',
  'current-mode': 'full',
  'current-iteration': '3',
  'current-group': 'group "A"',
  'current-story': 'story\\one',
};

const SKILL_DESCRIPTIONS = {
  brd: 'Create a business requirements document.',
  spec: 'Write implementation stories and acceptance criteria.',
  brownfield: 'Map an existing codebase before refactoring.',
};

function withGateway(handler) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for Pushgateway request')), 2000);
    const server = http.createServer((req, res) => {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        clearTimeout(timer);
        res.statusCode = 202;
        res.end('ok');
        resolve({ server, req, body });
      });
    });
    server.on('error', reject);
    // unref so a test that fails before calling server.close() can never keep
    // the runner's event loop alive — the suite still exits cleanly.
    server.unref();
    server.listen(0, '127.0.0.1', () => handler(server.address().port));
  });
}

// Like withGateway but the server replies with a configurable HTTP status code.
// Resolves with { server, req, body, statusCode } once the request is received.
function withGatewayStatus(statusCode, handler) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for Pushgateway request')), 2000);
    const server = http.createServer((req, res) => {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        clearTimeout(timer);
        res.statusCode = statusCode;
        res.end('error');
        resolve({ server, req, body, statusCode });
      });
    });
    server.on('error', reject);
    server.unref();
    server.listen(0, '127.0.0.1', () => handler(server.address().port));
  });
}

function withGatewayRequests(count, handler) {
  return new Promise((resolve, reject) => {
    const requests = [];
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${count} Pushgateway requests`)), 3000);
    const server = http.createServer((req, res) => {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        requests.push({ req, body });
        res.statusCode = 202;
        res.end('ok');
        if (requests.length === count) {
          clearTimeout(timer);
          resolve({ server, requests });
        }
      });
    });
    server.on('error', reject);
    // unref so a test that fails before calling server.close() can never keep
    // the runner's event loop alive — the suite still exits cleanly.
    server.unref();
    server.listen(0, '127.0.0.1', () => handler(server.address().port));
  });
}

function runHook(projectDir, input, env) {
  const hookPath = path.join(projectDir, '.claude', 'hooks', 'record-run.js');
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

function copyHarnessFiles(dir) {
  const hooksDir = path.join(dir, '.claude', 'hooks');
  const scriptsDir = path.join(dir, '.claude', 'scripts');
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.mkdirSync(path.join(hooksDir, 'lib'), { recursive: true });
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.copyFileSync(
    path.join(REPO_ROOT, '.claude', 'hooks', 'record-run.js'),
    path.join(hooksDir, 'record-run.js')
  );
  // record-run.js shares readHookInput with the other hooks via lib/common —
  // /scaffold copies the whole hooks/ dir, so production always has it.
  fs.copyFileSync(
    path.join(REPO_ROOT, '.claude', 'hooks', 'lib', 'common.js'),
    path.join(hooksDir, 'lib', 'common.js')
  );
  fs.copyFileSync(
    path.join(REPO_ROOT, '.claude', 'hooks', 'lib', 'record-skills.js'),
    path.join(hooksDir, 'lib', 'record-skills.js')
  );
  for (const scriptName of HOOK_DEP_SCRIPTS) {
    const source = path.join(REPO_ROOT, '.claude', 'scripts', scriptName);
    if (fs.existsSync(source)) {
      fs.copyFileSync(source, path.join(scriptsDir, scriptName));
    }
  }
}

function writeState(dir) {
  const stateDir = path.join(dir, '.claude', 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  for (const [name, value] of Object.entries(STATE_FILES)) {
    fs.writeFileSync(path.join(stateDir, name), value);
  }
}

function writeSkills(dir) {
  const skillsDir = path.join(dir, '.claude', 'skills');
  for (const [name, description] of Object.entries(SKILL_DESCRIPTIONS)) {
    const skillDir = path.join(skillsDir, name);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`
    );
  }
}

function makeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'record-run-hook-'));
  copyHarnessFiles(dir);
  writeState(dir);
  writeSkills(dir);
  return dir;
}

module.exports = { withGateway, withGatewayRequests, withGatewayStatus, runHook, makeProject };
