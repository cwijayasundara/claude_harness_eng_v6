'use strict';

// Deterministic /feature lane normalization. Mirrors build-lane.js: the skill
// prose still explains how to execute each lane; this makes flag meaning
// testable and order-free. /feature has no value-consuming flags, so every
// `--x` token is a boolean flag and everything else is the request text.

function tokenize(input) {
  const text = String(input || '').trim();
  if (!text) return [];
  return text.match(/"[^"]*"|'[^']*'|\S+/g).map((t) => t.replace(/^['"]|['"]$/g, ''));
}

function parseFeatureInvocation(input) {
  const tokens = tokenize(input).filter((t) => t !== '/feature');
  const flags = new Set();
  const request = [];
  for (const token of tokens) {
    if (token.startsWith('--')) flags.add(token);
    else request.push(token);
  }
  const requestText = request.join(' ').trim();
  if (!requestText) return { valid: false, error: 'A feature request is required.' };

  const auto = flags.has('--auto');
  const autonomous = auto || flags.has('--autonomous');
  if (auto) return laneResult({ lane: 'auto', auto: true, autonomous: true, humanGates: 0, request: requestText });
  if (autonomous) return laneResult({ lane: 'autonomous', auto: false, autonomous: true, humanGates: 1, request: requestText });
  return laneResult({ lane: 'gated', auto: false, autonomous: false, humanGates: 3, request: requestText });
}

function laneResult(result) {
  return { valid: true, ...result };
}

module.exports = { parseFeatureInvocation };

if (require.main === module) {
  const result = parseFeatureInvocation(process.argv.slice(2).join(' '));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.valid === false ? 2 : 0);
}
