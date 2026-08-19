'use strict';

// Append a sprint's verification-matrix rows into the living matrix.
// Existing rows stay. A same-id row with a different ac_id is superseded,
// not deleted.

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function incomingRows(incoming) {
  if (Array.isArray(incoming)) return incoming;
  return asArray(incoming && incoming.requirements);
}

function appendMatrix(living, incoming, { sprint } = {}) {
  const rows = asArray(living && living.requirements).map((row) => ({ ...row }));
  const byId = new Map(rows.map((row, i) => [row.id, i]));
  const added = [];
  const superseded = [];

  for (const raw of incomingRows(incoming)) {
    if (!raw || !raw.id) continue;
    const row = { ...raw, sprint: sprint || raw.sprint };
    const idx = byId.get(row.id);
    if (idx == null) {
      rows.push(row);
      byId.set(row.id, rows.length - 1);
      added.push(row.id);
      continue;
    }
    const prev = rows[idx];
    if (prev.ac_id === row.ac_id) {
      rows[idx] = { ...prev, ...row };
      continue;
    }
    const nextId = sprint ? `${row.id}@s${sprint}` : `${row.id}@next`;
    rows[idx] = { ...prev, status: 'superseded', superseded_by: nextId };
    const next = { ...row, id: nextId, supersedes: prev.id };
    rows.push(next);
    byId.set(nextId, rows.length - 1);
    superseded.push({ from: prev.id, to: nextId });
  }

  return {
    matrix: { version: 1, ...(living || {}), requirements: rows },
    added,
    superseded,
  };
}

module.exports = { appendMatrix };
