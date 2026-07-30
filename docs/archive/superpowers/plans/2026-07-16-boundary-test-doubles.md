# Deterministic External-Boundary Testing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the external-boundary test-double kit (DB/HTTP/LLM), a hard-block `live-externals` sensor, and replay-mode for the regression gates, so the harness's live-integration test/regression story becomes deterministic.

**Architecture:** One env flag — `HARNESS_TEST_REPLAY=1` — is honored at each external-API wrapper boundary and by a shipped `conftest.py`, so the app's DB/HTTP/LLM become recorded doubles. A commit-time lint gate (`live-externals`) flags tests that reach real externals; the regression gates force the flag on their child processes and treat a *missing fixture* as a "live external would have been reached" hard fail (portable, no OS-level network jail needed in v1).

**Tech Stack:** Node.js (harness gates/scripts, `node:test`), Python (shipped kit templates — stdlib `json`/`hashlib`/`pathlib` for the round-trippable pieces; `pytest`/SQLAlchemy for the project-stack DB fixture template), JSON (manifest).

## Global Constraints

- Scope is **Python/FastAPI backend, all three boundaries (DB, HTTP, LLM)**. TS/React, Go, quarantine-hygiene, and full integration-suite auto-synthesis are **out of scope** (later gaps).
- The binding flag is exactly `HARNESS_TEST_REPLAY` with value `"1"` — verbatim, everywhere.
- Gap ids: kit guide = **G34**, sensor = **G36**. (G35 — the `/test` generation step — is folded into this v1 as Increment 4 under the G34 umbrella; do not mint a separate manifest gap for it.)
- Every new gate must **degrade loudly, never silently**: missing script → `noteSkip`; env `=off` → `noteSkip`; never fail-open silent.
- Escape-hatch env var: `HARNESS_LIVE_EXTERNALS_GATE=off` (mirrors `HARNESS_TEST_DELETION_GATE=off`).
- New sensor blocking level: **hard-block**, `minTier: 'standard'`, waivable via `specs/reviews/sensor-waivers.json` (`sensor_id: "live-externals"`).
- `harness-manifest.json` invariant: every `active` entry's `wired_at` must point at a file that exists. Enforced by `node .claude/scripts/validate-harness-manifest.js`.
- `npm test` must be green at the end of every increment (each increment is independently committable).
- Do not edit `CLAUDE.md`, `.mcp.json`, or `.claude/settings*.json` (prefix-cache gate).

---

## File Structure

**New (kit templates):**
- `.claude/templates/boundary-doubles/replay_transport.py` — HTTP record/replay at the wrapper `_call` seam.
- `.claude/templates/boundary-doubles/fake_llm.py` — deterministic LLM client, golden structured responses keyed by request hash.
- `.claude/templates/boundary-doubles/db_fixture.py` — transactional-isolation pytest fixture (real engine, rolled back).
- `.claude/templates/boundary-doubles/conftest.py` — binds the doubles under the flag.
- `.claude/templates/at-template.py` — Ports-and-Adapters acceptance-test example with a fake adapter.

**New (sensor):**
- `.claude/hooks/lib/live-externals-gate.js` — pure classification (no git, no fs of the repo).
- `.claude/scripts/live-externals-gate.js` — git plumbing + CLI.
- `test/live-externals-gate.test.js`, `test/live-externals-gate-cli.test.js`, `test/pre-commit-git-hook-live-externals.test.js`.
- `test/boundary-doubles-roundtrip.test.js` — real Python record→replay round-trip (skips loudly without `python3`).

**Modified:**
- `.claude/hooks/lib/gates-early.js` — add `checkLiveExternalsGate` wrapper + export.
- `.claude/hooks/lib/gate-registry.js` — add one `GATE_CATALOG` entry.
- `.claude/hooks/lib/regression-gate.js`, `.claude/scripts/regression-gate.js`, `.claude/scripts/local-regression-gate.js` — replay mode.
- `.claude/skills/test/SKILL.md` — integration-generation step (Step 4.7).
- `.claude/skills/auto/SKILL.md`, `.claude/skills/evaluate/SKILL.md` — boot app in replay mode for regression.
- `.claude/skills/writing-acceptance-tests-first/SKILL.md` — reference the shipped AT template.
- `.claude/skills/code-gen/references/api-integration-patterns.md`, `test-strategy.md`, `tests-python.md` — point at the kit; resolve the SQLite contradiction.
- `.claude/scripts/scaffold-copy.js` — `CORE_SCRIPTS += 'live-externals-gate.js'`.
- `harness-manifest.json`, `HARNESS.md`, `docs/sensor-arbitration.md`, `package.json`.

---

# Increment 1 — G34 kit templates (record/replay doubles)

### Task 1: HTTP replay transport template

