#!/usr/bin/env node

'use strict';

// CLI: node .claude/scripts/tracker-body.js [--root DIR] [--granularity group|story]
// Writes tracker-runs/*.md from story bundles (fallback: a stub if no bundle).

const fs = require('fs');
const path = require('path');
const { renderBundleMarkdown, renderGroupMarkdown } = require('../hooks/lib/bundle-render');

function arg(argv, name, fallback) {
  const i = argv.indexOf(name);
  return i === -1 || argv[i + 1] === undefined ? fallback : String(argv[i + 1]);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function loadBundle(root, id) {
  return readJson(path.join(root, 'specs', 'bundles', `${id}.json`), null);
}

function writeFile(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text.endsWith('\n') ? text : `${text}\n`);
}

function run(argv = process.argv.slice(2), cwd = process.cwd()) {
  const root = path.resolve(cwd, arg(argv, '--root', cwd));
  const map = readJson(path.join(root, '.claude', 'state', 'tracker-map.json'), null);
  if (!map) {
    process.stderr.write('tracker-body: no .claude/state/tracker-map.json\n');
    return 1;
  }
  const granularity = arg(argv, '--granularity', map.granularity || 'group');
  const outDir = path.join(root, '.claude', 'state', 'tracker-runs');
  let wrote = 0;

  if (granularity === 'story') {
    for (const [id, story] of Object.entries(map.stories || {})) {
      const bundle = loadBundle(root, id);
      const body = bundle
        ? renderBundleMarkdown(bundle, {
          group: story.group,
          harnessCommand: story.harness_command || story.harnessCommand,
        })
        : `# ${id}\n\n(no story bundle — run bundle-write.js)\n`;
      const rel = `story-${id}.md`;
      writeFile(path.join(outDir, rel), body);
      story.body_file = `.claude/state/tracker-runs/${rel}`;
      wrote += 1;
    }
  } else {
    for (const [groupId, group] of Object.entries(map.groups || {})) {
      const bundles = (group.stories || []).map((id) => loadBundle(root, id)).filter(Boolean);
      const body = bundles.length
        ? renderGroupMarkdown(bundles, {
          group: groupId,
          harnessCommand: group.harness_command || `/auto --group ${groupId}`,
        })
        : `## Group ${groupId}\n\nStories: ${(group.stories || []).join(', ')}\n`;
      const rel = `group-${groupId}.md`;
      writeFile(path.join(outDir, rel), body);
      group.body_file = `.claude/state/tracker-runs/${rel}`;
      wrote += 1;
    }
  }

  fs.writeFileSync(
    path.join(root, '.claude', 'state', 'tracker-map.json'),
    `${JSON.stringify(map, null, 2)}\n`,
  );
  process.stdout.write(`tracker-body: wrote ${wrote} body file(s)\n`);
  return 0;
}

module.exports = { run };

if (require.main === module) {
  try {
    process.exit(run());
  } catch (err) {
    process.stderr.write(`tracker-body: ${err.message}\n`);
    process.exit(2);
  }
}
