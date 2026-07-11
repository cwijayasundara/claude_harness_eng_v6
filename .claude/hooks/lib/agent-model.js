'use strict';

// Resolve an agent role's model pin from frontmatter. Pure filesystem helper
// used by record-run to stamp receipts without inventing usage counts.

const fs = require('fs');
const path = require('path');

function parseModelFromFrontmatter(text) {
  if (!text || typeof text !== 'string') return null;
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const modelLine = m[1].match(/^model:\s*(\S+)\s*$/m);
  return modelLine ? modelLine[1] : null;
}

function resolveAgentModel(projectDir, agentName) {
  if (!projectDir || !agentName || agentName === 'unknown' || agentName === 'human') {
    return null;
  }
  const file = path.join(projectDir, '.claude', 'agents', `${agentName}.md`);
  try {
    return parseModelFromFrontmatter(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

// Pull optional usage fields from a hook payload when present (never invent).
function extractUsageFields(input) {
  const sources = [
    input && input.usage,
    input && input.tool_response && input.tool_response.usage,
    input && input.tool_response && input.tool_response.total_usage,
    input && input.metadata && input.metadata.usage,
  ].filter(Boolean);

  const out = {};
  for (const u of sources) {
    if (u.model && !out.model) out.model = String(u.model);
    if (u.input_tokens != null && out.input_tokens == null) out.input_tokens = Number(u.input_tokens);
    if (u.output_tokens != null && out.output_tokens == null) out.output_tokens = Number(u.output_tokens);
    if (u.cache_read_input_tokens != null && out.cache_read_tokens == null) {
      out.cache_read_tokens = Number(u.cache_read_input_tokens);
    }
    if (u.cache_read_tokens != null && out.cache_read_tokens == null) {
      out.cache_read_tokens = Number(u.cache_read_tokens);
    }
    if (u.cache_creation_input_tokens != null && out.cache_creation_tokens == null) {
      out.cache_creation_tokens = Number(u.cache_creation_input_tokens);
    }
    if (u.cache_creation_tokens != null && out.cache_creation_tokens == null) {
      out.cache_creation_tokens = Number(u.cache_creation_tokens);
    }
  }
  if (input && input.model && !out.model) out.model = String(input.model);
  // Drop NaNs
  for (const k of ['input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_creation_tokens']) {
    if (out[k] != null && !Number.isFinite(out[k])) delete out[k];
  }
  return out;
}

module.exports = {
  parseModelFromFrontmatter,
  resolveAgentModel,
  extractUsageFields,
};
