'use strict';

// Deterministic matrix enrichment for /test --plan-only. Attaches schema
// obligations, story-owned files, and extra layers so the model does not
// walk 60+ OBL ids by hand.

function asArray(v) { return Array.isArray(v) ? v : []; }

const STOP = new Set([
  'request', 'response', 'page', 'the', 'and', 'for', 'with', 'from',
  'that', 'this', 'object', 'schema', 'json', 'body',
]);

function layerFor(story) {
  const layer = String(story && story.layer || '').toLowerCase();
  if (layer === 'ui' || layer === 'frontend' || layer === 'web') return 'e2e';
  if (layer === 'config' || layer === 'types') return 'unit';
  return 'api';
}

function extraLayers(text) {
  const t = String(text || '').toLowerCase();
  const extra = [];
  if (/\b(axe|wcag|keyboard|contrast|screen reader|accessibility)\b/.test(t)) extra.push('accessibility');
  if (/\bp95\b|\blatency\b|\bperformance\b|\d+\s*ms\b/.test(t)) extra.push('performance');
  if (/\b(ssrf|xss|csrf|injection|cross-owner|isolation|other (member|owner)|does not own)\b/.test(t)) extra.push('security');
  if (/\b(pure function|no i\/o|plaintext password)\b/.test(t) || /argon2|csprng|10,?000/.test(t)) extra.push('unit');
  return extra;
}

function layersFor(story, acText) {
  const t = String(acText || '').toLowerCase();
  const storyLayer = String(story && story.layer || '').toLowerCase();
  let primary = layerFor(story);
  const page = /\b(page|browser|renders)\b/.test(t);
  const notBoot = !/\b(compose|migration)\b/.test(t);
  if (primary === 'api' && storyLayer === 'fullstack' && page && notBoot) primary = 'e2e';
  const out = [primary];
  const seen = new Set(out);
  for (const layer of extraLayers(acText)) {
    if (!seen.has(layer)) { seen.add(layer); out.push(layer); }
  }
  return out;
}