**Files:**
- Create: `.claude/templates/boundary-doubles/replay_transport.py`
- Test: `test/boundary-doubles-roundtrip.test.js` (created in Task 3; this task's code is exercised there)

**Interfaces:**
- Produces: `ReplayTransport(service_name, fixtures_root="tests/fixtures")` with `.replay(operation) -> dict`, `.record(operation, response) -> Path`, `.path_for(operation) -> Path`; module fn `replay_enabled() -> bool`; exception `MissingFixtureError`.

- [ ] **Step 1: Write the template**

```python
# .claude/templates/boundary-doubles/replay_transport.py
"""Record/replay transport for external-API wrappers (boundary-test-doubles kit, gap G34).

A wrapper delegates its `_call` seam to a ReplayTransport. Under
HARNESS_TEST_REPLAY=1 it serves a recorded golden fixture instead of hitting the
network, making integration and regression tests deterministic. Recording is a
one-time step run with the flag unset against the real service.
"""
import json
import os
from pathlib import Path


def replay_enabled() -> bool:
    return os.environ.get("HARNESS_TEST_REPLAY") == "1"


class MissingFixtureError(RuntimeError):
    """Raised in replay mode when no recorded fixture exists for an operation.

    In a forced-replay regression run this signals that the code path would have
    reached a live external — a hard failure, not a fallback to the network.
    """


class ReplayTransport:
    def __init__(self, service_name: str, fixtures_root: str = "tests/fixtures"):
        self._service = service_name
        self._dir = Path(fixtures_root) / service_name

    def path_for(self, operation: str) -> Path:
        return self._dir / f"{operation}.json"

    def replay(self, operation: str) -> dict:
        p = self.path_for(operation)
        if not p.exists():
            raise MissingFixtureError(
                f"no recorded fixture for {self._service}/{operation} at {p}; "
                f"record it once with HARNESS_TEST_REPLAY unset via ReplayTransport.record()"
            )
        return json.loads(p.read_text())

    def record(self, operation: str, response: dict) -> Path:
        self._dir.mkdir(parents=True, exist_ok=True)
        p = self.path_for(operation)
        p.write_text(json.dumps(response, indent=2, sort_keys=True))
        return p
```

- [ ] **Step 2: Sanity-check syntax**

Run: `python3 -m py_compile .claude/templates/boundary-doubles/replay_transport.py`
Expected: exit 0, no output. (If `python3` is absent, note it and continue — Task 3's round-trip test degrades loudly.)

- [ ] **Step 3: Commit**

```bash
git add .claude/templates/boundary-doubles/replay_transport.py
git commit -m "feat(boundary-doubles): HTTP replay transport template (G34)"
```

### Task 2: Fake LLM client template

**Files:**
- Create: `.claude/templates/boundary-doubles/fake_llm.py`

**Interfaces:**
- Produces: `FakeLLMClient(fixtures_root="tests/fixtures/llm")` with `.respond(operation, payload) -> dict`, `.record_golden(operation, payload, response) -> Path`; module fn `request_key(payload) -> str` (16-char sha256 of canonical JSON); exception `GoldenNotFoundError`.

- [ ] **Step 1: Write the template**

```python
# .claude/templates/boundary-doubles/fake_llm.py
"""Deterministic fake LLM client (boundary-test-doubles kit, gap G34).

Returns golden structured responses keyed by (operation, stable request hash) so
LLM-backed flows are deterministic in tests. code-gen mandates tool_use/JSON-schema
output, so the golden is a validated JSON object, not free text. Drop-in for the
LLM wrapper's SDK client under HARNESS_TEST_REPLAY=1.
"""
import hashlib
import json
from pathlib import Path


def request_key(payload: dict) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


class GoldenNotFoundError(RuntimeError):
    """Raised in replay mode when no golden response exists for a request.

    In a forced-replay regression run this signals the flow would have called the
    real model — a hard failure, not a live call.
    """


class FakeLLMClient:
    def __init__(self, fixtures_root: str = "tests/fixtures/llm"):
        self._dir = Path(fixtures_root)

    def _path(self, operation: str, key: str) -> Path:
        return self._dir / operation / f"{key}.json"

    def respond(self, operation: str, payload: dict) -> dict:
        key = request_key(payload)
        p = self._path(operation, key)
        if not p.exists():
            raise GoldenNotFoundError(
                f"no golden LLM response for {operation}/{key} at {p}; "
                f"record it once against the real model via record_golden()"
            )
        return json.loads(p.read_text())

    def record_golden(self, operation: str, payload: dict, response: dict) -> Path:
        key = request_key(payload)
        p = self._path(operation, key)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(response, indent=2, sort_keys=True))
        return p
```

- [ ] **Step 2: Sanity-check syntax**

Run: `python3 -m py_compile .claude/templates/boundary-doubles/fake_llm.py`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add .claude/templates/boundary-doubles/fake_llm.py
git commit -m "feat(boundary-doubles): deterministic fake LLM client template (G34)"
```

### Task 3: Real record→replay round-trip test (Python via node:test)

**Files:**
- Create: `test/boundary-doubles-roundtrip.test.js`

**Interfaces:**
- Consumes: `ReplayTransport` (Task 1), `FakeLLMClient`/`request_key` (Task 2).

- [ ] **Step 1: Write the failing test**

```js
// test/boundary-doubles-roundtrip.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function hasPython() {
  return spawnSync('python3', ['--version'], { encoding: 'utf8' }).status === 0;
}

const TEMPLATES = path.join(__dirname, '..', '.claude', 'templates', 'boundary-doubles');

function runPy(script, cwd) {
  return spawnSync('python3', ['-c', script], { cwd, encoding: 'utf8' });
}

test('ReplayTransport records then replays a byte-identical fixture', (t) => {
  if (!hasPython()) { t.skip('python3 unavailable — round-trip skipped LOUDLY (not silently passed)'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdrt-'));
  fs.copyFileSync(path.join(TEMPLATES, 'replay_transport.py'), path.join(dir, 'replay_transport.py'));
  const script = [
    'from replay_transport import ReplayTransport',
    't = ReplayTransport("svc", "fixtures")',
    't.record("op", {"z": 1, "a": 2})',
    'import os; os.environ["HARNESS_TEST_REPLAY"]="1"',
    'assert t.replay("op") == {"z": 1, "a": 2}',
    'print("OK")',
  ].join('\n');
  const r = runPy(script, dir);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /OK/);
});

test('FakeLLMClient replays a golden keyed by stable request hash', (t) => {
  if (!hasPython()) { t.skip('python3 unavailable — round-trip skipped LOUDLY'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdrt-'));
  fs.copyFileSync(path.join(TEMPLATES, 'fake_llm.py'), path.join(dir, 'fake_llm.py'));
  const script = [
    'from fake_llm import FakeLLMClient, request_key',
    'c = FakeLLMClient("llm")',
    'payload = {"prompt": "hi", "n": 3}',
    'c.record_golden("classify", payload, {"label": "greeting"})',
    'assert c.respond("classify", {"n": 3, "prompt": "hi"}) == {"label": "greeting"}',  // key order-independent
    'assert request_key({"a":1,"b":2}) == request_key({"b":2,"a":1})',
    'print("OK")',
  ].join('\n');
  const r = runPy(script, dir);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /OK/);
});

test('MissingFixtureError raised in replay mode when no fixture exists', (t) => {
  if (!hasPython()) { t.skip('python3 unavailable — round-trip skipped LOUDLY'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdrt-'));
  fs.copyFileSync(path.join(TEMPLATES, 'replay_transport.py'), path.join(dir, 'replay_transport.py'));
  const script = [
    'from replay_transport import ReplayTransport, MissingFixtureError',
    't = ReplayTransport("svc", "fixtures")',
    'try:',
    '    t.replay("never-recorded"); print("NO-RAISE")',
    'except MissingFixtureError:',
    '    print("OK")',
  ].join('\n');
  const r = runPy(script, dir);
  assert.match(r.stdout, /OK/);
});
```

- [ ] **Step 2: Run to verify it passes (Tasks 1-2 already implemented)**

Run: `node --test test/boundary-doubles-roundtrip.test.js`
Expected: PASS (or SKIP with a loud message if `python3` is unavailable). If a real assertion fails, fix the template, not the test.

- [ ] **Step 3: Commit**

```bash
git add test/boundary-doubles-roundtrip.test.js
git commit -m "test(boundary-doubles): real python record->replay round-trip (G34)"
```

### Task 4: DB transactional-isolation fixture, conftest, and AT template

**Files:**
- Create: `.claude/templates/boundary-doubles/db_fixture.py`
- Create: `.claude/templates/boundary-doubles/conftest.py`
- Create: `.claude/templates/at-template.py`

**Interfaces:**
- Produces: pytest fixture `db_session`; conftest fixture `llm_client`; a Ports-and-Adapters AT example (`FakeAccountStore`, a Given/When/Then test).

- [ ] **Step 1: Write the DB fixture template**

```python
# .claude/templates/boundary-doubles/db_fixture.py
"""Transactional-isolation DB fixture (boundary-test-doubles kit, gap G34).

Keeps a REAL engine (honoring test-strategy.md's "real DB" doctrine) but wraps
each test in a transaction rolled back at teardown, against a deterministic seed —
fast and deterministic without a fake engine. In-memory SQLite is an approved fast
path when TEST_DATABASE_URL is unset. Requires the project's SQLAlchemy stack.
"""
import os
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


def _engine_url() -> str:
    return os.environ.get("TEST_DATABASE_URL", "sqlite+pysqlite:///:memory:")


@pytest.fixture
def db_session(seed):
    """`seed` is a project-provided fixture: callable(session) -> None."""
    engine = create_engine(_engine_url())
    connection = engine.connect()
    trans = connection.begin()
    Session = sessionmaker(bind=connection)
    session = Session()
    seed(session)
    try:
        yield session
    finally:
        session.close()
        trans.rollback()
        connection.close()
```

- [ ] **Step 2: Write the conftest template**

```python
# .claude/templates/boundary-doubles/conftest.py
"""Kit conftest — binds the boundary doubles under HARNESS_TEST_REPLAY=1
(boundary-test-doubles kit, gap G34). Copy/merge into the project's tests/ tree.
The app's external-API wrappers read HARNESS_TEST_REPLAY at their own boundary;
this file supplies the fake LLM client. The db_session fixture lives in db_fixture.py.
"""
import os
import pytest

from .fake_llm import FakeLLMClient


def replay_enabled() -> bool:
    return os.environ.get("HARNESS_TEST_REPLAY") == "1"


@pytest.fixture
def llm_client():
    if replay_enabled():
        return FakeLLMClient()
    raise RuntimeError(
        "llm_client requested without HARNESS_TEST_REPLAY=1; integration and "
        "regression tests must run in replay mode (see the live-externals gate, G36)"
    )
```

- [ ] **Step 3: Write the AT template**

```python
# .claude/templates/at-template.py
"""Acceptance-test template — Ports-and-Adapters with a fake adapter
(boundary-test-doubles kit, gap G34). Copy to specs/test_artefacts/at-template.py
and adapt per story, so writing-acceptance-tests-first has a concrete house pattern
instead of hand-rolling the first AT.

GIVEN a valid registration request
WHEN the account is registered through the business port
THEN an account exists with the given email
"""
from dataclasses import dataclass, field


class AccountStore:  # Port: the narrow I/O interface the business logic depends on
    def save(self, email: str) -> str: ...
    def exists(self, email: str) -> bool: ...


@dataclass
class FakeAccountStore(AccountStore):  # Test-double adapter: fast, in-memory, deterministic
    _emails: set = field(default_factory=set)

    def save(self, email: str) -> str:
        self._emails.add(email)
        return email

    def exists(self, email: str) -> bool:
        return email in self._emails


def test_registering_a_valid_email_creates_an_account():
    # GIVEN an empty account store
    store = FakeAccountStore()
    from app.accounts import register  # the business port entry point

    # WHEN a valid email is registered through the port
    register("ada@example.com", store=store)

    # THEN an account exists for that email
    assert store.exists("ada@example.com")
```

- [ ] **Step 4: Syntax-check all three**

Run: `python3 -m py_compile .claude/templates/at-template.py .claude/templates/boundary-doubles/conftest.py`
Expected: exit 0. (`db_fixture.py` imports SQLAlchemy — skip compiling it if SQLAlchemy is absent; it is a project-stack template, validated in a scaffolded project, not here.)

- [ ] **Step 5: Commit**

```bash
git add .claude/templates/boundary-doubles/db_fixture.py .claude/templates/boundary-doubles/conftest.py .claude/templates/at-template.py
git commit -m "feat(boundary-doubles): DB fixture, conftest, and AT templates (G34)"
```

---

# Increment 2 — G36 live-externals sensor (commit-time lint, hard-block)

### Task 5: Pure classifier (`hooks/lib/live-externals-gate.js`)

**Files:**
- Create: `.claude/hooks/lib/live-externals-gate.js`
- Test: `test/live-externals-gate.test.js`

**Interfaces:**
- Produces: `classifyFile(file, content) -> finding[]` and `classifyFiles(changes) -> finding[]` where `changes: [{file, content}]`; a finding is `{ file, line, kind, snippet }` with `kind ∈ {'live-url','live-dsn','sdk-client'}`.

- [ ] **Step 1: Write the failing test**

```js
// test/live-externals-gate.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { classifyFile, classifyFiles } = require('../.claude/hooks/lib/live-externals-gate');

test('flags a non-localhost http(s) URL literal', () => {
  const f = classifyFile('tests/integration/test_x.py', 'BASE = "https://api.stripe.com/v1"\n');
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0].kind, 'live-url');
  assert.strictEqual(f[0].line, 1);
});

test('does NOT flag localhost / 127.0.0.1 / host.docker.internal', () => {
  const src = 'a="http://localhost:8000"\nb="http://127.0.0.1:5432"\nc="http://host.docker.internal"\n';
  assert.deepStrictEqual(classifyFile('tests/integration/t.py', src), []);
});

test('flags a real DB DSN with a non-local host', () => {
  const f = classifyFile('tests/integration/t.py', 'DB="postgres://user:pw@db.prod.example.com:5432/app"\n');
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0].kind, 'live-dsn');
});

test('does NOT flag a localhost DSN', () => {
  assert.deepStrictEqual(classifyFile('tests/integration/t.py', 'DB="postgresql://localhost/test"\n'), []);
});

test('flags direct SDK client construction', () => {
  const f = classifyFile('tests/integration/t.py', 'client = Anthropic(api_key=k)\n');
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0].kind, 'sdk-client');
});

