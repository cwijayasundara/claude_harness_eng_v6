#!/usr/bin/env node

'use strict';

// Devin Review–class logical walkthrough for humans (and PR bodies).
// Groups changed files by layer/role, orders entry → domain → adapters → tests,
// attaches code-review severity, and cites blast radius from the code graph.
//
//   node pr-walkthrough.js [--root <dir>] [--base <ref>] [--files a,b]
//
// Writes specs/reviews/walkthrough.md + walkthrough.json

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SOURCE_EXTS = new Set([
  '.py', '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.go', '.java', '.cs',
]);

const LAYER_ORDER = [
  'entry',
  'domain',
  'service',
  'data',
  'adapter',
  'config',
  'test',
  'docs',
  'other',
];

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function classifyFile(rel) {
  const p = rel.replace(/\\/g, '/');
  const base = path.basename(p).toLowerCase();
  const ext = path.extname(p).toLowerCase();

  if (
    p.startsWith('test/') || p.startsWith('tests/') || p.startsWith('e2e/')
    || base.includes('.test.') || base.includes('.spec.') || base.endsWith('_test.py')
  ) return 'test';
  if (p.startsWith('docs/') || p.startsWith('specs/') || base.endsWith('.md')) return 'docs';
  if (
    /(?:^|\/)(routes?|controllers?|handlers?|api|middleware|endpoints?)(?:\/|$)/i.test(p)
    || /main\.(py|ts|js)$/.test(base)
    || /app\.(py|ts|js)$/.test(base)
  ) return 'entry';
  if (/(?:^|\/)(models?|entities|domain|schemas?)(?:\/|$)/i.test(p)) return 'domain';
  if (/(?:^|\/)(services?|use_?cases?|application)(?:\/|$)/i.test(p)) return 'service';
  if (/(?:^|\/)(repositories?|dao|db|database|migrations?)(?:\/|$)/i.test(p)) return 'data';
  if (/(?:^|\/)(clients?|adapters?|integrations?|external)(?:\/|$)/i.test(p)) return 'adapter';
  if (
    /config|settings|\.env|docker|compose|package\.json|pyproject|tsconfig/i.test(p)
  ) return 'config';
  if (SOURCE_EXTS.has(ext)) return 'other';
  return 'other';
}

function layerLabel(layer) {
  return {
    entry: '1. Entry points (routes / handlers / CLI)',
    domain: '2. Domain models & schemas',
    service: '3. Services & use cases',
    data: '4. Data / repositories',
    adapter: '5. External adapters',
    config: '6. Config & infrastructure',
    test: '7. Tests',
    docs: '8. Docs & specs',
    other: '9. Other',
  }[layer] || layer;
}

function defaultChangedFiles(root, base, exec) {
  const run = (args) => {
    try {
      const out = exec('git', args, { cwd: root });
      return String(out).split('\n').filter(Boolean);
    } catch (_) {
      return [];
    }
  };
  if (base) {
    const files = run(['diff', '--name-only', `${base}...HEAD`]);
    if (files.length) return files;
  }
  const staged = run(['diff', '--cached', '--name-only', '--diff-filter=ACMR']);
  if (staged.length) return staged;
  return run(['diff', '--name-only', '--diff-filter=ACMR']);
}

function loadReviewFindings(root) {
  const v = readJson(path.join(root, 'specs', 'reviews', 'code-review-verdict.json'));
  if (!v || !Array.isArray(v.findings)) return { summary: null, byFile: new Map(), findings: [] };
  const byFile = new Map();
  for (const f of v.findings) {
    const file = (f.file || '').replace(/\\/g, '/');
    if (!file) continue;
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push(f);
  }
  return { summary: v.summary || null, byFile, findings: v.findings, pass: v.pass };
}

