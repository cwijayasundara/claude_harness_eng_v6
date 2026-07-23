#!/usr/bin/env node

'use strict';

// C3 — emit the harness control inventory as an OSCAL component-definition.
//
// standard-map.json mapped controls to four INVENTED clause ids (SDL-secure-development,
// AUD-audit-traceability, ARC-architecture-integrity, MNT-maintainability) with an empty
// by_id. The abstraction was right; the target was not real — it resolved to nothing an
// auditor recognises. NIST OSCAL is the machine-readable format for this, and its
// Control Mapping Model (v1.2.1, March 2026) is what turns multi-framework compliance
// from an O(N^2) crosswalk problem into O(N).
//
// The open question was "which standard are the customer's auditors on — SOC 2, ISO
// 27001, FedRAMP?". That gates only the CATALOG, not the mechanism: OSCAL identifies a
// control by (source catalog, control-id), so the catalog is a parameter. The answer
// becomes a data file (.claude/config/oscal-catalog.json), not a code change.
//
// Until a catalog is supplied, controls are emitted as explicitly UNMAPPED rather than
// mapped to invented ids. An honest, visible gap is worth more to an auditor than a
// confident-looking fiction — which is exactly what the old map was.
//
//   node .claude/scripts/oscal-emit.js [--root <dir>] [--catalog <file>] [--out <file>]

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_CATALOG = path.join('.claude', 'config', 'oscal-catalog.json');
const DEFAULT_OUT = path.join('specs', 'reviews', 'oscal-component-definition.json');
const UNMAPPED_SOURCE = 'urn:harness:unmapped';

// Per-id mapping wins over the per-axis fallback; neither present means UNMAPPED.
// Returning [] rather than a placeholder is the point: a control with no catalog binding
// must not appear to satisfy something.
function mapControl(control, catalog) {
  if (!catalog) return [];
  const byId = catalog.by_id || {};
  const byAxis = catalog.by_axis || {};
  const direct = byId[control.id];
  if (Array.isArray(direct) && direct.length) return direct.slice();
  const viaAxis = byAxis[control.axis];
  if (Array.isArray(viaAxis) && viaAxis.length) return viaAxis.slice();
  return [];
}

function allControls(manifest) {
  const guides = Array.isArray(manifest && manifest.guides) ? manifest.guides : [];
  const sensors = Array.isArray(manifest && manifest.sensors) ? manifest.sensors : [];
  return [...guides, ...sensors];
}

function stableUuid(seed) {
  return crypto.createHash('sha256').update(seed).digest('hex').slice(0, 32)
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, '$1-$2-$3-$4-$5');
}

function requirementFor(control, controlId) {
  return {
    uuid: stableUuid(`${control.id}:${controlId}`),
    'control-id': controlId,
    description:
      `Harness control "${control.id}" (axis: ${control.axis}` +
      `${control.cadence ? `, cadence: ${control.cadence}` : ''}) implements this requirement.`,
  };
}

// Controls with no catalog binding still appear, under an explicit unmapped source, so
// the inventory total always reconciles and the gap is countable.
function unmappedImplementation(unmapped) {
  return {
    uuid: stableUuid('impl:unmapped'),
    source: UNMAPPED_SOURCE,
    description:
      'No OSCAL catalog is bound for these controls yet (no catalog configured, or no ' +
      'mapping entry). They are listed so the inventory reconciles and the gap is visible; ' +
      'they assert conformance to nothing.',
    'implemented-requirements': unmapped.map((c) => ({
      uuid: stableUuid(`unmapped:${c.id}`),
      'control-id': `UNMAPPED:${c.id}`,
      description: `Harness control "${c.id}" (axis: ${c.axis}) has no catalog mapping.`,
    })),
  };
}

function mappedImplementation(catalog, mapped) {
  return {
    uuid: stableUuid(`impl:${catalog.catalog.id}`),
    source: catalog.catalog.href,
    description: `Harness controls mapped to ${catalog.catalog.title}.`,
    'implemented-requirements': mapped,
  };
}

function buildImplementations(controls, catalog) {
  const mapped = [];
  const unmapped = [];
  for (const c of controls) {
    const ids = mapControl(c, catalog);
    if (ids.length === 0) unmapped.push(c);
    else for (const id of ids) mapped.push(requirementFor(c, id));
  }
  const out = [];
  if (mapped.length) out.push(mappedImplementation(catalog, mapped));
  if (unmapped.length) out.push(unmappedImplementation(unmapped));
  return out;
}

function emitComponentDefinition({ manifest, catalog, harnessVersion, uuid, now }) {
  const controls = allControls(manifest);
  if (controls.length === 0) {
    // An empty component-definition validates fine and reads as a clean bill of health.
    throw new Error('oscal-emit: no controls in the manifest — refusing to emit a component that claims nothing');
  }
  return {
    'component-definition': {
      uuid: uuid || stableUuid('component-definition'),
      metadata: {
        title: 'Claude Harness — control inventory',
        'last-modified': now || new Date().toISOString(),
        version: harnessVersion,
        'oscal-version': '1.1.2',
      },
      components: [{
        uuid: stableUuid('component:harness'),
        type: 'software',
        title: 'Claude Harness Engine',
        description: 'Guides and sensors enforced by the harness across the SDLC.',
        'control-implementations': buildImplementations(controls, catalog),
      }],
    },
  };
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

function argValue(argv, flag) {
  const i = argv.indexOf(flag);
  return i === -1 ? null : argv[i + 1];
}

function reportEmit(doc, outFile, catalog) {
  const impls = doc['component-definition'].components[0]['control-implementations'];
  console.log(`oscal-emit: ${impls.map((i) => `${i['implemented-requirements'].length} @ ${i.source}`).join(', ')} -> ${outFile}`);
  if (catalog) return;
  console.log('  NOTE: no OSCAL catalog bound. Add .claude/config/oscal-catalog.json once the');
  console.log("        auditors' standard is known — SOC 2, ISO 27001 or FedRAMP. Until then");
  console.log('        every control is emitted UNMAPPED, which is the honest state.');
}

function main(argv = process.argv.slice(2)) {
  const root = argValue(argv, '--root') || REPO_ROOT;
  const manifest = readJson(path.join(root, 'harness-manifest.json'));
  if (!manifest) {
    console.error('oscal-emit: harness-manifest.json not found');
    return 2;
  }
  const catalog = readJson(path.join(root, argValue(argv, '--catalog') || DEFAULT_CATALOG));
  let doc;
  try {
    doc = emitComponentDefinition({
      manifest,
      catalog,
      harnessVersion: (readJson(path.join(root, 'package.json')) || {}).version || '0.0.0',
    });
  } catch (err) {
    console.error(err.message);
    return 1;
  }
  const outFile = path.join(root, argValue(argv, '--out') || DEFAULT_OUT);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(doc, null, 2) + '\n');
  reportEmit(doc, outFile, catalog);
  return 0;
}

if (require.main === module) process.exit(main());

module.exports = { emitComponentDefinition, mapControl, allControls, UNMAPPED_SOURCE };