test('ignores files outside the integration/e2e scope', () => {
  // classifyFiles applies scope; classifyFile is content-only and always classifies.
  assert.deepStrictEqual(classifyFiles([{ file: 'src/app.py', content: 'client = Anthropic()\n' }]), []);
});

test('classifyFiles scopes to tests/integration and e2e', () => {
  const findings = classifyFiles([
    { file: 'tests/integration/a.py', content: 'x="https://api.openai.com"\n' },
    { file: 'src/prod.py', content: 'x="https://api.openai.com"\n' },
  ]);
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].file, 'tests/integration/a.py');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/live-externals-gate.test.js`
Expected: FAIL — `Cannot find module '../.claude/hooks/lib/live-externals-gate'`.

- [ ] **Step 3: Write the implementation**

```js
// .claude/hooks/lib/live-externals-gate.js
'use strict';

// Pure content classification for the live-externals sensor (gap G36).
// No git, no repo fs here — git plumbing lives in scripts/live-externals-gate.js
// (same split test-deletion-gate.js / legacy-discipline-gate.js use).

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '0.0.0.0', 'host.docker.internal', '::1'];
const IN_SCOPE = /(^|\/)(tests\/integration\/|e2e\/)/;

function isLocalHost(host) {
  const h = host.toLowerCase();
  return LOCAL_HOSTS.some((l) => h === l || h.startsWith(l + ':') || h.startsWith(l + '/'));
}

