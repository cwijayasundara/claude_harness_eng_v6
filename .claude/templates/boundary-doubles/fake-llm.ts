/**
 * Deterministic fake LLM client (boundary-test-doubles kit, gap G34). TypeScript sibling
 * of fake_llm.py: golden structured responses keyed by (operation, stable request hash),
 * so LLM-backed flows are deterministic in tests. The harness assumes a raw-fetch LLM
 * wrapper (no TS Anthropic SDK), so this doubles that wrapper's request payload. Return a
 * response validated against the same Zod / json_schema contract the real wrapper uses.
 */
import { promises as fs } from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

/** Stable 16-char hash of the request payload, order-independent (mirrors Python's
 * json.dumps(sort_keys=True)) so equivalent payloads map to the same golden. */
export function requestKey(payload: unknown): string {
  const canonical = JSON.stringify(sortValue(payload));
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

export class GoldenNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoldenNotFoundError';
  }
}

export class FakeLLMClient {
  constructor(private readonly fixturesRoot: string = 'tests/fixtures/llm') {}

  private pathFor(operation: string, key: string): string {
    return path.join(this.fixturesRoot, operation, `${key}.json`);
  }

  async respond(operation: string, payload: unknown): Promise<unknown> {
    const key = requestKey(payload);
    const p = this.pathFor(operation, key);
    try {
      return JSON.parse(await fs.readFile(p, 'utf8'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new GoldenNotFoundError(
          `no golden LLM response for ${operation}/${key} at ${p}; ` +
          `record it once against the real model via recordGolden()`,
        );
      }
      throw err;
    }
  }

  async recordGolden(operation: string, payload: unknown, response: unknown): Promise<string> {
    const key = requestKey(payload);
    const p = this.pathFor(operation, key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, JSON.stringify(response, null, 2));
    return p;
  }
}

function sortValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v && typeof v === 'object') {
    const src = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) out[k] = sortValue(src[k]);
    return out;
  }
  return v;
}
