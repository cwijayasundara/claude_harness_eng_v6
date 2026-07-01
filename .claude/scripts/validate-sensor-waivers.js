#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const REQUIRED = ['sensor_id', 'scope', 'reason', 'expires', 'approved_by'];

function isIsoDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function validateWaivers(doc, now = todayUtc()) {
  const errors = [];
  if (!doc || !Array.isArray(doc.waivers)) {
    return ['root must contain a waivers array'];
  }
  doc.waivers.forEach((w, idx) => {
    for (const field of REQUIRED) {
      if (!w || typeof w[field] !== 'string' || w[field].trim() === '') {
        errors.push(`waivers[${idx}] missing ${field}`);
      }
    }
    if (w && typeof w.reason === 'string' && w.reason.trim().length > 0 && w.reason.trim().length < 12) {
      errors.push(`waivers[${idx}] reason is too short`);
    }
    if (w && isIsoDate(w.expires) && w.expires < now) {
      errors.push(`waivers[${idx}] expired on ${w.expires}`);
    }
  });
  return errors;
}

function writeVerdict(outFile, verdict) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(verdict, null, 2)}\n`);
}

function run(argv = process.argv.slice(2), root = process.cwd()) {
  const arg = (name, fallback) => {
    const i = argv.indexOf(name);
    return i === -1 ? fallback : argv[i + 1];
  };
  const file = arg('--file', path.join(root, 'specs/reviews/sensor-waivers.json'));
  const out = arg('--out', path.join(root, 'specs/reviews/sensor-waivers-verdict.json'));
  if (!fs.existsSync(file)) {
    writeVerdict(out, { verdict: 'no-waivers', errors: [] });
    process.stdout.write('sensor-waivers: no-waivers\n');
    return 0;
  }
  let doc;
  try {
    doc = loadJson(file);
  } catch (err) {
    const errors = [`invalid JSON: ${err.message}`];
    writeVerdict(out, { verdict: 'invalid', errors });
    process.stdout.write(`sensor-waivers: invalid — ${errors.join('; ')}\n`);
    return 1;
  }
  const errors = validateWaivers(doc);
  const verdict = errors.length ? 'invalid' : 'pass';
  writeVerdict(out, { verdict, errors, waiver_count: Array.isArray(doc.waivers) ? doc.waivers.length : 0 });
  process.stdout.write(`sensor-waivers: ${verdict}${errors.length ? ' — ' + errors.join('; ') : ''}\n`);
  return errors.length ? 1 : 0;
}

if (require.main === module) {
  process.exit(run());
}

module.exports = { validateWaivers, run };
