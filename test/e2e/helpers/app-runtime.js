'use strict';

// App-runtime helpers for the self-healing smoke: launch the generated web app,
// wait for its port, drive it with a headless browser, and capture diagnostics
// (console errors + screenshot) when an assertion fails so the fix loop has
// something concrete to feed back to /change.
//
// Playwright is required lazily: this module must load (for the static contract
// test and the unit test) even when the browser dep is not installed. Only the
// live browser assertion needs it.

const net = require('net');
const { spawn, execFileSync } = require('child_process');

const DEFAULT_PORT = 4417; // avoid 4317, the OTEL grpc port the e2e runner uses

function sleepSync(ms) {
  // Synchronous pause with no child process — gives the kernel time to release a
  // socket after SIGKILL before we re-check / rebind.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Kill anything still LISTENing on `port` and wait until the port is actually
// free. A server leaked by a prior attempt's stopApp stays bound to our fixed
// PORT, and waitForPort only checks "is something listening" — so without this
// the next attempt's browser silently talks to the STALE server (old code),
// producing false-negative failures. SIGKILL is delivered asynchronously, so we
// poll until lsof reports no listener (bounded to ~2s).
function freePort(port) {
  for (let i = 0; i < 20; i++) {
    let pids;
    try {
      pids = execFileSync('lsof', ['-tiTCP:' + port, '-sTCP:LISTEN'], { encoding: 'utf8' });
    } catch (_) {
      return; // lsof exits non-zero when nothing is listening — port is free
    }
    const listeners = pids.split('\n').map((s) => s.trim()).filter(Boolean);
    if (listeners.length === 0) return;
    for (const pid of listeners) {
      try { process.kill(Number(pid), 'SIGKILL'); } catch (_) { /* already gone */ }
    }
    sleepSync(100);
  }
}

function waitForPort(port, host, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect(port, host);
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline) reject(new Error(`app did not open ${host}:${port} within ${timeoutMs}ms`));
        else setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

// Start the generated app on a fixed PORT and wait until it accepts connections.
// The smoke prompt instructs the app to honor process.env.PORT, so the harness
// owns the port rather than guessing it. detached so the whole process group can
// be killed (a dev server often spawns children that outlive a bare proc.kill).
async function startApp(projectDir, { port = DEFAULT_PORT, startTimeoutMs = 30000 } = {}) {
  freePort(port); // reap a leaked server from a prior attempt before we reuse the port
  const proc = spawn('npm', ['start', '--silent'], {
    cwd: projectDir,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  const logs = [];
  proc.stdout.on('data', (d) => logs.push(d.toString()));
  proc.stderr.on('data', (d) => logs.push(d.toString()));

  try {
    await waitForPort(port, '127.0.0.1', startTimeoutMs);
  } catch (err) {
    stopApp({ proc, port });
    throw new Error(`${err.message}\n--- app output ---\n${logs.join('').slice(-1500)}`);
  }
  return { proc, port, baseUrl: `http://127.0.0.1:${port}`, logs };
}

function stopApp(handle) {
  if (!handle) return;
  if (handle.proc && handle.proc.pid && !handle.proc.killed) {
    try { process.kill(-handle.proc.pid, 'SIGKILL'); } catch (_) { /* no group / already gone */ }
    try { handle.proc.kill('SIGKILL'); } catch (_) { /* already gone */ }
  }
  // Group-kill can miss a node grandchild that reparented; reap by port so the
  // next startApp (or the suite's exit) is never poisoned by a survivor.
  if (handle.port) freePort(handle.port);
}

// Drive the running app in a headless browser. `steps` is an async fn given the
// Playwright `page`; it performs clicks/reads and throws on a failed expectation.
// Returns { ok, error, consoleErrors, screenshot } so a failure yields a concrete
// repair signal for the fix loop.
async function assertInBrowser(baseUrl, steps, { screenshotPath } = {}) {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (_) {
    throw new Error('playwright not installed — run `npm install && npm run install:browser` from the repo root');
  }
  const consoleErrors = [];
  const browser = await chromium.launch({ headless: true });
  let page;
  try {
    page = await browser.newPage();
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => consoleErrors.push(String(e)));
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await steps(page);
    return { ok: true, consoleErrors };
  } catch (error) {
    let screenshot = null;
    if (screenshotPath && page) {
      try { await page.screenshot({ path: screenshotPath }); screenshot = screenshotPath; }
      catch (_) { /* best effort */ }
    }
    return { ok: false, error: String((error && error.message) || error), consoleErrors, screenshot };
  } finally {
    await browser.close();
  }
}

module.exports = { startApp, stopApp, assertInBrowser, waitForPort, DEFAULT_PORT };
