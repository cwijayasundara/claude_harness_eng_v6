/**
 * MSW request handlers that serve the recorded boundary-doubles fixtures for front-end
 * component tests (boundary-test-doubles kit, gap G34). Fills the "MSW named but never
 * shown" gap: component tests mock at the `src/api/` boundary via MSW instead of reaching
 * a real service. The same golden fixtures the ReplayTransport records under
 * tests/fixtures/{service}/{op}.json back these handlers.
 *
 * Requires `msw` (dev dependency). Register the server in vitest.setup.ts.
 */
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { promises as fs } from 'fs';
import * as path from 'path';

async function fixture(service: string, operation: string): Promise<unknown> {
  const p = path.join('tests/fixtures', service, `${operation}.json`);
  return JSON.parse(await fs.readFile(p, 'utf8'));
}

// Map each mocked endpoint to a recorded fixture. Add one line per external operation the
// front end calls through src/api/. Non-localhost calls are additionally blocked by the
// live-externals gate (G36) — these handlers are the deterministic substitute.
export const handlers = [
  http.get('*/api/example', async () => HttpResponse.json(await fixture('example_service', 'get_example') as object)),
];

export const server = setupServer(...handlers);
