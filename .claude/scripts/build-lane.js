'use strict';

// Deterministic /build lane normalization. The skill prose still explains how
// to execute each lane; this helper makes flag meaning testable and order-free.

const FLAG_VALUE = new Set(['--mode', '--pod', '--parallel-groups', '--budget']);

function tokenize(input) {
  const text = String(input || '').trim();
  if (!text) return [];
  return text.match(/"[^"]*"|'[^']*'|\S+/g).map((t) => t.replace(/^['"]|['"]$/g, ''));
}

function selectLane(flags, args, values) {
  const auto = flags.has('--auto');
  const autonomous = auto || flags.has('--autonomous');
  const lite = flags.has('--lite');
  const finalize = flags.has('--finalize');
  const planOnly = flags.has('--plan-only');
  const prdPath = args[0] || null;
  const mode = values['--mode'] || 'full';
  const pod = values['--pod'] ? parseInt(values['--pod'], 10) : null;
  if (finalize) return laneResult({ lane: 'finalize', auto: true, autonomous: true, lite, planOnly, prdPath: null, mode, pod, humanGates: 0, requiresPrd: false });
  if ((auto || autonomous || planOnly) && !prdPath) return { valid: false, error: 'A PRD path is required for --auto, --autonomous, and --plan-only build runs.' };
  if (lite && auto) return laneResult({ lane: 'lite-auto', auto, autonomous: true, lite, planOnly, prdPath, mode, pod, humanGates: 0, requiresPrd: true });
  if (lite && autonomous) return laneResult({ lane: 'lite-autonomous', auto, autonomous, lite, planOnly, prdPath, mode, pod, humanGates: 1, requiresPrd: true });
  if (lite) return laneResult({ lane: 'lite', auto, autonomous, lite, planOnly, prdPath, mode, pod, humanGates: 1, requiresPrd: false });
  if (auto) return laneResult({ lane: 'auto', auto, autonomous: true, lite, planOnly, prdPath, mode, pod, humanGates: 0, requiresPrd: true });
  if (autonomous) return laneResult({ lane: 'autonomous', auto, autonomous, lite, planOnly, prdPath, mode, pod, humanGates: 1, requiresPrd: true });
  return laneResult({ lane: 'gated', auto, autonomous, lite, planOnly, prdPath, mode, pod, humanGates: 3, requiresPrd: false });
}

function resolveLane(input) {
  const tokens = tokenize(input).filter((t) => t !== '/build');
  const flags = new Set();
  const values = {};
  const args = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (FLAG_VALUE.has(token)) {
      flags.add(token);
      values[token] = tokens[++i];
    } else if (token.startsWith('--')) {
      flags.add(token);
    } else {
      args.push(token);
    }
  }
  return selectLane(flags, args, values);
}

function parseBuildInvocation(input) {
  const result = resolveLane(input);
  if (result && result.valid !== false) {
    result.singlePr = tokenize(input).includes('--single-pr');
    result.autoMerge = tokenize(input).includes('--auto-merge');
  }
  return result;
}

function laneResult(result) {
  return { valid: true, ...result };
}

module.exports = { parseBuildInvocation };

if (require.main === module) {
  const result = parseBuildInvocation(process.argv.slice(2).join(' '));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.valid === false ? 2 : 0);
}
