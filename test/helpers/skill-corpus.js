'use strict';

// Read a skill's SKILL.md plus any references/*.md as one corpus.
// Phase 4 progressive loading: wiring contracts must not break when procedure
// moves from SKILL.md into references/.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');

function readSkillCorpus(skillName, root = REPO_ROOT) {
  const skillDir = path.join(root, '.claude', 'skills', skillName);
  const skillMd = path.join(skillDir, 'SKILL.md');
  if (!fs.existsSync(skillMd)) {
    throw new Error(`skill corpus missing: ${skillMd}`);
  }
  let text = fs.readFileSync(skillMd, 'utf8');
  const refsDir = path.join(skillDir, 'references');
  if (fs.existsSync(refsDir)) {
    const files = fs.readdirSync(refsDir).filter((f) => f.endsWith('.md')).sort();
    for (const f of files) {
      text += `\n${fs.readFileSync(path.join(refsDir, f), 'utf8')}`;
    }
  }
  return text;
}

function skillEntryLineCount(skillName, root = REPO_ROOT) {
  const skillMd = path.join(root, '.claude', 'skills', skillName, 'SKILL.md');
  return fs.readFileSync(skillMd, 'utf8').split('\n').length;
}

module.exports = { readSkillCorpus, skillEntryLineCount, REPO_ROOT };
