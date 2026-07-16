/**
 * Record/replay transport for external-API wrappers (boundary-test-doubles kit, gap G34).
 * TypeScript sibling of replay_transport.py. Under HARNESS_TEST_REPLAY=1 a wrapper's I/O
 * seam serves a recorded golden fixture instead of hitting the network, making integration
 * and regression tests deterministic. Recording is a one-time step run with the flag unset.
 */
import { promises as fs } from 'fs';
import * as path from 'path';

export function replayEnabled(): boolean {
  return process.env.HARNESS_TEST_REPLAY === '1';
}

/** Raised in replay mode when no recorded fixture exists — the code path would have
 * reached a live external, which in a forced-replay regression run is a hard failure. */
export class MissingFixtureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissingFixtureError';
  }
}

export class ReplayTransport {
  constructor(
    private readonly service: string,
    private readonly fixturesRoot: string = 'tests/fixtures',
  ) {}

  pathFor(operation: string): string {
    return path.join(this.fixturesRoot, this.service, `${operation}.json`);
  }

  async replay(operation: string): Promise<unknown> {
    const p = this.pathFor(operation);
    try {
      return JSON.parse(await fs.readFile(p, 'utf8'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new MissingFixtureError(
          `no recorded fixture for ${this.service}/${operation} at ${p}; ` +
          `record it once with HARNESS_TEST_REPLAY unset via ReplayTransport.record()`,
        );
      }
      throw err;
    }
  }

  async record(operation: string, response: unknown): Promise<string> {
    const p = this.pathFor(operation);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, JSON.stringify(response, null, 2));
    return p;
  }
}
