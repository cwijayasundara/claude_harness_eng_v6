'use strict';

// Pure content classification for the live-externals sensor (gap G36).
// No git, no repo fs here — git plumbing lives in scripts/live-externals-gate.js
// (same split test-deletion-gate.js / legacy-discipline-gate.js use).

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '0.0.0.0', 'host.docker.internal', '::1'];
// tests/integration + e2e (any language), plus co-located TS tests by name
// (*.test.ts(x) / *.spec.ts(x) / __tests__/) — the harness tells TS authors to
// co-locate vitest tests next to the component, so those would otherwise be
// invisible. Deliberately NOT .js/.jsx: that would scan the harness's own
// test/*.test.js fixtures (which contain SDK-shaped strings as test data).
const IN_SCOPE = /(^|\/)(tests\/integration\/|e2e\/|__tests__\/)|\.(test|spec)\.tsx?$/;
// Prose living in a test directory. The directory branch above matches on path
// alone, so a PRD fixture under e2e/ was scanned as if it were a call site — and
// a PRD that specifies an SSRF deny-list names the very hosts the product must
// REFUSE to reach, so describing the safeguard tripped the sensor. Excluded by
// extension rather than by path, and kept deliberately short: a URL in .json or
// .yaml can genuinely point a test at a live host, but nothing dials a .md.
const PROSE = /\.(md|markdown|rst|txt)$/i;
// A captured project tree, not a test the harness wrote. make-sprint1-baseline.js
// writes here and the /sprint route SEEDS from it: the tree is the INPUT under
// test, so its DSNs and package-index URLs belong to the generated product and
// are judged by that project's own gates when the route runs it. Keyed to the
// capture tool's output directory, not to `fixtures/` at large — a fixture that
// aims a runner at a live host is exactly what this sensor is for.
const CAPTURED = /(^|\/)fixtures\/baselines\//;
// A line carrying this marker is an explicit, greppable, reviewer-visible
// exception (e.g. a test that deliberately hits a real staging endpoint, or one
// asserting on a URL string). Suppresses findings on THAT line only — the same
// trust model as harness:secret-ok.
const LIVE_OK_MARKER = /harness:live-ok/;

function isLocalHost(host) {
  const h = String(host).toLowerCase();
  return LOCAL_HOSTS.some((l) => h === l || h.startsWith(l + ':') || h.startsWith(l + '/'));
}

const URL_RE = /https?:\/\/([a-z0-9._-]+(?::\d+)?)/gi;
const DSN_RE = /\b(?:postgres|postgresql|mysql|mongodb|redis)(?:\+\w+)?:\/\/(?:[^@\s"']*@)?([a-z0-9._-]+(?::\d+)?)/gi;
const SDK_RE = /\b(?:AnthropicVertex|AnthropicBedrock|Anthropic|AzureOpenAI|OpenAI|GoogleGenerativeAI|CohereClient|Mistral|anthropic\.Client|anthropic\.Anthropic|openai\.OpenAI)\s*\(/;

function nonLocal(matchHost) {
  const host = String(matchHost).split(/[:/]/)[0];
  return !isLocalHost(matchHost) && !isLocalHost(host);
}

function classifyFile(file, content) {
  const findings = [];
  String(content).split('\n').forEach((text, i) => {
    const line = i + 1;
    if (LIVE_OK_MARKER.test(text)) return; // explicit per-line exception
    for (const m of text.matchAll(DSN_RE)) {
      if (nonLocal(m[1])) findings.push({ file, line, kind: 'live-dsn', snippet: m[0] });
    }
    for (const m of text.matchAll(URL_RE)) {
      if (nonLocal(m[1])) findings.push({ file, line, kind: 'live-url', snippet: m[0] });
    }
    if (SDK_RE.test(text)) findings.push({ file, line, kind: 'sdk-client', snippet: text.trim().slice(0, 80) });
  });
  return findings;
}

function classifyFiles(changes) {
  return changes
    .filter((c) => IN_SCOPE.test(c.file) && !PROSE.test(c.file) && !CAPTURED.test(c.file))
    .flatMap((c) => classifyFile(c.file, c.content));
}

module.exports = { classifyFile, classifyFiles, isLocalHost };
