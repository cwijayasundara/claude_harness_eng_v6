'use strict';

// Canonical JSON serialization + sha256 hashing for the compliance-attestation
// evidence bundle (Increment 4a). Split out of generate-attestation.js so the
// integrity primitive is a small, independently-testable pure module (no IO).
//
// The attestation's tamper-evidence depends on ONE property: the same logical
// bundle must always serialize to the same bytes regardless of key insertion
// order, so a stored sha256 can be re-derived and compared. JSON.stringify does
// not guarantee that (it preserves insertion order); canonicalize() does, by
// recursively sorting object keys. Arrays keep their order (order is meaningful).

const crypto = require('crypto');

// Deterministic JSON string: object keys sorted recursively, arrays in order,
// undefined-valued keys dropped so a present-vs-absent key never changes bytes.
function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const parts = [];
  for (const key of Object.keys(value).sort()) {
    if (value[key] === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${canonicalize(value[key])}`);
  }
  return `{${parts.join(',')}}`;
}

function sha256Hex(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

// The integrity hash is taken over the bundle with its own `integrity` field
// removed (you cannot hash a field that will hold the hash).
function contentHash(bundle) {
  const rest = {};
  for (const key of Object.keys(bundle)) {
    if (key !== 'integrity') rest[key] = bundle[key];
  }
  return sha256Hex(canonicalize(rest));
}

module.exports = { canonicalize, sha256Hex, contentHash };
