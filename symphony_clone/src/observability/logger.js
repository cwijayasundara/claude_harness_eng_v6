'use strict';

const fs = require('node:fs');
const path = require('node:path');

class JsonlLogger {
  constructor({ logRoot }) {
    this.logRoot = logRoot;
    this.logPath = path.join(logRoot, 'orchestrator.jsonl');
    fs.mkdirSync(logRoot, { recursive: true });
  }

  info(event, data = {}) {
    this.write('info', event, data);
  }

  warn(event, data = {}) {
    this.write('warn', event, data);
  }

  error(event, data = {}) {
    this.write('error', event, data);
  }

  write(level, event, data) {
    const record = { ts: new Date().toISOString(), level, event, ...data };
    fs.appendFileSync(this.logPath, JSON.stringify(record) + '\n');
    const suffix = data.issueKey ? ` issue=${data.issueKey}` : '';
    console.log(`${record.ts} ${level} ${event}${suffix}`);
  }
}

function createLogger(config) {
  return new JsonlLogger({ logRoot: config.logRoot });
}

module.exports = { JsonlLogger, createLogger };

