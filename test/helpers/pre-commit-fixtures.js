'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Shared pre-commit hook test fixture: stages a file's content into a
// makeGitProject() fixture repo. Used by both the base pre-commit hook
// tests and the ownership-gate tests — kept in one place so it is never
// duplicated across test files.
function stage(projectDir, rel, content) {
  const p = path.join(projectDir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  execFileSync('git', ['add', rel], { cwd: projectDir });
  return p;
}

module.exports = { stage };
