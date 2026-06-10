'use strict';

const fs = require('fs');

function applyEdit(current, oldStr, newStr, replaceAll) {
  if (replaceAll) return current.split(oldStr).join(newStr);
  const idx = current.indexOf(oldStr);
  if (idx === -1) return null; // the tool itself will fail; don't block here
  return current.slice(0, idx) + newStr + current.slice(idx + oldStr.length);
}

function simulateMultiEdit(filePath, edits) {
  let current;
  try {
    current = fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    // MultiEdit may create a new file when the first edit has an empty old_string
    if (edits.length > 0 && (edits[0].old_string || '') === '') {
      current = edits[0].new_string || '';
      edits = edits.slice(1);
    } else {
      return null;
    }
  }
  for (const e of edits) {
    current = applyEdit(current, e.old_string || '', e.new_string || '', Boolean(e.replace_all));
    if (current === null) return null;
  }
  return current;
}

// The file content as it would exist after the tool call, or null when it
// cannot be determined (the tool call would fail anyway).
function finalContent(toolName, ti, filePath) {
  if (toolName === 'Write') return ti.content || '';
  if (toolName === 'Edit') {
    let current;
    try {
      current = fs.readFileSync(filePath, 'utf8');
    } catch (_) {
      return null;
    }
    return applyEdit(current, ti.old_string || '', ti.new_string || '', Boolean(ti.replace_all));
  }
  if (toolName === 'MultiEdit' && Array.isArray(ti.edits)) {
    return simulateMultiEdit(filePath, ti.edits);
  }
  return null;
}

// Only the text this tool call introduces — what secret/pattern scans should
// see, so pre-existing on-disk content can never block an unrelated edit.
function insertedContent(toolName, ti) {
  if (toolName === 'Write') return ti.content || '';
  if (toolName === 'Edit') return ti.new_string || '';
  if (toolName === 'MultiEdit' && Array.isArray(ti.edits)) {
    return ti.edits.map((e) => e.new_string || '').join('\n');
  }
  return '';
}

module.exports = { finalContent, insertedContent };
