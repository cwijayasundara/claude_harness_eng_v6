'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeSerializedTick } = require('./index');

test('serialized tick skips interval fires that overlap a slow tick', async () => {
  let resolveTick;
  let calls = 0;
  const scheduler = {
    logger: { info() {} },
    tick() {
      calls += 1;
      return new Promise((resolve) => { resolveTick = resolve; });
    }
  };

  const tick = makeSerializedTick(scheduler);

  const first = tick();      // starts, hangs on the unresolved promise
  await tick();              // fires while first is in flight — must be a no-op
  assert.equal(calls, 1, 'overlapping tick must not re-enter the scheduler');

  resolveTick({});
  await first;

  const second = tick();     // after completion the next tick re-enters
  assert.equal(calls, 2);
  resolveTick({});
  await second;
});
