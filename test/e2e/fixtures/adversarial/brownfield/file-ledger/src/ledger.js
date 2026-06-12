'use strict';

const fs = require('fs');

function parseLine(line) {
  const [id, cents, note] = line.split('|');
  return { id, cents: Number(cents), note };
}

function loadLedger(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(parseLine);
}

function appendEntry(filePath, entry) {
  const line = `${entry.id}|${entry.cents}|${entry.note}\n`;
  fs.appendFileSync(filePath, line);
}

module.exports = { appendEntry, loadLedger, parseLine };
