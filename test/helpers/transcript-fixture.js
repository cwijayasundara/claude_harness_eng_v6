'use strict';

// Transcript fixtures shared by the phase-cost attribution tests and the
// turn/cache profiling tests. They were one file until phase-cost.test.js hit
// its 500-line cap; the fixtures are the only thing both halves need.

const fs = require('fs');
const os = require('os');
const path = require('path');

function writeTranscript(rows) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-phase-cost-'));
  const file = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return file;
}

const userTurn = (ts, text, isSidechain = false) => ({
  type: 'user', isSidechain, timestamp: ts, message: { content: text },
});

const assistantTurn = (ts, id, model, output) => ({
  type: 'assistant', isSidechain: false, timestamp: ts, requestId: id,
  message: { id, model, usage: { input_tokens: 0, output_tokens: output } },
});

module.exports = { writeTranscript, userTurn, assistantTurn };
