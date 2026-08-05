'use strict';

// Single source of truth for token pricing.
//
// Extracted from budget-state.js so the /auto budget estimate and the
// transcript-derived bill cannot drift: the formula previously existed twice,
// and the two copies had already diverged on the cache-write rate.
//
// Cache read is ~10% of the input rate. A cache WRITE is billed ABOVE base
// input — 1.25x at the 5-minute TTL — not at 1x as the original comment
// claimed. On a real local corpus that error understated 42.6M cache-creation
// tokens by ~$53.
//
// The whole Opus tier (5, 4.8, 4.7) is $5/$25 per MTok; Sonnet 5 is listed at
// its $3/$15 sticker, not the lower intro rate. Retired pins stay so historical
// receipts price correctly; fable-5 is reserved.

const MODEL_PRICE = Object.freeze({
  'claude-opus-5': [5e-6, 25e-6],
  'claude-opus-4-8': [5e-6, 25e-6],
  'claude-opus-4-7': [5e-6, 25e-6],
  'claude-sonnet-5': [3e-6, 15e-6],
  'claude-sonnet-4-6': [3e-6, 15e-6],
  'claude-haiku-4-5': [1e-6, 5e-6],
  'claude-fable-5': [10e-6, 50e-6],
  default: [5e-6, 25e-6],
});

const CACHE_READ_FRACTION = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

// Real model ids carry a date suffix (claude-haiku-4-5-20251001); MODEL_PRICE
// keys do not. Without this, every dated or pinned id falls through to the
// default — which is the Opus rate, so Haiku billed 5x high, silently.
// Returns null when the model is genuinely unknown, so callers can report it.
function priceKey(model) {
  if (!model) return null;
  if (MODEL_PRICE[model]) return model;
  const undated = String(model).replace(/-\d{8}$/, '');
  return MODEL_PRICE[undated] ? undated : null;
}

/**
 * Cost of a usage bucket. Accepts either naming convention for cache fields.
 * @param {object} usage {input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens}
 * @param {string|null} model
 * @returns {number} USD
 */
function costOf(usage, model) {
  const price = MODEL_PRICE[priceKey(model)] || MODEL_PRICE.default;
  const cacheRead = usage.cache_read_tokens || usage.cache_read_input_tokens || 0;
  const cacheCreate = usage.cache_creation_tokens || usage.cache_creation_input_tokens || 0;
  return (usage.input_tokens || 0) * price[0]
    + (usage.output_tokens || 0) * price[1]
    + cacheRead * price[0] * CACHE_READ_FRACTION
    + cacheCreate * price[0] * CACHE_WRITE_MULTIPLIER;
}

module.exports = {
  MODEL_PRICE,
  CACHE_READ_FRACTION,
  CACHE_WRITE_MULTIPLIER,
  priceKey,
  costOf,
};
