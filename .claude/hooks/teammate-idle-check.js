#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

let input;
try {
  input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'));
} catch (_) {
  process.exit(0);
}

// Extract all text from the input to search for file paths
const inputStr = JSON.stringify(input);

// Find file paths in src/, backend/src/, or frontend/src/
const filePathPattern = /(?:frontend\/src|backend\/src|src)\/[\w/.-]+\.(?:py|tsx?|jsx?)/g;
const matches = inputStr.match(filePathPattern);

if (!matches || matches.length === 0) {
  process.exit(0);
}

// Deduplicate
const uniquePaths = [...new Set(matches)];

// Find project root by walking up from script location to find .claude/
function findProjectDir(startDir) {
  let current = startDir;
  while (true) {
    const claudeDir = path.join(current, '.claude');
    if (fs.existsSync(claudeDir)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

const scriptDir = path.dirname(path.resolve(__filename));
const projectDir = findProjectDir(scriptDir) || process.cwd();

function getTestPath(srcRelPath) {
  // srcRelPath is relative, e.g. "src/service/foo.py" or "frontend/src/components/Bar.tsx"
  const normalized = srcRelPath.replace(/\\/g, '/');

  if (normalized.endsWith('.py')) {
    // src/service/foo.py → tests/service/test_foo.py
    // Extract the part after the first src/
    const srcIdx = normalized.indexOf('src/');
    if (srcIdx === -1) return null;
    const afterSrc = normalized.slice(srcIdx + 4); // e.g. "service/foo.py"
    const dir = path.dirname(afterSrc);  // "service"
    const base = path.basename(afterSrc, '.py');  // "foo"
    const testRelPath = dir === '.' ? `tests/test_${base}.py` : `tests/${dir}/test_${base}.py`;
    return path.join(projectDir, testRelPath);
  }

  if (normalized.match(/\.(tsx?|jsx?)$/)) {
    // src/components/Bar.tsx → tests/components/Bar.test.tsx
    const srcIdx = normalized.indexOf('src/');
    if (srcIdx === -1) return null;
    const afterSrc = normalized.slice(srcIdx + 4); // e.g. "components/Bar.tsx"
    const dir = path.dirname(afterSrc);  // "components"
    const ext = path.extname(afterSrc);  // ".tsx"
    const base = path.basename(afterSrc, ext);  // "Bar"
    const testRelPath = dir === '.' ? `tests/${base}.test${ext}` : `tests/${dir}/${base}.test${ext}`;
    return path.join(projectDir, testRelPath);
  }

  return null;
}

const missingTests = [];

for (const srcRelPath of uniquePaths) {
  const testPath = getTestPath(srcRelPath);
  if (!testPath) continue;

  if (!fs.existsSync(testPath)) {
    missingTests.push(srcRelPath);
  }
}

if (missingTests.length > 0) {
  for (const file of missingTests) {
    process.stdout.write(
      `Task marked complete but no tests found for ${file}. Write tests before going idle.\nFix: Write tests for ${file} before going idle. Follow TDD: test first, then implement.\n`
    );
  }
  process.exit(2);
}

process.exit(0);
