'use strict';

// Validates the plugin surfaces Claude Code parses — plugin.json, SKILL.md
// frontmatter, and settings.json hook wiring — so upstream schema churn or a
// bad edit fails CI instead of failing silently at session start.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const PLUGIN_MANIFEST = path.join(ROOT, '.claude', '.claude-plugin', 'plugin.json');
const SKILLS_DIR = path.join(ROOT, '.claude', 'skills');
const SETTINGS = path.join(ROOT, '.claude', 'settings.json');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function frontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!m) return null;
  const fields = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z-]+):\s*(.*)$/.exec(line);
    if (kv) fields[kv[1]] = kv[2];
  }
  return fields;
}

function hookCommands(settings) {
  const commands = [];
  for (const entries of Object.values(settings.hooks || {})) {
    for (const entry of entries) {
      for (const hook of entry.hooks || []) {
        if (hook.type === 'command') commands.push(hook.command);
      }
    }
  }
  return commands;
}

test('plugin.json has name, semver version, and description', () => {
  const manifest = readJson(PLUGIN_MANIFEST);
  assert.ok(manifest.name, 'name missing');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/, 'version must be semver');
  assert.ok(manifest.description, 'description missing');
});

test('plugin.json version matches package.json version', () => {
  const manifest = readJson(PLUGIN_MANIFEST);
  const pkg = readJson(path.join(ROOT, 'package.json'));
  assert.strictEqual(manifest.version, pkg.version);
});

test('every SKILL.md has frontmatter with name matching its directory and a description', () => {
  const broken = [];
  for (const dir of fs.readdirSync(SKILLS_DIR)) {
    const skillFile = path.join(SKILLS_DIR, dir, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;
    const fields = frontmatter(fs.readFileSync(skillFile, 'utf8'));
    if (!fields) broken.push(`${dir}: no frontmatter`);
    else if (fields.name !== dir) broken.push(`${dir}: frontmatter name is "${fields.name}"`);
    else if (!fields.description) broken.push(`${dir}: missing description`);
  }
  assert.deepStrictEqual(broken, [], broken.join('\n'));
});

test('every settings.json command hook resolves to a tracked file', () => {
  const broken = [];
  for (const command of hookCommands(readJson(SETTINGS))) {
    const m = /\$CLAUDE_PROJECT_DIR\/([^\s"]+)/.exec(command);
    if (!m) continue;
    if (!fs.existsSync(path.join(ROOT, m[1]))) broken.push(command);
  }
  assert.deepStrictEqual(broken, [], `hook commands pointing at missing files:\n${broken.join('\n')}`);
});

test('no settings.json command hook hardcodes an absolute path', () => {
  const offenders = hookCommands(readJson(SETTINGS)).filter((c) =>
    /(^|\s|")\/(Users|home)\//.test(c)
  );
  assert.deepStrictEqual(offenders, [], `hooks must use $CLAUDE_PROJECT_DIR:\n${offenders.join('\n')}`);
});
