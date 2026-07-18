'use strict';

// Deterministic extractor for specs/design/constitution.md's `## Invariants`
// list. There is no other parser for it in the harness (it is otherwise
// LLM-read only). Returns the `- ` bullet lines under the `## Invariants`
// heading, stopping at the next `## ` heading. Tolerant: missing section -> [].

function parseInvariants(text) {
  const lines = String(text || '').split('\n');
  const out = [];
  let inSection = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^##\s+/.test(line)) {
      inSection = /^##\s+invariants\b/i.test(line);
      continue;
    }
    if (!inSection) continue;
    if (!line || line.startsWith('<!--')) continue;
    const m = line.match(/^[-*]\s+(.*\S)\s*$/);
    if (m) out.push(m[1].trim());
  }
  return out;
}

module.exports = { parseInvariants };
