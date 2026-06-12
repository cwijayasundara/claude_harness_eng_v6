'use strict';

// Minimal JSON Schema (draft-07 subset) validator — just enough for
// contract-schema.json: type, required, properties, additionalProperties,
// items, enum, minItems, minimum, maximum. No external dependencies because
// the harness ships without node_modules. Unknown schema keywords are
// ignored (permissive), so a schema edit cannot brick commits.

function typeOf(v) {
  if (Array.isArray(v)) return 'array';
  if (v === null) return 'null';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function typeMatches(expected, v) {
  if (expected === 'number') return typeof v === 'number';
  if (expected === 'integer') return Number.isInteger(v);
  return typeOf(v) === expected;
}

function validateObject(schema, value, at, errors, depth) {
  for (const key of schema.required || []) {
    if (!(key in value)) errors.push(`${at}: missing required property "${key}"`);
  }
  const props = schema.properties || {};
  for (const [key, sub] of Object.entries(value)) {
    if (key in props) {
      validate(props[key], sub, `${at}.${key}`, errors, depth + 1);
    } else if (schema.additionalProperties === false) {
      errors.push(`${at}: unknown property "${key}"`);
    } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      validate(schema.additionalProperties, sub, `${at}.${key}`, errors, depth + 1);
    }
  }
}

function validateArray(schema, value, at, errors, depth) {
  if (schema.minItems !== undefined && value.length < schema.minItems) {
    errors.push(`${at}: needs at least ${schema.minItems} item(s), has ${value.length}`);
  }
  if (schema.items) {
    value.forEach((item, i) => validate(schema.items, item, `${at}[${i}]`, errors, depth + 1));
  }
}

function validateNumber(schema, value, at, errors) {
  if (schema.minimum !== undefined && value < schema.minimum) {
    errors.push(`${at}: ${value} is below minimum ${schema.minimum}`);
  }
  if (schema.maximum !== undefined && value > schema.maximum) {
    errors.push(`${at}: ${value} is above maximum ${schema.maximum}`);
  }
}

const MAX_DEPTH = 128;

// Returns an array of human-readable errors; empty array = valid.
function validate(schema, value, at = '$', errors = [], depth = 0) {
  if (depth > MAX_DEPTH) {
    errors.push(`${at}: exceeds maximum validation depth ${MAX_DEPTH}`);
    return errors;
  }
  if (schema.type && !typeMatches(schema.type, value)) {
    errors.push(`${at}: expected ${schema.type}, got ${typeOf(value)}`);
    return errors; // wrong shape — deeper checks would only cascade noise
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${at}: "${value}" is not one of: ${schema.enum.join(', ')}`);
  }
  const t = typeOf(value);
  if (t === 'object') validateObject(schema, value, at, errors, depth);
  if (t === 'array') validateArray(schema, value, at, errors, depth);
  if (t === 'number' || t === 'integer') validateNumber(schema, value, at, errors);
  return errors;
}

module.exports = { validate };
