#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function parseSkillFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---/);
  const result = {};
  if (!match) return result;
  for (const line of match[1].split('\n')) {
    const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!pair) continue;
    result[pair[1]] = pair[2].replace(/^["']|["']$/g, '').trim();
  }
  return result;
}

function truncateLabel(value, limit = 180) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function readSkillCatalog(projectDir) {
  const skillsDir = path.join(projectDir, '.claude', 'skills');
  try {
    return fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const skillPath = path.join(skillsDir, entry.name, 'SKILL.md');
        const raw = fs.readFileSync(skillPath, 'utf8');
        const frontmatter = parseSkillFrontmatter(raw);
        return {
          name: frontmatter.name || entry.name,
          directory: entry.name,
          path: `.claude/skills/${entry.name}/SKILL.md`,
          description: truncateLabel(frontmatter.description || ''),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (_) {
    return [];
  }
}

function collectSkillInventory(record, skillInfo, { labelPairs, setGauge }) {
  for (const skill of [...(record.skill_inventory || []), ...(record.skills || [])]) {
    if (!skill || !skill.name) continue;
    const labels = labelPairs([
      ['skill', skill.name],
      ['directory', skill.directory || skill.name],
      ['path', skill.path],
      ['description', skill.description],
    ]);
    setGauge(skillInfo, 'harness_skill_info', labels, 1);
  }
}

function inferRecordSkills(record, skillInventory) {
  if (Array.isArray(record.skills) && record.skills.length > 0) return record.skills;
  const byName = new Map();
  for (const skill of skillInventory) {
    byName.set(skill.name, skill);
    byName.set(skill.directory, skill);
  }
  const inferred = [];
  for (const value of [record.command, record.lane]) {
    const skill = byName.get(value);
    if (skill && !inferred.some((item) => item.name === skill.name)) {
      inferred.push({ ...skill, source: value === record.command ? 'command' : 'lane' });
    }
  }
  return inferred;
}

function addSkillUsage(record, counters, skillInventory, { labelPairs, addCounter }) {
  for (const skill of inferRecordSkills(record, skillInventory)) {
    if (!skill || !skill.name) continue;
    addCounter(counters, 'harness_skill_usage_total', labelPairs([
      ['skill', skill.name],
      ['directory', skill.directory || skill.name],
      ['source', skill.source || 'hook'],
      ['kind', record.kind],
      ['command', record.command],
      ['tool', record.tool],
      ['agent', record.agent],
      ['user', record.user],
      ['lane', record.lane],
      ['mode', record.mode],
      ['group', record.group_id],
      ['story', record.story_id],
      ['iteration', record.iteration],
      ['host', record.host],
    ]));
  }
}

module.exports = {
  parseSkillFrontmatter,
  truncateLabel,
  readSkillCatalog,
  collectSkillInventory,
  inferRecordSkills,
  addSkillUsage,
};
