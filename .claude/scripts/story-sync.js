#!/usr/bin/env node

'use strict';

// CLI: node .claude/scripts/story-sync.js [--write] [--root DIR] [--files a,b]
// Syncs refactor-only file ownership back into specs/bundles/{id}.json.
// Exit 0 = pass/skip, 1 = behavior drift or remaining issues, 2 = IO.

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { planProjectSync, applyStorySync } = require('../hooks/lib/story-sync');
const { parseStoryOwnership } = require('../hooks/lib/story-bundle');

function arg(argv, name, fallback) {
  const i = argv.indexOf(name);
  return i === -1 || argv[i + 1] === undefined ? fallback : String(argv[i + 1]);
}

function walkStoryFiles(root) {
  const found = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (/^E\d+-S\d+\.md$/.test(name)) found.push(path.relative(root, full).replace(/\\/g, '/'));
    }
  }
  walk(path.join(root, 'specs', 'stories'));
  return found;
}

function changedFiles(root, filesArg) {
  if (filesArg) return filesArg.split(',').map((s) => s.trim()).filter(Boolean);
  try {
    return cp.execFileSync('git', ['-C', root, 'diff', '--name-only', 'HEAD'], { encoding: 'utf8' })
      .split('\n').map((s) => s.trim()).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function run(argv = process.argv.slice(2), cwd = process.cwd()) {
  const root = path.resolve(cwd, arg(argv, '--root', cwd));
  const write = argv.includes('--write');
  const bundleDir = path.join(root, 'specs', 'bundles');
  if (!fs.existsSync(bundleDir)) {
    process.stdout.write('story-sync: SKIP — no specs/bundles/\n');
    return 0;
  }

  let mapText = '';
  try { mapText = fs.readFileSync(path.join(root, 'specs', 'design', 'component-map.md'), 'utf8'); } catch (_) { /* none */ }
  const ownership = parseStoryOwnership(mapText);
  const files = changedFiles(root, arg(argv, '--files', null));

  const stories = [];
  for (const rel of walkStoryFiles(root)) {
    const id = path.basename(rel, '.md');
    const bundlePath = path.join(bundleDir, `${id}.json`);
    if (!fs.existsSync(bundlePath)) continue;
    stories.push({
      id,
      markdown: fs.readFileSync(path.join(root, rel), 'utf8'),
      bundle: JSON.parse(fs.readFileSync(bundlePath, 'utf8')),
      mapFiles: ownership.get(id) || [],
    });
  }

  const verdict = planProjectSync({ stories, changedFiles: files });
  const out = {
    pass: verdict.pass,
    errors: verdict.errors,
    added: verdict.added,
    plans: verdict.plans,
    written: false,
  };

  if (!verdict.pass) {
    fs.mkdirSync(path.join(root, 'specs', 'reviews'), { recursive: true });
    fs.writeFileSync(path.join(root, 'specs', 'reviews', 'story-sync.json'), `${JSON.stringify(out, null, 2)}\n`);
    process.stderr.write(`story-sync: FAIL — ${verdict.errors.join('; ')}\n`);
    return 1;
  }

  if (write) {
    const now = new Date().toISOString();
    for (const story of stories) {
      const plan = verdict.plans.find((p) => p.story_id === story.id);
      if (!plan || (!plan.added_files.length && !plan.changed_owned.length)) continue;
      const next = applyStorySync(story.bundle, plan, now);
      fs.writeFileSync(path.join(bundleDir, `${story.id}.json`), `${JSON.stringify(next, null, 2)}\n`);
    }
    out.written = true;
  }

  fs.mkdirSync(path.join(root, 'specs', 'reviews'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', 'reviews', 'story-sync.json'), `${JSON.stringify(out, null, 2)}\n`);
  process.stdout.write(`story-sync: ${write ? 'wrote' : 'ok'} — ${verdict.added.length} file(s) to sync\n`);
  return 0;
}

module.exports = { run };

if (require.main === module) {
  try {
    process.exit(run());
  } catch (err) {
    process.stderr.write(`story-sync: ${err.message}\n`);
    process.exit(2);
  }
}
