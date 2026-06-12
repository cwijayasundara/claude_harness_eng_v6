#!/usr/bin/env node

'use strict';

// CI-config ingestion — a brownfield project's REAL quality gates live in its
// CI config, and harness gates that diverge from them (different lint rules,
// different coverage threshold) silently disagree with the project's own bar.
// Extracts test/lint/typecheck/coverage/build commands from GitHub workflows,
// GitLab CI, CircleCI, and Jenkinsfiles into specs/brownfield/ci-map.md.
// Line-based extraction — no YAML dependency, by design (the harness ships
// zero node_modules); a command missed here is a gap, not a crash.
// CLI: node .claude/scripts/ci-ingest.js [--root DIR] [--out FILE]

const fs = require('fs');
const path = require('path');

const CATEGORY_RES = [
  ['coverage', /--cov|--coverage|\bcoverage\b|nyc |c8 |jacoco|-Pcoverage/],
  ['typecheck', /\btsc\b|mypy|pyright/],
  ['lint', /eslint|ruff|flake8|pylint|golangci|checkstyle|rubocop|biome/],
  ['test', /\btest\b|pytest|jest|vitest|go test|mvn (test|verify)|gradle test|dotnet test|rspec/],
  ['build', /\bbuild\b|mvn package|tsc -p|docker build/],
];

function classify(cmd) {
  for (const [category, re] of CATEGORY_RES) {
    if (re.test(cmd)) return category;
  }
  return null;
}

function indentOf(line) {
  return line.length - line.trimStart().length;
}

// `run: cmd` scalars and `run: |` block scalars from GitHub workflows.
function extractGithub(content) {
  const out = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)(?:-\s+)?run:\s*(.*)$/);
    if (!m) continue;
    const value = m[2].trim();
    if (value && value !== '|' && value !== '>') {
      out.push(value);
      continue;
    }
    const base = indentOf(lines[i]);
    for (let j = i + 1; j < lines.length; j++) {
      if (!lines[j].trim()) continue;
      if (indentOf(lines[j]) <= base) break;
      out.push(lines[j].trim());
    }
  }
  return out;
}

// `- cmd` list items under script:/steps: from GitLab and CircleCI configs.
function extractYamlLists(content) {
  return content.split('\n')
    .map((l) => l.match(/^\s*-\s+(.+)$/))
    .filter(Boolean)
    .map((m) => m[1].trim())
    .filter((cmd) => !cmd.startsWith('uses:') && classify(cmd) !== null);
}

// sh 'cmd' / sh "cmd" steps from Jenkinsfiles.
function extractJenkins(content) {
  const out = [];
  for (const m of content.matchAll(/\bsh\s+(['"])(.+?)\1/g)) {
    out.push(m[2]);
  }
  return out;
}

function extractCommands(kind, content) {
  const raw = kind === 'github' ? extractGithub(content)
    : kind === 'jenkins' ? extractJenkins(content)
    : extractYamlLists(content);
  return raw
    .map((cmd) => ({ cmd, category: classify(cmd) }))
    .filter((c) => c.category !== null);
}

function ciSources(root) {
  const sources = [];
  const wfDir = path.join(root, '.github', 'workflows');
  if (fs.existsSync(wfDir)) {
    for (const name of fs.readdirSync(wfDir).filter((n) => /\.ya?ml$/.test(n))) {
      sources.push({ rel: `.github/workflows/${name}`, kind: 'github' });
    }
  }
  for (const [rel, kind] of [
    ['.gitlab-ci.yml', 'gitlab'],
    ['.circleci/config.yml', 'circleci'],
    ['Jenkinsfile', 'jenkins'],
  ]) {
    if (fs.existsSync(path.join(root, rel))) sources.push({ rel, kind });
  }
  return sources;
}

function alignmentNotes(all) {
  const categories = new Set(all.map((c) => c.category));
  const notes = ['## Harness alignment', ''];
  notes.push(categories.has('coverage')
    ? '- CI runs coverage — verify its threshold matches the harness ratchet (80% floor, `.claude/state/coverage-baseline*.txt`); the stricter one should win.'
    : '- CI enforces **no coverage** — the harness ratchet (80% floor) is stricter than this project\'s own bar. Confirm that is intended before /auto runs.');
  notes.push(categories.has('lint')
    ? '- CI runs a linter — verify verify-on-save uses the same tool/config (`project-manifest.json#linter`), or commits that pass locally will fail CI.'
    : '- CI runs no linter — the harness lint-on-save is the only lint gate.');
  if (!categories.has('test')) {
    notes.push('- CI runs **no tests** — every regression guarantee comes from harness gates alone.');
  }
  return notes.join('\n');
}

function renderMap(root, perSource) {
  const lines = ['# CI Map', '', `Extracted from CI configs at ${new Date().toISOString()}. Line-based extraction — verify anything surprising against the source file.`, ''];
  const all = [];
  for (const { rel, commands } of perSource) {
    lines.push(`## ${rel}`, '', '| category | command |', '|---|---|');
    for (const c of commands) {
      lines.push(`| ${c.category} | \`${c.cmd.replace(/\|/g, '\\|')}\` |`);
      all.push(c);
    }
    lines.push('');
  }
  lines.push(alignmentNotes(all), '');
  return lines.join('\n');
}

function main(argv) {
  const rootIdx = argv.indexOf('--root');
  const root = path.resolve(rootIdx === -1 ? '.' : argv[rootIdx + 1]);
  const outIdx = argv.indexOf('--out');
  const out = outIdx === -1 ? path.join(root, 'specs', 'brownfield', 'ci-map.md') : argv[outIdx + 1];

  const sources = ciSources(root);
  if (sources.length === 0) {
    process.stdout.write('No CI config found (.github/workflows, .gitlab-ci.yml, .circleci, Jenkinsfile).\n');
    return 0;
  }
  const perSource = sources.map(({ rel, kind }) => ({
    rel,
    commands: extractCommands(kind, fs.readFileSync(path.join(root, rel), 'utf8')),
  }));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, renderMap(root, perSource));
  process.stdout.write(`Wrote ${out} (${perSource.length} source file(s))\n`);
  return 0;
}

module.exports = { extractCommands, classify };

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