function graphNeighbors(root, files) {
  const graph = readJson(path.join(root, 'specs', 'brownfield', 'code-graph.json'));
  if (!graph) return { callers: [], callees: [] };
  const fileSet = new Set(files.map((f) => f.replace(/\\/g, '/')));
  const callers = new Set();
  const callees = new Set();
  for (const e of graph.edges || []) {
    const from = String(e.source || e.from || '');
    const to = String(e.target || e.to || '');
    const fromPath = from.includes(':') ? from.split(':').slice(1).join(':') : from;
    const toPath = to.includes(':') ? to.split(':').slice(1).join(':') : to;
    if (fileSet.has(toPath) && fromPath && !fileSet.has(fromPath)) callers.add(fromPath);
    if (fileSet.has(fromPath) && toPath && !fileSet.has(toPath)) callees.add(toPath);
  }
  return {
    callers: [...callers].slice(0, 20),
    callees: [...callees].slice(0, 20),
  };
}

function storyHints(root) {
  const pack = (() => {
    try {
      return fs.readFileSync(path.join(root, 'specs', 'reviews', 'review-context-pack.md'), 'utf8');
    } catch (_) {
      return null;
    }
  })();
  if (!pack) return { intent: null, stories: [] };
  const stories = [];
  const storyRe = /\b(E\d+-S\d+)\b/g;
  let m;
  while ((m = storyRe.exec(pack)) !== null) {
    if (!stories.includes(m[1])) stories.push(m[1]);
  }
  const firstLines = pack.split('\n').slice(0, 12).join(' ').replace(/\s+/g, ' ').trim();
  return { intent: firstLines.slice(0, 400) || null, stories };
}

function groupFiles(files) {
  const groups = new Map();
  for (const layer of LAYER_ORDER) groups.set(layer, []);
  for (const f of files) {
    const layer = classifyFile(f);
    groups.get(layer).push(f);
  }
  for (const list of groups.values()) list.sort();
  return groups;
}

function buildWalkthrough({
  root = process.cwd(),
  files = null,
  base = null,
  exec = (cmd, args, opts) => execFileSync(cmd, args, { encoding: 'utf8', ...opts }),
} = {}) {
  const changed = (files && files.length)
    ? files
    : defaultChangedFiles(root, base, (c, a) => exec(c, a, { cwd: root }));
  const groups = groupFiles(changed);
  const review = loadReviewFindings(root);
  const blast = graphNeighbors(root, changed);
  const stories = storyHints(root);
  const generatedAt = new Date().toISOString();

  const ordered = [];
  for (const layer of LAYER_ORDER) {
    const list = groups.get(layer) || [];
    if (!list.length) continue;
    ordered.push({
      layer,
      title: layerLabel(layer),
      files: list.map((f) => ({
        path: f,
        findings: (review.byFile.get(f) || []).map((x) => ({
          id: x.id,
          level: x.level,
          confidence: x.confidence,
          axis: x.axis,
          summary: x.what || x.message || x.summary || '',
        })),
      })),
    });
  }

  const data = {
    gate: 'pr-walkthrough',
    generated_at: generatedAt,
    base: base || null,
    file_count: changed.length,
    groups: ordered,
    review_summary: review.summary,
    review_pass: review.pass,
    blast_radius: blast,
    stories: stories.stories,
    intent: stories.intent,
    high_signal: (review.findings || [])
      .filter((f) => f.level === 'BLOCK' || f.level === 'WARN')
      .slice(0, 30)
      .map((f) => ({
        id: f.id,
        level: f.level,
        confidence: f.confidence,
        file: f.file,
        summary: f.what || f.message || f.summary || '',
      })),
  };

  return { data, md: renderMd(data) };
}

function severityIcon(level) {
  if (level === 'BLOCK') return '🔴';
  if (level === 'WARN') return '🟠';
  return '⚪';
}

