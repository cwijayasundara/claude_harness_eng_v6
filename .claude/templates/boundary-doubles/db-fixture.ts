/**
 * Transactional-isolation DB fixture (boundary-test-doubles kit, gap G34). TypeScript
 * sibling of db_fixture.py. Keeps a REAL engine (honoring test-strategy.md's real-DB rule)
 * but wraps each test in a transaction rolled back at teardown — fast and deterministic.
 *
 * ORM-specific: adapt the transaction wrapper to the project's stack. The Prisma shape
 * below is the common case; a raw-pg / Drizzle equivalent (BEGIN; … ROLLBACK) is the same
 * idea. An in-memory / disposable DB is the approved fast path when TEST_DATABASE_URL is
 * unset. Register `dbSession` as a per-test fixture (e.g. vitest `test.extend`).
 */

export type SeedFn<Tx> = (tx: Tx) => Promise<void> | void;

/**
 * Run `body` inside a transaction that is always rolled back, after `seed` prepares
 * deterministic state. Prisma example — swap `prisma.$transaction` for the project's ORM.
 *
 *   await withRolledBackTransaction(prisma, seed, async (tx) => { ...assertions... });
 */
export async function withRolledBackTransaction<Client, Tx>(
  client: { $transaction: (fn: (tx: Tx) => Promise<void>) => Promise<void> } & Client,
  seed: SeedFn<Tx>,
  body: (tx: Tx) => Promise<void>,
): Promise<void> {
  const rollback = Symbol('rollback');
  try {
    await client.$transaction(async (tx: Tx) => {
      await seed(tx);
      await body(tx);
      throw rollback; // force Prisma to roll the interactive transaction back
    });
  } catch (err) {
    if (err !== rollback) throw err;
  }
}
