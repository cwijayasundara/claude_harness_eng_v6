/**
 * Vitest setup — binds the boundary doubles under HARNESS_TEST_REPLAY=1 (boundary-test-
 * doubles kit, gap G34). TypeScript analogue of conftest.py. Referenced from
 * vitest.config.ts `test.setupFiles`. Registers the MSW server for src/api/ component
 * tests; the LLM fake and DB fixture are imported per-test where needed.
 */
import { beforeAll, afterEach, afterAll } from 'vitest';
import { server } from './msw-handlers';
import { FakeLLMClient } from './fake-llm';

export function replayEnabled(): boolean {
  return process.env.HARNESS_TEST_REPLAY === '1';
}

/** Construct the fake LLM client; integration/regression tests must run in replay mode. */
export function llmClient(): FakeLLMClient {
  if (!replayEnabled()) {
    throw new Error(
      'llmClient() requested without HARNESS_TEST_REPLAY=1; integration and regression ' +
      'tests must run in replay mode (see the live-externals gate, G36)',
    );
  }
  return new FakeLLMClient();
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
