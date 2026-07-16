/**
 * Acceptance-test template — Ports-and-Adapters with a fake adapter (boundary-test-doubles
 * kit, gap G34). TypeScript sibling of at-template.py. Copy to a project test near the
 * business logic and adapt per story, so writing-acceptance-tests-first has a concrete
 * house pattern on the TS stack instead of hand-rolling the first AT.
 *
 * GIVEN a valid registration request
 * WHEN the account is registered through the business port
 * THEN an account exists with the given email
 */
import { describe, it, expect } from 'vitest';

// --- Port: the narrow I/O interface the business logic depends on ---
export interface AccountStore {
  save(email: string): Promise<void>;
  exists(email: string): Promise<boolean>;
}

// --- Test-double adapter: fast, in-memory, deterministic ---
export class FakeAccountStore implements AccountStore {
  private readonly emails = new Set<string>();
  async save(email: string): Promise<void> { this.emails.add(email); }
  async exists(email: string): Promise<boolean> { return this.emails.has(email); }
}

// The business port entry point under test — import the real one in a project:
//   import { register } from '../src/accounts';
async function register(email: string, store: AccountStore): Promise<void> {
  await store.save(email);
}

describe('registering an account', () => {
  it('registering a valid email creates an account', async () => {
    // GIVEN an empty account store
    const store = new FakeAccountStore();

    // WHEN a valid email is registered through the port
    await register('ada@example.com', store);

    // THEN an account exists for that email
    expect(await store.exists('ada@example.com')).toBe(true);
  });
});
