'use strict';

// Standard agent-facing gate message shape (Fix / Waive / Tier).
// Pre-commit gates call failBlock() → formatBlock(); bare fail() remains for
// one-off paths that already built a complete message.

/**
 * @param {object} opts
 * @param {string} [opts.id] sensor / gate id
 * @param {string} opts.title one-line summary after BLOCKED:
 * @param {string} [opts.detail] multi-line body (already includes trailing newline optional)
 * @param {string} [opts.fix] remediation for the agent
 * @param {string} [opts.waive] waiver path / sensor_id note
 * @param {string} [opts.envOff] e.g. HARNESS_MUTATION_GATE — local escape hatch name
 * @param {string} [opts.tier] current sensor_tier (minimal|standard|strict)
 * @param {string} [opts.minTier] lowest tier that includes this gate
 */
function formatBlock(opts) {
  const id = opts.id ? ` [${opts.id}]` : '';
  const title = (opts.title || '').replace(/\n+$/, '');
  let msg = `BLOCKED${id}: ${title}\n`;
  if (opts.detail) {
    const d = String(opts.detail);
    msg += d.endsWith('\n') ? d : `${d}\n`;
  }
  if (opts.fix && !/\bFix:/i.test(msg)) {
    msg += `Fix: ${opts.fix}\n`;
  }
  if (opts.waive) {
    msg += `Waive: ${opts.waive}\n`;
  } else if (opts.envOff) {
    msg += `Waive: reviewed exception in specs/reviews/sensor-waivers.json, or ${opts.envOff}=off (local only)\n`;
  }
  if (opts.tier || opts.minTier) {
    const parts = [];
    if (opts.tier) parts.push(`active sensor_tier="${opts.tier}"`);
    if (opts.minTier) parts.push(`this gate runs at ${opts.minTier}+`);
    msg += `Tier: ${parts.join('; ')} (see docs/product-skus-and-tiers.md)\n`;
  }
  return msg;
}

function formatSkip(gate, reason, tier) {
  let msg =
    `WARNING: GATE SKIPPED — ${gate} did not run (${reason}). Staged code was NOT verified by this gate.\n` +
    `         Fix: provision the toolchain, or set the matching *_GATE=off to acknowledge the skip.\n`;
  if (tier) {
    msg += `         Tier: active sensor_tier="${tier}"\n`;
  }
  return msg;
}

/** Append Tier footer to an existing BLOCKED message if missing. */
function ensureTierFooter(message, tier) {
  if (!tier || /Tier:/i.test(message)) return message;
  const base = message.endsWith('\n') ? message : `${message}\n`;
  return `${base}Tier: active sensor_tier="${tier}" (see docs/product-skus-and-tiers.md)\n`;
}

module.exports = {
  formatBlock,
  formatSkip,
  ensureTierFooter,
};