const URL_RE = /https?:\/\/([a-z0-9._-]+(?::\d+)?)/gi;
const DSN_RE = /\b(?:postgres|postgresql|mysql|mongodb|redis)(?:\+\w+)?:\/\/(?:[^@\s"']*@)?([a-z0-9._-]+(?::\d+)?)/gi;
const SDK_RE = /\b(?:Anthropic|OpenAI|anthropic\.Client|openai\.OpenAI)\s*\(/;

function classifyFile(file, content) {
  const findings = [];
  const lines = content.split('\n');
  lines.forEach((text, i) => {
    const line = i + 1;
    for (const m of text.matchAll(URL_RE)) {
      const host = m[1].split(/[:/]/)[0];
      if (!isLocalHost(m[1]) && !isLocalHost(host)) findings.push({ file, line, kind: 'live-url', snippet: m[0] });
    }
    for (const m of text.matchAll(DSN_RE)) {
      const host = m[1].split(/[:/]/)[0];
      if (!isLocalHost(m[1]) && !isLocalHost(host)) findings.push({ file, line, kind: 'live-dsn', snippet: m[0] });
    }
    if (SDK_RE.test(text)) findings.push({ file, line, kind: 'sdk-client', snippet: text.trim().slice(0, 80) });
  });
  return findings;
}

function classifyFiles(changes) {
  return changes
    .filter((c) => IN_SCOPE.test(c.file))
    .flatMap((c) => classifyFile(c.file, c.content));
}

module.exports = { classifyFile, classifyFiles, isLocalHost };
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/live-externals-gate.test.js`
Expected: PASS (all 7).

- [ ] **Step 5: Commit**

```bash
git add .claude/hooks/lib/live-externals-gate.js test/live-externals-gate.test.js
git commit -m "feat(live-externals): pure classifier for real-external test patterns (G36)"
```

### Task 6: Git-plumbing script + CLI (`scripts/live-externals-gate.js`)

**Files:**
- Create: `.claude/scripts/live-externals-gate.js`
- Test: `test/live-externals-gate-cli.test.js`

**Interfaces:**
- Consumes: `classifyFiles` (Task 5).
- Produces: `checkStaged(exec) -> {pass, findings}`, `findingLine(f) -> string`, `run(argv, root, deps) -> 0|1|2`.

- [ ] **Step 1: Write the failing test**

```js
// test/live-externals-gate-cli.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { checkStaged, run } = require('../.claude/scripts/live-externals-gate');

function fakeExec(map) {
  return (cmd, args) => {
    const key = args.join(' ');
    if (key in map) { const v = map[key]; if (v instanceof Error) throw v; return v; }
    throw new Error(`unstubbed git call: ${cmd} ${key}`);
  };
}

test('checkStaged flags a staged integration test hitting a live URL', () => {
  const exec = fakeExec({
    'diff --cached --name-only --diff-filter=ACM': 'tests/integration/t.py\nsrc/app.py\n',
    'show :tests/integration/t.py': 'x = "https://api.stripe.com"\n',
    'show :src/app.py': 'x = "https://api.stripe.com"\n',
  });
  const v = checkStaged(exec);
  assert.strictEqual(v.pass, false);
  assert.strictEqual(v.findings.length, 1);
  assert.strictEqual(v.findings[0].file, 'tests/integration/t.py');
});

test('checkStaged passes when integration tests only use localhost', () => {
  const exec = fakeExec({
    'diff --cached --name-only --diff-filter=ACM': 'tests/integration/t.py\n',
    'show :tests/integration/t.py': 'x = "http://localhost:8000"\n',
  });
  assert.strictEqual(checkStaged(exec).pass, true);
});

test('run returns 2 without --staged, 0 clean, 1 dirty', () => {
  const clean = fakeExec({ 'diff --cached --name-only --diff-filter=ACM': '' });
  assert.strictEqual(run([], '/x', { exec: clean }), 2);
  assert.strictEqual(run(['--staged'], '/x', { exec: clean }), 0);
  const dirty = fakeExec({
    'diff --cached --name-only --diff-filter=ACM': 'e2e/login.spec.ts\n',
    'show :e2e/login.spec.ts': 'await page.goto("https://staging.example.com")\n',
  });
  assert.strictEqual(run(['--staged'], '/x', { exec: dirty }), 1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/live-externals-gate-cli.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
// .claude/scripts/live-externals-gate.js
#!/usr/bin/env node
'use strict';

// CLI: node .claude/scripts/live-externals-gate.js --staged
// live-externals sensor (gap G36): git plumbing here; pure classification lives
// in hooks/lib/live-externals-gate.js (same split test-deletion-gate.js uses).

const { execFileSync } = require('child_process');
const { classifyFiles } = require('../hooks/lib/live-externals-gate');

function gitShow(exec, ref) {
  try { return String(exec('git', ['show', ref])); } catch (_) { return null; }
}

function stagedFiles(exec) {
  return String(exec('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM']))
    .split('\n').filter(Boolean);
}

function collectStaged(exec) {
  return stagedFiles(exec)
    .map((file) => ({ file, content: gitShow(exec, `:${file}`) }))
    .filter((c) => c.content !== null);
}

function checkStaged(exec) {
  const findings = classifyFiles(collectStaged(exec));
  return { pass: findings.length === 0, findings };
}

function findingLine(f) {
  const label = { 'live-url': 'LIVE URL    ', 'live-dsn': 'LIVE DB DSN ', 'sdk-client': 'RAW SDK     ' }[f.kind];
  return `  ${label} ${f.file}:${f.line}  ${f.snippet}`;
}

function reportVerdict(v) {
  process.stdout.write(`live-externals: ${v.pass ? 'PASS' : 'FAIL'} — ${v.findings.length} finding(s)\n`);
  for (const f of v.findings) process.stdout.write(`${findingLine(f)}\n`);
}

function run(argv, root, deps) {
  const exec = (deps && deps.exec) || ((cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8' }));
  if (argv[0] !== '--staged') { process.stderr.write('usage: live-externals-gate.js --staged\n'); return 2; }
  const v = checkStaged(exec);
  reportVerdict(v);
  return v.pass ? 0 : 1;
}

module.exports = { collectStaged, checkStaged, findingLine, run };

if (require.main === module) process.exit(run(process.argv.slice(2), process.cwd()));
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/live-externals-gate-cli.test.js`
Expected: PASS.

- [ ] **Step 5: Add the npm script**

In `package.json` scripts, after the `"test-deletion-gate"` line, add:
```json
"live-externals-gate": "node .claude/scripts/live-externals-gate.js --staged",
```

- [ ] **Step 6: Commit**

```bash
git add .claude/scripts/live-externals-gate.js test/live-externals-gate-cli.test.js package.json
git commit -m "feat(live-externals): git-plumbing CLI + npm script (G36)"
```

### Task 7: Wire the gate into pre-commit + integration test

**Files:**
- Modify: `.claude/hooks/lib/gates-early.js` (add wrapper + export)
- Modify: `.claude/hooks/lib/gate-registry.js` (add catalog entry)
- Test: `test/pre-commit-git-hook-live-externals.test.js`

**Interfaces:**
- Consumes: `checkStaged`/`findingLine` from Task 6; `failBlock`/`noteSkip`/`requireScript` (existing in `gates-early.js`'s imports from `pre-commit-util.js`).
- Produces: `early.checkLiveExternalsGate(ctx)`.

- [ ] **Step 1: Add the gate wrapper to `gates-early.js`**

Insert alongside `checkTestDeletionGate` (mirror it exactly):
```js
function checkLiveExternalsGate(ctx) {
  const { projectDir } = ctx;
  if (process.env.HARNESS_LIVE_EXTERNALS_GATE === 'off') {
    noteSkip('live-externals', 'HARNESS_LIVE_EXTERNALS_GATE=off');
    return;
  }
  let gate;
  try {
    gate = requireScript('live-externals-gate');
  } catch (_) {
    noteSkip('live-externals', 'sensor script missing or unloadable from .claude/scripts');
    return;
  }
  const exec = (cmd, args) => execFileSync(cmd, args, { cwd: projectDir, encoding: 'utf8' });
  const verdict = gate.checkStaged(exec);
  if (!verdict.pass) {
    failBlock({
      id: 'live-externals',
      title: 'live-externals (G36) — a staged integration/e2e test reaches a real external system',
      detail: `${verdict.findings.map(gate.findingLine).join('\n')}\n`,
      fix: 'route the call through the boundary-test-doubles kit: replay the HTTP wrapper (ReplayTransport), use FakeLLMClient for model calls, and the db_session transactional fixture — bind them under HARNESS_TEST_REPLAY=1. See .claude/templates/boundary-doubles/.',
      waive: 'genuine live-integration exception in specs/reviews/sensor-waivers.json (sensor_id: live-externals)',
      envOff: 'HARNESS_LIVE_EXTERNALS_GATE',
      minTier: 'standard',
    });
  }
}
```
Add `checkLiveExternalsGate,` to the `module.exports` block. Confirm `execFileSync` is already imported at the top of `gates-early.js` (it is — used by `checkTestDeletionGate`).

- [ ] **Step 2: Add the catalog entry in `gate-registry.js`**

Insert into `GATE_CATALOG` right after the `test-deletion-guard` line (it must run on delete-only/docs-only commits is NOT required — it only inspects added/modified test files — so `runsWithoutSource: false`, and it needs source; place it at order 36, before `stub-smell-gate`/`refactor-purity`):
```js
  { id: 'live-externals', order: 36, runsWithoutSource: false, run: early.checkLiveExternalsGate },
```

- [ ] **Step 3: Write the integration test**

```js
// test/pre-commit-git-hook-live-externals.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { makeGitProject, runGitHook } = require('./helpers/hook-fixture');
const { stage } = require('./helpers/pre-commit-fixtures');

const HOOK = 'pre-commit';
const ENV = { HARNESS_COVERAGE_GATE: 'off' };

function installScript(projectDir) {
  const dir = path.join(projectDir, '.claude', 'scripts');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(
    path.join(__dirname, '..', '.claude', 'scripts', 'live-externals-gate.js'),
    path.join(dir, 'live-externals-gate.js')
  );
}
function seed(projectDir) { execFileSync('git', ['commit', '-q', '-m', 'seed'], { cwd: projectDir }); }

test('live-externals: an integration test hitting a live URL BLOCKs', async () => {
  const p = makeGitProject();
  installScript(p);
  stage(p, 'README.md', '# seed\n'); seed(p);
  stage(p, 'tests/integration/test_pay.py', 'BASE = "https://api.stripe.com/v1"\n');
  const r = await runGitHook(p, HOOK, ENV);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /live-externals \(G36\)/);
  assert.match(r.stdout + r.stderr, /LIVE URL/);
});

test('live-externals: a localhost-only integration test passes', async () => {
  const p = makeGitProject();
  installScript(p);
  stage(p, 'README.md', '# seed\n'); seed(p);
  stage(p, 'tests/integration/test_ok.py', 'BASE = "http://localhost:8000"\n');
  const r = await runGitHook(p, HOOK, ENV);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});

test('live-externals: HARNESS_LIVE_EXTERNALS_GATE=off skips loudly on a violating diff', async () => {
  const p = makeGitProject();
  installScript(p);
  stage(p, 'README.md', '# seed\n'); seed(p);
  stage(p, 'tests/integration/test_pay.py', 'BASE = "https://api.stripe.com"\n');
  const r = await runGitHook(p, HOOK, { ...ENV, HARNESS_LIVE_EXTERNALS_GATE: 'off' });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /GATE SKIPPED — live-externals/);
});

test('live-externals: missing sensor script no-ops loudly rather than blocking', async () => {
  const p = makeGitProject(); // installScript intentionally NOT called
  stage(p, 'README.md', '# seed\n'); seed(p);
  stage(p, 'tests/integration/test_pay.py', 'BASE = "https://api.stripe.com"\n');
  const r = await runGitHook(p, HOOK, ENV);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /GATE SKIPPED — live-externals/);
});
```

- [ ] **Step 4: Run the integration test**

Run: `node --test test/pre-commit-git-hook-live-externals.test.js`
Expected: PASS (4 tests). If the fixture's tier config excludes order-36 gates, confirm `live-externals` is enabled at `standard` in `sensor-tier.js` (it inherits the default-on standard set; no tier edit needed unless a test shows otherwise).

- [ ] **Step 5: Commit**

```bash
git add .claude/hooks/lib/gates-early.js .claude/hooks/lib/gate-registry.js test/pre-commit-git-hook-live-externals.test.js
git commit -m "feat(live-externals): wire hard-block gate into pre-commit (G36)"
```

---

# Increment 3 — replay-mode regression + runtime "missing-fixture = fail" check

### Task 8: Force replay flag + missing-fixture detection in the regression gates

**Files:**
- Modify: `.claude/hooks/lib/regression-gate.js` (`runE2eSuite` env; a `LIVE_EXTERNAL_MARKERS` detector)
- Modify: `.claude/scripts/regression-gate.js` (`--replay` flag)
- Modify: `.claude/scripts/local-regression-gate.js` (`--replay` flag)
- Test: `test/regression-gate-replay.test.js`

**Interfaces:**
- Consumes: existing `runE2eSuite`, `regressPriorContract` from `hooks/lib/regression-gate.js`.
- Produces: exported `detectLiveExternalReach(output) -> boolean`; a `replay` option threaded into `runE2eSuite(opts)` that adds `HARNESS_TEST_REPLAY: '1'` to the child env; a `--replay` CLI flag on both gate scripts.

- [ ] **Step 1: Write the failing test**

```js
// test/regression-gate-replay.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { detectLiveExternalReach } = require('../.claude/hooks/lib/regression-gate');

test('detectLiveExternalReach true on MissingFixtureError in child output', () => {
  assert.strictEqual(detectLiveExternalReach('E   replay_transport.MissingFixtureError: no recorded fixture for stripe/charge'), true);
});
test('detectLiveExternalReach true on GoldenNotFoundError', () => {
  assert.strictEqual(detectLiveExternalReach('fake_llm.GoldenNotFoundError: no golden LLM response for classify/ab12'), true);
});
test('detectLiveExternalReach false on ordinary assertion failure', () => {
  assert.strictEqual(detectLiveExternalReach('AssertionError: expected 200 got 500'), false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/regression-gate-replay.test.js`
Expected: FAIL — `detectLiveExternalReach` is not exported.

- [ ] **Step 3: Implement in `hooks/lib/regression-gate.js`**

Add near the top-level helpers:
```js
const LIVE_EXTERNAL_MARKERS = /(MissingFixtureError|GoldenNotFoundError)/;
function detectLiveExternalReach(output) {
  return LIVE_EXTERNAL_MARKERS.test(String(output || ''));
}
```
In `runE2eSuite`, thread a `replay` option into the spawned child's env (locate the existing `spawnSync('npx', ['playwright', ...], { ... })` and merge env):
```js
function runE2eSuite(opts = {}) {
  const env = opts.replay ? { ...process.env, HARNESS_TEST_REPLAY: '1' } : process.env;
  const res = spawnSync('npx', ['playwright', 'test', '--reporter=json'], { cwd: opts.cwd || process.cwd(), encoding: 'utf8', env });
  // ...existing parsing unchanged...
  if (opts.replay && detectLiveExternalReach(res.stdout + res.stderr)) {
    return { liveExternalReached: true, raw: res.stdout + res.stderr };
  }
  return /* existing return */;
}
```
Add `detectLiveExternalReach` to `module.exports`.

- [ ] **Step 4: Add `--replay` to `scripts/regression-gate.js` and `scripts/local-regression-gate.js`**

Parse `--replay` from argv; pass `{ replay: true }` into `runE2eSuite`; when a run returns `liveExternalReached`, produce a `blocked` verdict with:
```
BLOCKED [regression-suite-full]: a regression test reached a LIVE external under forced replay
  A wrapper/LLM call had no recorded fixture — record it (HARNESS_TEST_REPLAY unset) or fix the test.
```
Set the app boot for the api_check phase to require replay: the script does not boot the app, so document in the block message that the app-under-test must be booted with HARNESS_TEST_REPLAY=1 (see Task 9). Keep non-`--replay` behavior byte-identical (default off, so existing tests are unaffected).

- [ ] **Step 5: Run all regression tests to verify no regressions**

Run: `node --test test/regression-gate.test.js test/local-regression-gate.test.js test/regression-gate-replay.test.js`
Expected: PASS (existing suites unchanged + new one green).

- [ ] **Step 6: Commit**

```bash
git add .claude/hooks/lib/regression-gate.js .claude/scripts/regression-gate.js .claude/scripts/local-regression-gate.js test/regression-gate-replay.test.js
git commit -m "feat(regression): replay mode + missing-fixture=live-reach hard fail (G15/G16)"
```

### Task 9: Boot the app in replay mode for regression (skill wiring)

**Files:**
- Modify: `.claude/skills/auto/SKILL.md` (pre-merge regression step boots app with the flag)
- Modify: `.claude/skills/evaluate/SKILL.md` (note replay boot option)
- Modify: `.claude/skills/gate/SKILL.md` (regression step passes `--replay`)
- Test: `test/replay-regression-wiring.test.js` (skill-text assertion, mirroring `test/canary-rollout-wiring.test.js`)

- [ ] **Step 1: Write the wiring test**

```js
// test/replay-regression-wiring.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('/gate regression step invokes replay mode', () => {
  assert.match(read('.claude/skills/gate/SKILL.md'), /--replay/);
});
test('/auto boots the app under HARNESS_TEST_REPLAY for pre-merge regression', () => {
  assert.match(read('.claude/skills/auto/SKILL.md'), /HARNESS_TEST_REPLAY/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/replay-regression-wiring.test.js`
Expected: FAIL.

- [ ] **Step 3: Edit the three skills**

In `/gate` and `/auto`, at the regression-gate invocation, add `--replay` and instruct: boot the app-under-test with `HARNESS_TEST_REPLAY=1` so its DB/HTTP/LLM resolve to the recorded doubles; a missing fixture is a hard fail meaning a test would have reached a live external. In `/evaluate`, note that `docker`/`local` boot may set `HARNESS_TEST_REPLAY=1` for deterministic Layer-1 regression.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/replay-regression-wiring.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/auto/SKILL.md .claude/skills/evaluate/SKILL.md .claude/skills/gate/SKILL.md test/replay-regression-wiring.test.js
git commit -m "feat(regression): boot app in replay mode for pre-merge regression (G15/G16)"
```

---

# Increment 4 — `/test` integration-generation step + AT-template reference

### Task 10: Add the integration-generation step to `/test` and reference the AT template

**Files:**
- Modify: `.claude/skills/test/SKILL.md` (new Step 4.7)
- Modify: `.claude/skills/writing-acceptance-tests-first/SKILL.md` (reference `.claude/templates/at-template.py`)
- Test: `test/integration-generation-wiring.test.js`

- [ ] **Step 1: Write the wiring test**

```js
// test/integration-generation-wiring.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('/test describes an integration-generation step binding the boundary doubles', () => {
  const s = read('.claude/skills/test/SKILL.md');
  assert.match(s, /tests\/integration\//);
  assert.match(s, /HARNESS_TEST_REPLAY/);
  assert.match(s, /boundary-doubles/);
});
test('writing-acceptance-tests-first references the shipped AT template', () => {
  assert.match(read('.claude/skills/writing-acceptance-tests-first/SKILL.md'), /at-template\.py|templates\/at-template/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/integration-generation-wiring.test.js`
Expected: FAIL.

- [ ] **Step 3: Edit `/test` — add Step 4.7 (after Step 4.6)**

Add a "Step 4.7 — Generate Integration Tests (`tests/integration/`)" section: for each story that crosses an external boundary (DB, HTTP, or LLM), generate a `tests/integration/` test that binds the boundary doubles from `.claude/templates/boundary-doubles/` (copy them into the project's `tests/` tree on first use), runs under `HARNESS_TEST_REPLAY=1`, and records each row in `integration-traces.json` with its `matrix_id`. State that these tests must not reach a live external (the `live-externals` gate, G36, blocks otherwise).

- [ ] **Step 4: Edit `writing-acceptance-tests-first` Process step 1**

Change "request the human-provided AT template" to also point at the shipped default: "If none exists, copy `.claude/templates/at-template.py` as the starting house pattern, then flag it for human confirmation."

- [ ] **Step 5: Run to verify it passes + commit**

Run: `node --test test/integration-generation-wiring.test.js`
Expected: PASS.
```bash
git add .claude/skills/test/SKILL.md .claude/skills/writing-acceptance-tests-first/SKILL.md test/integration-generation-wiring.test.js
git commit -m "feat(test): integration-generation step binding boundary doubles (G34)"
```

---

# Increment 5 — Registration (manifest, HARNESS.md, scaffold, arbitration)

### Task 11: Register the guide + sensor in `harness-manifest.json`

**Files:**
- Modify: `harness-manifest.json`

- [ ] **Step 1: Add the guide entry to `guides[]`**

```json
{ "id": "boundary-test-doubles", "axis": "behaviour", "kind": "feedforward", "wired_at": ".claude/templates/boundary-doubles/replay_transport.py", "status": "active", "gap_ref": "G34", "description": "Shipped record/replay test-double kit (DB transactional fixture, HTTP ReplayTransport, deterministic FakeLLMClient with golden structured responses) bound under HARNESS_TEST_REPLAY=1, plus a Ports-and-Adapters AT template. Converts the harness's live-integration test story into a deterministic one; the /test integration-generation step and the live-externals sensor (G36) consume it." }
```

- [ ] **Step 2: Add the sensor entry to `sensors[]` (near `test-deletion-guard`)**

```json
{ "id": "live-externals", "axis": "behaviour", "type": "computational", "cadence": "commit", "status": "active", "scope": "artifacts", "gap_ref": "G36", "wired_at": ".claude/scripts/live-externals-gate.js", "signal": "a staged tests/integration or e2e test reaches a real external system — a non-localhost http(s) URL, a real DB DSN, or a directly-constructed LLM/HTTP SDK client instead of the boundary-test-doubles kit", "description": "Hybrid live-externals gate (gap G36). Commit half: this computational lint BLOCKs a staged integration/e2e test that reaches a real DB/HTTP/LLM instead of the G34 doubles. Runtime half: the regression gates (G15/G16) force HARNESS_TEST_REPLAY=1 and treat a missing fixture (MissingFixtureError/GoldenNotFoundError) as a live-external reach — a hard fail. KNOWN LIMITATIONS (disclosed): the lint is heuristic regex, not an AST parse (dynamically constructed URLs/clients can be missed); the wrapper-honors-the-flag check is enforced at runtime, not at lint time; v1 covers the Python backend only." }
```

- [ ] **Step 3: Validate**

Run: `node .claude/scripts/validate-harness-manifest.js`
Expected: exit 0 (both `wired_at` paths exist). If it reports a missing path, ensure the template/script from earlier increments is committed.

- [ ] **Step 4: Commit**

```bash
git add harness-manifest.json
git commit -m "docs(harness): register boundary-test-doubles (G34) + live-externals (G36)"
```

### Task 12: Update `HARNESS.md` (matrix rows + gap entries)

**Files:**
- Modify: `HARNESS.md`

- [ ] **Step 1: Add to the Behaviour matrix**

In the Behaviour "Guides" cell add `✅ **boundary-test-doubles** (record/replay DB/HTTP/LLM kit, G34)`; in the "Sensors" cell add `✅ **live-externals** (blocks tests reaching real externals, G36)`. Update the `regression-suite-full`/`impact-scoped-regression` sensor notes to add "(replay mode: forces HARNESS_TEST_REPLAY, missing fixture = live-external reach = hard fail)".

- [ ] **Step 2: Add G34 + G36 gap entries**

After the G33 entry, add two `- **G34** ✅ **done** — …` and `- **G36** ✅ **done** — …` bullets summarizing the kit and the sensor, matching the house prose style (what it does, how it's wired, disclosed limitations, registry placement). Note explicitly that G35 (the `/test` integration-generation step) is folded into G34's v1 rather than minted separately.

- [ ] **Step 3: Commit**

```bash
git add HARNESS.md
git commit -m "docs(harness): HARNESS.md matrix + G34/G36 gap entries"
```

### Task 13: Scaffold-copy + sensor-arbitration + full suite

**Files:**
- Modify: `.claude/scripts/scaffold-copy.js`
- Modify: `docs/sensor-arbitration.md`

- [ ] **Step 1: Add the script to `CORE_SCRIPTS`**

In `.claude/scripts/scaffold-copy.js`, add `'live-externals-gate.js',` to the `CORE_SCRIPTS` array (near `'test-deletion-gate.js'`). Confirm `.claude/templates/` is copied wholesale by the scaffold (like `hooks/`); if templates are copied by name, add the `boundary-doubles/` files and `at-template.py` to the relevant template list. Verify by reading the scaffold's template-copy step.

- [ ] **Step 2: Add the sensor-arbitration worked classification**

In `docs/sensor-arbitration.md`, add a "Worked Classification" subsection for `live-externals`: declare it `hard-block`; waivable via `sensor-waivers.json` (`sensor_id: "live-externals"`, `scope` naming the specific test file, a concrete `reason`, an `expires` condition, `approved_by`); note `HARNESS_LIVE_EXTERNALS_GATE=off` is a local unreviewed escape hatch.

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: green, including `test/scaffold-copy-completeness.test.js` (the new script is in `CORE_SCRIPTS`) and `validate-harness-manifest`. Fix any failure before committing.

- [ ] **Step 4: Commit**

```bash
git add .claude/scripts/scaffold-copy.js docs/sensor-arbitration.md
git commit -m "docs(harness): scaffold-copy + sensor-arbitration for live-externals (G36)"
```

---

## Self-Review

**1. Spec coverage:** Design deliverable 1 (kit: HTTP/LLM/DB doubles + AT template + conftest) → Tasks 1-4, 10. Deliverable 2 (G36 lint half) → Tasks 5-7; (G36 runtime half: missing-fixture = live-reach) → Task 8. Deliverable 3 (replay-mode regression) → Tasks 8-9. Binding flag `HARNESS_TEST_REPLAY` → Tasks 4, 8, 9, 10. Registration (manifest, HARNESS.md, scaffold-copy, sensor-arbitration, npm script) → Tasks 6, 11-13. `/test` integration-generation step (folded G35) → Task 10. No spec section is unmapped.

**2. Placeholder scan:** No "TBD/TODO/handle edge cases" — every code step has real content. The two prose-heavy edits (Task 8 Step 4 regression-script `--replay` handling; Task 12 gap prose) reference exact behavior and message text rather than a code block because they edit large existing files/markdown; the reviewer has the exact strings to match.

**3. Type consistency:** `checkStaged(exec) -> {pass, findings}`, `findingLine(f)`, `run(argv, root, deps)` names are consistent across Tasks 5-7 and match the extracted `test-deletion-gate` contract. `ReplayTransport`/`FakeLLMClient`/`request_key`/`MissingFixtureError`/`GoldenNotFoundError` names are consistent across Tasks 1-4, 8. `detectLiveExternalReach` consistent across Task 8. Gate id `live-externals` and env `HARNESS_LIVE_EXTERNALS_GATE` are identical in the gate wrapper (Task 7), manifest (Task 11), and arbitration doc (Task 13).

**Note on runtime jail:** v1 deliberately implements the runtime half as "force the replay flag + treat a missing fixture as a live-external reach," which is portable and needs no OS-level network namespace. An OS-level outbound-network block is a documented later hardening (design "Risks" section), not part of this plan.
