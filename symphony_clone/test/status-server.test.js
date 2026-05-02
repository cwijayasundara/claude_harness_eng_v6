'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createStatusHandler } = require('../src/observability/status-server');

test('status handler exposes health and state snapshot', () => {
  const store = {
    snapshot() {
      return { runs: { 'ENG-1': { status: 'running' } } };
    }
  };
  const handler = createStatusHandler({ stateStore: store });
  const health = captureResponse();
  const state = captureResponse();

  handler({ url: '/health' }, health.response);
  handler({ url: '/state' }, state.response);

  assert.deepEqual(JSON.parse(health.body()), { ok: true });
  assert.equal(JSON.parse(state.body()).runs['ENG-1'].status, 'running');
});

function captureResponse() {
  const chunks = [];
  return {
    response: {
      writeHead(status, headers) {
        this.status = status;
        this.headers = headers;
      },
      end(chunk) {
        if (chunk) chunks.push(String(chunk));
      }
    },
    body() {
      return chunks.join('');
    }
  };
}
