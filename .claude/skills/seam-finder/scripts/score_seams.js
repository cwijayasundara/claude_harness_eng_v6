#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const OBSERVABLE_PRIORS = [
  [/(?:^|\/)(routes?|controllers?|api|handlers?|views?|endpoints?|resolvers?|graphql|rest|rpc|grpc|cli|commands?)(?:\/|$)/, 'http', 1.0],
  [/(?:^|\/)(queues?|events?|consumers?|producers?|webhooks?|messaging|workers?|jobs?|tasks?|subscribers?|listeners?)(?:\/|$)/, 'message', 0.9],
  [/(?:^|\/)(db|database|repositor(?:y|ies)|models?|migrations?|schemas?|entities|persistence|store|storage|dao)(?:\/|$)/, 'data', 0.8],
  [/(?:^|\/)(services?|domain|usecases?|use_cases|business|core|application|workflows?|orchestrat\w*)(?:\/|$)/, 'service', 0.6],
  [/(?:^|\/)(adapters?|gateway|gateways|client|clients|integrations?|providers?)(?:\/|$)/, 'integration', 0.7],
  [/(?:^|\/)(utils?|helpers?|internal|_internal|priv|lib\/internal|common\/internal)(?:\/|$)/, 'internal', 0.1],
];
const DEFAULT_OBSERVABLE = ['module', 0.4];

const TEST_PATH_RE = /(?:^|\/)(tests?|__tests__|spec|specs|e2e|integration_tests?|conformance|smoke)(?:\/|$)|(?:^|\/)(?:test_[^/]+|[^/]+_test|[^/]+\.test|[^/]+\.spec)\.[A-Za-z]+$/;
const FIXTURE_PATH_RE = /(?:^|\/)(fixtures?|mocks?|stubs?|examples?|samples?|seed_data|test_data)(?:\/|$)/;

const W_OBSERVABLE = 0.4;
const W_FUNNEL = 0.4;
const W_ASYMMETRY = 0.2;
const GOAL_BUMP = 1.5;

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'to', 'of', 'for', 'on', 'in', 'with',
  'by', 'from', 'as', 'into', 'via', 'add', 'make', 'create', 'build',
  'introduce', 'let', 'lets', 'use', 'support', 'split', 'merge', 'refactor',
  'improve', 'this', 'that', 'these', 'those', 'be', 'is', 'are',
]);

function classifyObservable(p) {
  for (const [re, kind, score] of OBSERVABLE_PRIORS) {
    if (re.test(p)) return [kind, score];
  }
  return DEFAULT_OBSERVABLE;
}

function goalTerms(goal) {
  const tokens = (goal || '').toLowerCase().match(/[a-z_][a-z0-9_]+/g) || [];
  return tokens.filter((t) => !STOP_WORDS.has(t) && t.length >= 3);
}

function asymmetry(fanIn, fanOut) {
  if (fanIn === 0 && fanOut === 0) return 0;
  return Math.abs(fanIn - fanOut) / Math.max(fanIn, fanOut);
}

function recommendAction(observable, funnel, asym, fanIn, fanOut) {
  if (observable < 0.3 && funnel < 0.2 && fanIn + fanOut < 2) return 'avoid';
  if (asym >= 0.8 && (fanIn === 0 || fanOut === 0)) return 'split';
  if (observable >= 0.7 && funnel >= 0.4) return 'extend';
  if (observable >= 0.7) return 'wrap';
  if (funnel >= 0.4) return 'introduce-adapter';
  return 'wrap';
}

