# Test Design Reference — Deriving Comprehensive Cases

This is the *method* for turning an acceptance criterion (AC) or a schema constraint into a **complete** set of positive, negative, and boundary test cases — not a vague "cover edge cases," but a repeatable derivation an agent applies every time.

`test-strategy.md` gives the layer model (unit / integration / E2E) and a short boundary checklist. This file is the technique that fills that checklist out. Read both. The deterministic companion is `.claude/scripts/constraints-extract.js`, which mines schema constraints into machine-checkable obligations (see "Constraint obligations" below).

The discipline in one line: **for every input field and every state, ask what classes of value exist, then test one representative of each class plus both sides of every boundary.**

---

## 1. Equivalence Partitioning

Partition each input's domain into classes where every value in a class is handled the same way. Test **one representative per class** — testing a second value from the same class adds no information.

For a `quantity` field on an order (integer, 1–99):

| Partition | Class | Representative | Expect |
|-----------|-------|----------------|--------|
| Below range | invalid | `0`, `-5` | rejection (422) |
| In range | valid | `7` | acceptance |
| Above range | invalid | `100` | rejection (422) |
| Wrong type | invalid | `"five"`, `3.5` | rejection (422) |
| Missing | invalid (if required) | absent | rejection (422) |

Five tests, not fifty. The rule: **one test per equivalence class, then add boundary tests (§2) where classes meet.**

For free-text / structured strings (email, URL, slug), partition by *kind* of malformation, not by individual bad string: `missing-@`, `empty`, `over-max-length`, `disallowed-characters`, `leading/trailing-whitespace`. One representative each.

---

## 2. Boundary-Value Analysis

Bugs cluster at the edges of partitions — off-by-one, `>` vs `>=`, inclusive vs exclusive. For every numeric, length, or date constraint with bound `N`, test **three points**: `N-1`, `N`, `N+1`. The boundary value itself (`N`) is the one most likely to be wrong.

Drive these with a parametrized table so the boundary set is visible and exhaustive — do not write five near-identical test functions.

**Python (pytest):**
```python
import pytest

# username: minLength 3, maxLength 20
@pytest.mark.parametrize("length,valid", [
    (2,  False),   # below min — reject
    (3,  True),    # at min — accept (boundary)
    (4,  True),    # just inside
    (20, True),    # at max — accept (boundary)
    (21, False),   # above max — reject
])
def test_username_length_boundaries(client, length, valid):
    resp = client.post("/users", json={"username": "u" * length, "email": "a@ex.com"})
    assert (resp.status_code == 201) == valid
```

**TypeScript (vitest):**
```ts
// amount: minimum 0.01, maximum 100000 (inclusive)
describe.each([
  [0.00,     false],  // below min — reject
  [0.01,     true],   // at min — accept (boundary)
  [100000,   true],   // at max — accept (boundary)
  [100000.01, false], // above max — reject
])('amount boundary %f', (amount, valid) => {
  it(`is ${valid ? 'accepted' : 'rejected'}`, async () => {
    const res = await postOrder({ amount });
    expect(res.ok).toBe(valid);
  });
});
```

Distinguish **inclusive** (`maximum`) from **exclusive** (`exclusiveMaximum`) bounds — the accept/reject flip moves by one. For dates, the boundaries are "just before / exactly at / just after" the cutoff (expiry, scheduling windows).

---

## 3. State-Transition Testing

Stateful entities (an order moving `pending → confirmed → shipped → delivered`, a user `invited → active → suspended`) have a transition *graph*. Enumerate it from the ACs, then test:

- **Every legal transition** — one test that performs it and asserts the new state.
- **Every illegal transition** — one test that attempts a forbidden move and asserts it is rejected and the state is unchanged.

The illegal transitions are where the real bugs hide — most code tests the happy path forward and never checks that `delivered → pending` is refused.

Build the matrix explicitly: rows = from-state, columns = to-state, each cell legal/illegal. Untested cells are untested behavior. For an N-state machine there are N² cells; test the legal ones and a representative sample of illegal ones (at minimum, every "skip a step" and every "go backward" the ACs forbid).

---

## 4. Error-Path Enumeration

Every documented error is a required test. Do not stop at the happy path. For an HTTP endpoint, walk this checklist and write a test for each status the contract can return:

| Status | Trigger to test |
|--------|-----------------|
| `400` | malformed body / unparseable JSON |
| `401` | missing or invalid credentials |
| `403` | authenticated but not authorized (wrong role / not owner) |
| `404` | referenced resource does not exist |
| `409` | conflict — duplicate unique key, concurrent edit |
| `422` | well-formed but semantically invalid (fails a field constraint) |
| `429` | rate / quota exceeded (if the endpoint is throttled) |
| `5xx` | a documented downstream failure surfaces as a clean error, not a stack trace |

