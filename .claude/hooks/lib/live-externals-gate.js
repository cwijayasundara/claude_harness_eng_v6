'use strict';

// Pure content classification for the live-externals sensor (gap G36).
// No git, no repo fs here — git plumbing lives in scripts/live-externals-gate.js
// (same split test-deletion-gate.js / legacy-discipline-gate.js use).

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '0.0.0.0', 'host.docker.internal', '::1'];
const IN_SCOPE = /(^|\/)(tests\/integration\/|e2e\/)/;

function isLocalHost(host) {
  const h = String(host).toLowerCase();
  return LOCAL_HOSTS.some((l) => h === l || h.startsWith(l + ':') || h.startsWith(l + '/'));
}

const URL_RE = /https?:\/\/([a-z0-9._-]+(?::\d+)?)/gi;
const DSN_RE = /\b(?:postgres|postgresql|mysql|mongodb|redis)(?:\+\w+)?:\/\/(?:[^@\s"']*@)?([a-z0-9._-]+(?::\d+)?)/gi;
const SDK_RE = /\b(?:Anthropic|AzureOpenAI|OpenAI|anthropic\.Client|anthropic\.Anthropic|openai\.OpenAI)\s*\(/;

function nonLocal(matchHost) {
  const host = String(matchHost).split(/[:/]/)[0];
  return !isLocalHost(matchHost) && !isLocalHost(host);
}

function classifyFile(file, content) {
  const findings = [];
  String(content).split('\n').forEach((text, i) => {
    const line = i + 1;
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
    .filter((c) => IN_SCOPE.test(c.file))
    .flatMap((c) => classifyFile(c.file, c.content));
}

module.exports = { classifyFile, classifyFiles, isLocalHost };