function scoreSeams(graph, goal, opts = {}) {
  const includeTests = Boolean(opts.includeTests);
  const includeFixtures = Boolean(opts.includeFixtures);
  const filtered = graph.nodes.filter((n) => {
    if (!includeTests && TEST_PATH_RE.test(n.path)) return false;
    if (!includeFixtures && FIXTURE_PATH_RE.test(n.path)) return false;
    return true;
  });
  const nodesById = new Map(filtered.map((n) => [n.id, n]));
  const fanIn = new Map();
  const fanOut = new Map();
  const inbound = new Map();

  for (const e of graph.edges) {
    if (e.target.startsWith('ext:') || e.target.startsWith('sym:')) continue;
    if (!nodesById.has(e.target) || !nodesById.has(e.source)) continue;
    fanIn.set(e.target, (fanIn.get(e.target) || 0) + 1);
    fanOut.set(e.source, (fanOut.get(e.source) || 0) + 1);
    if (!inbound.has(e.target)) inbound.set(e.target, []);
    inbound.get(e.target).push(e.evidence);
  }

  let maxFunnel = 1;
  for (const id of nodesById.keys()) {
    const total = (fanIn.get(id) || 0) + (fanOut.get(id) || 0);
    if (total > maxFunnel) maxFunnel = total;
  }

  const cycleMembers = new Set();
  for (const cycle of (graph.metrics && graph.metrics.cycles) || []) {
    for (const id of cycle) cycleMembers.add(id);
  }

  const terms = goalTerms(goal);
  const out = [];

  for (const [id, node] of nodesById) {
    const fi = fanIn.get(id) || 0;
    const fo = fanOut.get(id) || 0;
    const [kind, observable] = classifyObservable(node.path);
    const funnel = (fi + fo) / maxFunnel;
    const asym = asymmetry(fi, fo);

    let base =
      W_OBSERVABLE * observable +
      W_FUNNEL * funnel +
      W_ASYMMETRY * asym;

    const haystack = `${node.path} ${(node.symbols || []).join(' ')}`.toLowerCase();
    const matched = terms.filter((t) => haystack.includes(t));
    const relevance = matched.length ? Math.min(1, 0.2 * matched.length) : 0;
    if (matched.length) base *= GOAL_BUMP;

    out.push({
      id,
      path: node.path,
      kind,
      fan_in: fi,
      fan_out: fo,
      observable_score: round3(observable),
      funnel_score: round3(funnel),
      asymmetry_score: round3(asym),
      goal_relevance: round3(relevance),
      matched_terms: matched,
      in_cycle: cycleMembers.has(id),
      total_score: round3(base),
      evidence: (inbound.get(id) || []).slice(0, 5),
      recommended_action: recommendAction(observable, funnel, asym, fi, fo),
    });
  }

  out.sort((a, b) => b.total_score - a.total_score);
  return out;
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

function render(candidates, goal, top) {
  const lines = [`# Seam Candidates — \`${goal}\``, ''];
  if (!candidates.length) {
    lines.push('_No candidates found. The graph may be empty; run `/code-map` first._');
    return lines.join('\n') + '\n';
  }

  lines.push(
    'Ranked by combined score (observable + funnel + asymmetry, with a goal-relevance ' +
    'bump when the candidate\'s path or symbols match goal keywords).'
  );
  lines.push('');
  lines.push('| # | Path | Kind | Fan-in | Fan-out | Score | Action |');
  lines.push('|---:|---|---|---:|---:|---:|---|');
  candidates.slice(0, top).forEach((c, i) => {
    const flag = c.in_cycle ? ' ⚠ in cycle' : '';
    lines.push(
      `| ${i + 1} | \`${c.path}\` | ${c.kind} | ${c.fan_in} | ${c.fan_out} | ` +
      `${c.total_score} | \`${c.recommended_action}\`${flag} |`
    );
  });
  lines.push('');

  lines.push('## Top candidates — detail');
  lines.push('');
  for (const c of candidates.slice(0, Math.min(5, top))) {
    lines.push(`### \`${c.path}\``);
    lines.push('');
    lines.push(`- **Action:** \`${c.recommended_action}\``);
    lines.push(`- **Kind:** ${c.kind}  `);
    lines.push(
      `- **Scores:** observable=${c.observable_score}, ` +
      `funnel=${c.funnel_score}, asymmetry=${c.asymmetry_score}, total=${c.total_score}`
    );
    if (c.matched_terms.length) {
      lines.push(`- **Goal terms matched:** ${c.matched_terms.map((t) => `\`${t}\``).join(', ')}`);
    }
    if (c.in_cycle) {
      lines.push('- ⚠ **In cycle** — fan-in / fan-out are unreliable here');
    }
    if (c.evidence.length) {
      lines.push('- **Inbound evidence (sample):**');
      for (const ev of c.evidence) lines.push(`  - \`${ev}\``);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push(
    '_Re-read the top candidates\' source files before acting. ' +
    'Scores are structural; goal-fit is semantic._'
  );
  return lines.join('\n') + '\n';
}

function parseArgs(argv) {
  const args = {
    graph: null, goal: '', out: null, top: 15,
    includeTests: false, includeFixtures: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--graph') args.graph = argv[++i];
    else if (a === '--goal') args.goal = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--top') args.top = Number(argv[++i]);
    else if (a === '--include-tests') args.includeTests = true;
    else if (a === '--include-fixtures') args.includeFixtures = true;
  }
  if (!args.graph || !args.out) {
    process.stderr.write(
      'Usage: score_seams.js --graph <path> --goal "<text>" --out <path>\n' +
      '       [--top N] [--include-tests] [--include-fixtures]\n'
    );
    process.exit(2);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const graph = JSON.parse(fs.readFileSync(args.graph, 'utf8'));
  const candidates = scoreSeams(graph, args.goal, {
    includeTests: args.includeTests,
    includeFixtures: args.includeFixtures,
  });
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, render(candidates, args.goal, args.top));
  const filteredOut = graph.nodes.length - candidates.length;
  process.stdout.write(
    `Wrote ${args.out} (${candidates.length} candidates ranked, top ${args.top} shown` +
    (filteredOut > 0 ? `, ${filteredOut} test/fixture files filtered` : '') +
    `)\n`
  );
}

main();
