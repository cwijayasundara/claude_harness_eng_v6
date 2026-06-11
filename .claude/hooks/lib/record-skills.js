'use strict';

// Skill attribution for telemetry records: maps hook-event evidence
// (command, lane, explicit skill fields, prompt mentions) onto the
// installed-skill catalog. Extracted from record-run.js.

function collectSkillValues(value, output = new Set()) {
  if (!value) return output;
  if (Array.isArray(value)) {
    for (const item of value) collectSkillValues(item, output);
  } else if (typeof value === 'object') {
    collectSkillValues(value.name || value.skill || value.skill_name || value.skillName, output);
  } else {
    output.add(String(value));
  }
  return output;
}

function inferSkills({ input, command, lane, catalog }) {
  const byName = new Map();
  for (const skill of catalog) {
    byName.set(skill.name, skill);
    byName.set(skill.directory, skill);
  }

  const candidates = new Set();
  if (command) candidates.add(command);
  if (lane) candidates.add(lane);
  collectSkillValues(input.skill_name, candidates);
  collectSkillValues(input.skillName, candidates);
  collectSkillValues(input.skill, candidates);
  collectSkillValues(input.skills, candidates);
  collectSkillValues(input.active_skills, candidates);
  collectSkillValues(input.tool_input && input.tool_input.skill_name, candidates);
  collectSkillValues(input.tool_response && input.tool_response.skill_name, candidates);

  const prompt = String(input.prompt || '');
  for (const match of prompt.matchAll(/\.claude\/skills\/([A-Za-z0-9_-]+)/g)) {
    candidates.add(match[1]);
  }

  return [...candidates]
    .map((name) => byName.get(name))
    .filter(Boolean)
    .filter((skill, index, list) => list.findIndex((other) => other.name === skill.name) === index)
    .map((skill) => ({ ...skill, source: command && (skill.name === command || skill.directory === command) ? 'command' : 'hook' }));
}

module.exports = { inferSkills };
