#!/usr/bin/env node

'use strict';

// Merge two independent code-reviewer verdicts into the canonical
// specs/reviews/code-review-verdict.json (Bun Phase A dual adversarial review).
// Policies: union (any BLOCK → fail) | majority (both must fail / share BLOCK).

const fs = require('fs');
const path = require('path');

const DEFAULT_POLICY = 'union';

function loadVerdict(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    return {
      gate: 'code-review',
      pass: false,
      error: err && err.message ? err.message : String(err),
      summary: { block: 1, warn: 0, info: 0 },
      findings: [
        {
          id: 'CR-INSTANCE-ERROR',
          level: 'BLOCK',
          confidence: 'high',
          axis: 'behaviour',
          file: filePath,
          line: 0,
          description: `Reviewer instance failed to produce a readable verdict: ${err.message || err}`,
          fix: 'Re-run the code-reviewer instance; missing/corrupt verdict is fail-safe BLOCK.',
        },
      ],
    };
  }
}

function findingKey(f) {
  return `${f.file || ''}:${f.line || 0}:${f.level || ''}:${(f.description || '').slice(0, 80)}`;
}

/**
 * @param {object} a verdict A
 * @param {object} b verdict B
 * @param {'union'|'majority'} policy
 */
function mergeVerdicts(a, b, policy = DEFAULT_POLICY) {
  const pol = policy === 'majority' ? 'majority' : 'union';
  const aFindings = Array.isArray(a.findings) ? a.findings : [];
  const bFindings = Array.isArray(b.findings) ? b.findings : [];
  const aBlocks = aFindings.filter((f) => f.level === 'BLOCK');
  const bBlocks = bFindings.filter((f) => f.level === 'BLOCK');

  let mergedFindings;
  if (pol === 'majority') {
    // BLOCK only if both instances produced pass:false, or the same finding key is BLOCK in both
    const bKeys = new Set(bBlocks.map(findingKey));
    const sharedBlocks = aBlocks.filter((f) => bKeys.has(findingKey(f)));
    const bothFailed = a.pass === false && b.pass === false;
    const blocks = sharedBlocks.length > 0
      ? sharedBlocks
      : bothFailed
        ? [...aBlocks, ...bBlocks.filter((f) => !aBlocks.some((x) => findingKey(x) === findingKey(f)))]
        : [];
    // Always surface WARNs/INFOs from both (deduped)
    const nonBlock = [...aFindings, ...bFindings].filter((f) => f.level !== 'BLOCK');
    mergedFindings = dedupeFindings([...blocks, ...nonBlock]);
    // If both failed but no shared keys and no blocks array filled from bothFailed branch with content
    if (bothFailed && blocks.length === 0 && (aBlocks.length || bBlocks.length)) {
      mergedFindings = dedupeFindings([...aBlocks, ...bBlocks, ...nonBlock]);
    }
  } else {
    // union: all findings; any BLOCK fails
    mergedFindings = dedupeFindings([...aFindings, ...bFindings]);
  }

  const summary = { block: 0, warn: 0, info: 0 };
  for (const f of mergedFindings) {
    const lv = (f.level || 'info').toLowerCase();
    if (lv === 'block') summary.block++;
    else if (lv === 'warn') summary.warn++;
    else summary.info++;
  }

  const mergedPass = summary.block === 0;
  return {
    gate: 'code-review',
    pass: mergedPass,
    range: a.range || b.range || '',
    policy: pol,
    summary,
    findings: mergedFindings,
  };
}

function dedupeFindings(findings) {
  const seen = new Set();
  const out = [];
  for (const f of findings) {
    const k = findingKey(f);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(f);
  }
  return out;
}

function buildAudit(a, b, merged, policy, paths) {
  return {
    schema_version: 1,
    mode: 'adversarial',
    policy,
    instances: [
      {
        id: 'a',
        verdict_path: paths.a,
        pass: a.pass !== false && !(a.summary && a.summary.block > 0),
        error: a.error || null,
      },
      {
        id: 'b',
        verdict_path: paths.b,
        pass: b.pass !== false && !(b.summary && b.summary.block > 0),
        error: b.error || null,
      },
    ],
    merged_pass: merged.pass,
    merged_summary: merged.summary,
    timeouts: [],
  };
}

function writeJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
}

function renderMergedMd(merged) {
  const lines = [
    '# Code Review (merged adversarial)',
    '',
    `Policy: **${merged.policy}** · pass: **${merged.pass}** · BLOCK ${merged.summary.block} / WARN ${merged.summary.warn} / INFO ${merged.summary.info}`,
    '',
  ];
  for (const f of merged.findings) {
    lines.push(`### ${f.id || 'finding'} — ${f.level}`);
    lines.push(`File: ${f.file}:${f.line}`);
    lines.push(`Axis: ${f.axis || 'n/a'} · confidence: ${f.confidence || 'n/a'}`);
    lines.push('');
    lines.push(f.description || '');
    if (f.fix) lines.push(`\n**Fix:** ${f.fix}`);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

/**
 * CLI:
 *   node merge-review-verdicts.js \
 *     --a specs/reviews/code-review-verdict-a.json \
 *     --b specs/reviews/code-review-verdict-b.json \
 *     [--policy union|majority] \
 *     [--out specs/reviews/code-review-verdict.json] \
 *     [--audit specs/reviews/adversarial-review-audit.json] \
 *     [--md specs/reviews/code-review.md]
 */
function run(argv, root = process.cwd()) {
  const args = parseArgs(argv);
  if (!args.a || !args.b) {
    process.stderr.write(
      'usage: merge-review-verdicts.js --a <verdict-a.json> --b <verdict-b.json> [--policy union|majority]\n'
    );
    return 2;
  }
  const pathA = path.resolve(root, args.a);
  const pathB = path.resolve(root, args.b);
  const policy = args.policy || DEFAULT_POLICY;
  const a = loadVerdict(pathA);
  const b = loadVerdict(pathB);
  const merged = mergeVerdicts(a, b, policy);
  const out = path.resolve(root, args.out || 'specs/reviews/code-review-verdict.json');
  const auditPath = path.resolve(root, args.audit || 'specs/reviews/adversarial-review-audit.json');
  const mdPath = path.resolve(root, args.md || 'specs/reviews/code-review.md');
  writeJson(out, merged);
  writeJson(auditPath, buildAudit(a, b, merged, policy, { a: args.a, b: args.b }));
  fs.mkdirSync(path.dirname(mdPath), { recursive: true });
  fs.writeFileSync(mdPath, renderMergedMd(merged), 'utf8');
  process.stdout.write(
    `merge-review-verdicts: policy=${policy} pass=${merged.pass} block=${merged.summary.block}\n`
  );
  return merged.pass ? 0 : 1;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--a') out.a = argv[++i];
    else if (a === '--b') out.b = argv[++i];
    else if (a === '--policy') out.policy = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--audit') out.audit = argv[++i];
    else if (a === '--md') out.md = argv[++i];
  }
  return out;
}

module.exports = {
  loadVerdict,
  mergeVerdicts,
  buildAudit,
  findingKey,
  run,
  DEFAULT_POLICY,
};

if (require.main === module) process.exit(run(process.argv.slice(2), process.cwd()));
