# Post-deploy E2E — authoring rules

The build-loop E2E suite owns the environment: it starts the stack, seeds
fixtures, and resets between runs. A post-deploy suite owns none of that. It
attaches to a shared environment that already holds other people's data, cannot
reset a database, and runs while other things are happening.

Every rule below follows from that one difference. A test written for the build
loop and pointed at a deployed environment does not fail honestly — it goes
flaky, which is worse, because a flaky suite gets ignored and then the
automation you built to replace manual testing is not trusted either.

---

## 1. Provision your own data; never assume it

**Wrong** — depends on a fixture that exists only in the seeded local DB:

```ts
await page.goto('/orders/1001');
await expect(page.getByText('Acme Corp')).toBeVisible();
```

**Right** — creates what it needs, so it runs anywhere, repeatedly, in parallel:

```ts
const order = await api.createOrder({ customer: `acme-${runId()}` });
await page.goto(`/orders/${order.id}`);
await expect(page.getByText(order.customer)).toBeVisible();
```

Set up through the **API**, not the UI, wherever the API is not itself the thing
under test. UI setup is slow and turns an unrelated regression into a cascade of
failures in tests that were not testing that screen.

## 2. Namespace everything you create

Two runs of the same suite must not collide, and neither must a run and a human
clicking around the same environment. Give every created record a unique,
recognisable marker:

```ts
const runId = () => `e2e-${process.env.E2E_RUN_ID ?? 'local'}-${crypto.randomUUID().slice(0, 8)}`;
```

Prefixing with `e2e-` is what makes a cleanup sweep possible and lets a human
looking at the environment tell synthetic data from real.

## 3. Clean up, and do not depend on cleanup having worked

Delete what you created in an `afterEach`/`afterAll`, but never write a test
that assumes a previous run's cleanup succeeded — CI gets cancelled, networks
drop. Idempotence is what makes the suite safe to re-run, which is the property
that lets you actually use it.

Pair this with a scheduled sweep that removes `e2e-`-prefixed records older than
a day. Cleanup inside the run is best-effort; the sweep is the guarantee.

## 4. Assert on user-visible state, not on timing

A deployed environment has real latency, cold starts, queues and eventual
consistency. `waitForTimeout` is a defect: it is simultaneously too short (flaky)
and too long (slow).

```ts
// Wrong
await page.waitForTimeout(3000);
// Right — waits for the actual condition, up to the configured expect timeout
await expect(page.getByRole('status')).toHaveText(/processed/i);
```

For genuinely asynchronous work (a job queue, a webhook), poll the observable
outcome with `expect.poll` and a timeout sized to that pipeline, rather than
raising the global timeout for everyone.

## 5. Tag every test

| Tag | Meaning |
|---|---|
| `@smoke` | Must pass for the deploy to be considered good. Keep it small and fast — the critical path only. |
| `@needs-fixture` | Genuinely cannot run without fixture control (seeded edge-case data, clock manipulation, forced third-party failure). **Excluded** from the deployed suite; stays in the build-loop suite. |
| `@serial` | Touches shared singleton state. Wrap in `test.describe.serial()`. |
| `@destructive` | Mutates data other tests might read. Must namespace and clean up; never point these at an environment you cannot afford to dirty. |

`@needs-fixture` is the honest escape hatch. Use it rather than weakening an
assertion so a test technically passes against a deployed target — but every use
is coverage the post-deploy suite does not have, so `/test --deployed` reports
the count. If it is large, the gap is usually a missing test API, not a law of
nature.

## 6. Never fall back to localhost

If `E2E_BASE_URL` is unset, **fail**. A suite that silently defaults to
`http://localhost:3000` reports a green run against nothing. The deployed config
throws on a missing target, and `e2e-target-guard.js --require-deployed` refuses
loopback addresses before the browsers are even installed.

## 7. Third parties are real here

There are no boundary doubles in a deployed environment (the G34 kit is
build-loop only). Payments, email, and external APIs are live sandboxes with
their own rate limits and latency. Prefer provider sandbox modes and test
accounts, assert on your own system's recorded outcome rather than the
provider's UI, and tag anything that cannot be made repeatable `@needs-fixture`.

---

## Traceability

Each generated spec records its `matrix_id` in
`specs/test_artefacts/e2e-deployed-traces.json`, the same contract the build-loop
E2E suite uses. That is what lets `/test --deployed` report which acceptance
criteria are actually covered post-deploy versus only covered locally — the
number that tells you how much of your manual regression pass you can retire.