For domain logic, map each typed error class (`OrderNotFoundError`, `InsufficientFundsError`) to a test that provokes it and asserts the error — not just that *an* exception is raised. Assert the error is **actionable**: the right type/status and a message a caller can act on, not a leaked internal.

The `422` rows are largely auto-derivable: see Constraint obligations below.

---

## 5. Adversarial & Malformed Input

Negative tests must include hostile input, not just out-of-range values. For every field that crosses a trust boundary (user input, request body, query param), test that the system **rejects or safely neutralizes**:

- Oversized payloads (a string far past `maxLength`, a deeply nested object).
- Wrong types (array where an object is expected, `null` for a required scalar).
- Injection payloads on string fields (`' OR 1=1 --`, `<script>`, `../../etc/passwd`, `${jndi:...}`).

Construct these from the `buildInvalid*` / `buildMalformed*` factories in `code-gen/references/test-data.md`. These tests pair with the `security-reviewer` gate: the reviewer reasons about the code, these tests prove the runtime behavior.

---

## 6. Concurrency & Idempotency

When an endpoint mutates shared state, single-request tests miss the bugs that only appear under contention.

- **Race conditions** — fire concurrent requests and assert the invariant holds (no double-spend, no duplicate row, exactly one winner).
- **Idempotency** — for retry-safe operations (anything a client may resend after a timeout), repeat the request and assert the state is identical to a single call — not duplicated.

```python
import asyncio

async def test_concurrent_debits_never_overdraw(client, account):  # balance = 100
    results = await asyncio.gather(*[client.post(f"/accounts/{account.id}/debit", json={"amount": 60})
                                     for _ in range(2)])
    assert sum(r.status_code == 200 for r in results) == 1   # exactly one succeeds
    assert get_balance(account.id) == 40                     # invariant held

async def test_create_subscription_is_idempotent(client, idem_key):
    a = await client.post("/subscriptions", json={...}, headers={"Idempotency-Key": idem_key})
    b = await client.post("/subscriptions", json={...}, headers={"Idempotency-Key": idem_key})
    assert a.json()["id"] == b.json()["id"]                  # one subscription, not two
```

---

## 7. Constraint Obligations (deterministic backstop)

Technique catches what an author thinks to test. The schemas already encode constraints the author may forget. `.claude/scripts/constraints-extract.js` reads `specs/design/data-models.schema.json` and `specs/design/api-contracts.schema.json` and emits one **obligation** per constraint keyword (`required`, `minLength`, `maxLength`, `pattern`, `enum`, `minimum`, `maximum`, `format`) to `specs/test_artefacts/constraint-obligations.json`.

Each obligation has a stable `OBL-<field>-<rule>` id and `suggested_cases`. The `/test` skill folds the obligation index into the same `trace-check.js` grounding gate that covers acceptance criteria, so a constraint with no corresponding negative test is a **`dropped` upstream id** and blocks — exactly like an untested AC. A test case covers an obligation by listing its id in `traces`:

```json
{ "id": "TC-12", "text": "username under 3 chars is rejected with 422", "traces": ["E1-S1-AC2", "OBL-User.username-minLength"] }
```

Generate **one representative negative test per obligation** (the equivalence-class rule of §1), using the boundary points of §2 — not one test per value.

---

## 8. Proving the Tests Bite

Steps 1–7 ensure the right tests *exist*. They do not prove the tests would *fail* if the code broke — a test can run a line, trace an obligation, and assert nothing that matters. Close that gap with `.claude/scripts/mutation-smoke.js`: it flips one operator at a time and confirms a test goes red. A **survivor** (a mutation no test killed) is a real coverage gap — fix it by adding the boundary/negative case from §2/§4, never by weakening the gate. See `mutation-smoke.md`. Run it on the files a change touches, after the obligation grounding gate (which is cheaper) passes.

## Derivation Checklist

For each AC, before writing tests:

1. **Inputs** — list every field; partition each (§1); add boundary triples for every bound (§2).
2. **States** — if the AC changes entity state, enumerate legal + illegal transitions (§3).
3. **Errors** — walk the status/error-class checklist; one test each (§4).
4. **Adversarial** — for trust-boundary fields, add malformed/injection cases (§5).
5. **Concurrency** — if the AC mutates shared state, add race + idempotency tests (§6).
6. **Obligations** — ensure every `OBL-` id for the touched entities is covered (§7).

A test plan that cannot point to where each step was applied is incomplete.