function tokens(s) {
  return String(s || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

function haystack(row) {
  return `${row.story_id || ''} ${row.ac_id || ''} ${row.title || ''} ${row.text || ''}`.toLowerCase();
}

function scoreRow(obl, row) {
  const field = String(obl && obl.field || '');
  const parts = field.split('.');
  const hay = haystack(row);
  let score = 0;
  for (const tok of tokens(parts[0])) if (hay.includes(tok)) score += 3;
  for (const tok of tokens(parts.slice(1).join(' '))) if (hay.includes(tok)) score += 5;
  const model = String(parts[0] || '').toLowerCase();
  if (model.includes('request') && /\b(422|reject|invalid|omit)\b/.test(hay)) score += 2;
  if (model.includes('error') && /\b(error|503|4\d\d|5\d\d)\b/.test(hay)) score += 4;
  return score;
}

function addObligation(row, traces, oid) {
  const current = asArray(row.obligations);
  if (!current.includes(oid)) current.push(oid);
  row.obligations = current.sort();
  const entry = traces.find((t) => t.id === row.id);
  if (!entry) return;
  const list = asArray(entry.traces);
  if (!list.includes(oid)) list.push(oid);
  entry.traces = list;
}

function bestRow(requirements, obl) {
  let best = requirements[0];
  let bestScore = -1;
  for (const row of requirements) {
    const score = scoreRow(obl, row);
    if (score > bestScore) { bestScore = score; best = row; }
  }
  return { row: best, score: bestScore };
}

function attachObligations(requirements, testTraces, obligations) {
  const rows = asArray(requirements);
  const traces = asArray(testTraces);
  const unmatched = [];
  let attached = 0;
  if (!rows.length) return { attached: 0, unmatched: asArray(obligations).map((o) => o.id) };
  for (const obl of asArray(obligations)) {
    const { row, score } = bestRow(rows, obl);
    if (score <= 0) unmatched.push(obl.id);
    addObligation(row, traces, obl.id);
    attached += 1;
  }
  return { attached, unmatched };
}

function filesByStory(designTraces) {
  const map = new Map();
  for (const entry of asArray(designTraces)) {
    for (const storyId of asArray(entry && entry.traces)) {
      if (!map.has(storyId)) map.set(storyId, []);
      map.get(storyId).push(entry.id);
    }
  }
  return map;
}

function acBlob(ac) {
  if (!ac) return '';
  if (typeof ac === 'string') return ac;
  return [ac.given, ac.when, ac.then, ac.text].filter(Boolean).join(' ');
}

function collectAcText(acceptance, stories) {
  const map = new Map();
  for (const row of asArray(acceptance)) {
    if (row && row.id) map.set(row.id, acBlob(row));
  }
  for (const story of asArray(stories)) {
    for (const ac of asArray(story && story.acceptance_criteria)) {
      if (ac && ac.id && !map.get(ac.id)) map.set(ac.id, acBlob(ac));
    }
  }
  return map;
}

function stampRows(requirements, testTraces, stories, acceptance) {
  const storyById = new Map(asArray(stories).map((s) => [s.id, s]));
  const acText = collectAcText(acceptance, stories);
  const textById = new Map(asArray(testTraces).map((t) => [t.id, t.text]));
  for (const row of asArray(requirements)) {
    const meta = storyById.get(row.story_id) || {};
    row.title = meta.title || '';
    row.text = acText.get(row.ac_id) || textById.get(row.id) || '';
  }
}

function applyLayers(requirements, stories) {
  const storyById = new Map(asArray(stories).map((s) => [s.id, s]));
  for (const row of asArray(requirements)) {
    const layers = layersFor(storyById.get(row.story_id) || {}, row.text);
    row.required_layers = layers;
    const base = (asArray(row.checks)[0] || {}).description || `Verify ${row.ac_id}`;
    row.checks = layers.map((layer) => ({
      id: `CHK-${row.id}-${layer}`, layer, description: base,
    }));
  }
}

function applyPaths(requirements, designTraces) {
  const map = filesByStory(designTraces);
  for (const row of asArray(requirements)) {
    row.implementation_paths = map.get(row.story_id) || [];
  }
}

function persistRow(row) {
  const out = { ...row };
  delete out.title;
  delete out.text;
  return out;
}

function unique(list) {
  const out = [];
  const seen = new Set();
  for (const item of asArray(list)) {
    const key = typeof item === 'string' ? item : JSON.stringify(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function remapCheck(check, nextId) {
  const id = String((check && check.id) || '').replace(/VM-\d+/, nextId);
  return { ...check, id };
}

function mergeReviewed(existing, nextRows, nextTraces) {
  const rows = asArray(nextRows);
  const traces = asArray(nextTraces);
  const byAc = new Map(asArray(existing).filter((r) => r && r.ac_id).map((r) => [r.ac_id, r]));
  const nextAcs = new Set(rows.map((r) => r.ac_id).filter(Boolean));
  const dropped = asArray(existing).map((r) => r && r.ac_id).filter((id) => id && !nextAcs.has(id));
  for (const row of rows) {
    const prev = byAc.get(row.ac_id);
    if (!prev) continue;
    if (asArray(prev.required_layers).length) {
      row.required_layers = unique(prev.required_layers);
      if (asArray(prev.checks).length) {
        row.checks = prev.checks.map((check) => remapCheck(check, row.id));
      }
    }
    row.obligations = unique([...asArray(row.obligations), ...asArray(prev.obligations)]).sort();
    const prevPaths = asArray(prev.implementation_paths);
    if (prevPaths.length) {
      row.implementation_paths = unique([...asArray(row.implementation_paths), ...prevPaths]);
    }
    const entry = traces.find((t) => t.id === row.id);
    if (entry) {
      entry.traces = unique([...asArray(entry.traces), ...asArray(prev.obligations)]);
    }
  }
  return { dropped };
}

function enrichPlan({ requirements, testTraces, stories, acceptance, designTraces, obligations }) {
  stampRows(requirements, testTraces, stories, acceptance);
  applyLayers(requirements, stories);
  applyPaths(requirements, designTraces);
  const attached = attachObligations(requirements, testTraces, obligations);
  return attached;
}

module.exports = {
  layerFor, layersFor, extraLayers, attachObligations, filesByStory,
  collectAcText, enrichPlan, persistRow, mergeReviewed,
};