function renderMd(data) {
  const lines = [
    '# PR walkthrough',
    '',
    `Generated: ${data.generated_at}`,
    `Files changed: **${data.file_count}**`,
    '',
    '## Intent',
    '',
    data.intent || '_No review-context-pack intent found. Link the story IDs and AC in the PR body._',
    '',
  ];
  if (data.stories.length) {
    lines.push(`Stories: ${data.stories.map((s) => `\`${s}\``).join(', ')}`, '');
  }

  lines.push('## Logical change groups', '');
  lines.push(
    '_Ordered for review top-to-bottom (entry → domain → services → data → adapters → tests). '
    + 'Not alphabetical._',
    '',
  );

  if (!data.groups.length) {
    lines.push('_No changed files detected._', '');
  }

  for (const g of data.groups) {
    lines.push(`### ${g.title}`, '');
    for (const f of g.files) {
      lines.push(`- \`${f.path}\``);
      for (const find of f.findings.slice(0, 5)) {
        lines.push(
          `  - ${severityIcon(find.level)} **${find.level}**`
          + (find.confidence ? ` (${find.confidence})` : '')
          + `: ${find.summary || find.id}`,
        );
      }
    }
    lines.push('');
  }

  lines.push('## High-signal findings', '');
  if (!data.high_signal.length) {
    lines.push('_No BLOCK/WARN findings in code-review-verdict.json (or review not run yet)._', '');
  } else {
    for (const f of data.high_signal) {
      lines.push(
        `- ${severityIcon(f.level)} **${f.level}** \`${f.file || '?'}\`: ${f.summary || f.id}`,
      );
    }
    lines.push('');
  }

  lines.push('## Blast radius (from code-graph)', '');
  if (data.blast_radius.callers.length) {
    lines.push('**Likely callers of changed code:**');
    for (const c of data.blast_radius.callers) lines.push(`- \`${c}\``);
    lines.push('');
  }
  if (data.blast_radius.callees.length) {
    lines.push('**Modules this change depends on:**');
    for (const c of data.blast_radius.callees) lines.push(`- \`${c}\``);
    lines.push('');
  }
  if (!data.blast_radius.callers.length && !data.blast_radius.callees.length) {
    lines.push('_No graph neighbors (missing graph or isolated files)._', '');
  }

  lines.push(
    '## 5-minute human review script',
    '',
    '1. Read **Intent** and confirm the PR matches the story/AC.',
    '2. Walk **Logical change groups** top to bottom — skip alphabetical GitHub view.',
    '3. Open every 🔴 BLOCK and 🟠 WARN; dismiss only with evidence.',
    '4. Spot-check one happy path and one failure path in tests (group 7).',
    '5. Confirm `specs/reviews/quality-card.md` is PASS and wiki links are fresh.',
    '6. Merge only if you understand the change groups — not because CI is green alone.',
    '',
  );
  return lines.join('\n');
}

function writeWalkthrough(root, { data, md }) {
  const dir = path.join(root, 'specs', 'reviews');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'walkthrough.json'), `${JSON.stringify(data, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'walkthrough.md'), md);
}

function arg(argv, name, fb) {
  const i = argv.indexOf(name);
  return i === -1 ? fb : argv[i + 1];
}

function main(argv = process.argv.slice(2)) {
  const root = arg(argv, '--root', process.cwd());
  const base = arg(argv, '--base', null);
  const filesArg = arg(argv, '--files', null);
  const files = filesArg
    ? filesArg.split(',').map((s) => s.trim()).filter(Boolean)
    : null;
  const built = buildWalkthrough({ root, base, files });
  writeWalkthrough(root, built);
  process.stdout.write(
    `pr-walkthrough: ${built.data.file_count} file(s), ${built.data.groups.length} group(s) → specs/reviews/walkthrough.md\n`,
  );
  return 0;
}

if (require.main === module) {
  try {
    process.exit(main());
  } catch (e) {
    process.stderr.write(`pr-walkthrough: ${e.message}\n`);
    process.exit(2);
  }
}

module.exports = {
  buildWalkthrough,
  writeWalkthrough,
  classifyFile,
  groupFiles,
  renderMd,
  main,
  LAYER_ORDER,
};
