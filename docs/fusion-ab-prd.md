# PRD: Personal Finance Ledger

A single-user, local double-entry finance ledger — accounts, categorized
transactions, budgets, and reports. Deliberately **larger** than the bookmarks
smoke: it decomposes into a foundation cluster (data model + persistence), a
domain-rules cluster (double-entry invariants), an API cluster (CRUD), a
reporting cluster (aggregations), a budgets cluster, and a UI cluster — with
real cross-cluster dependencies, so the build fans out into many teammate
stories. This is the fixture for the Fusion balanced-vs-fusion A/B
(`docs/fusion-ab-runbook.md`); both arms build it, only the model-tier preset
differs.

## 1. Problem & Goal
One person wants to track where their money goes across several accounts,
categorize spending, set monthly budgets, and see clear reports — from one small
local app, no signup, no cloud. Success: record a month of transactions and see,
at a glance, balances per account and spend vs. budget per category.

## 2. Users & Jobs-to-be-done
One local user ("me") who wants to (a) keep several accounts (checking, savings,
credit), (b) record categorized transactions that move money, (c) set a monthly
budget per category, (d) see balances and spend reports, and (e) be warned when a
category is over budget.

## 3. Functional Requirements

### Foundation (data model + persistence)
- **FR-1** Persist **accounts** (id, name, type ∈ {checking, savings, credit}, opening_balance, created_at) in a local store.
- **FR-2** Persist **categories** (id, name, monthly_budget ≥ 0, created_at) in the local store.
- **FR-3** Persist **transactions** (id, date, amount, from_account, to_account, category, note, created_at) in the local store.
- **FR-4** All three stores survive a process restart (durable to disk) and load on startup.

### Domain rules
- **FR-5** Every transaction moves money between two distinct accounts (`from_account` ≠ `to_account`); a transaction touching one account is rejected.
- **FR-6** `amount` must be a positive number; zero or negative amounts are rejected.
- **FR-7** A transaction's `category` must reference an existing category id; unknown categories are rejected.
- **FR-8** An account's **balance** = opening_balance − Σ(amount where from_account = it) + Σ(amount where to_account = it), computed deterministically from the transaction log.

### API (CRUD over HTTP)
- **FR-9** Create / list / delete **accounts** via HTTP endpoints.
- **FR-10** Create / list / delete **categories** via HTTP endpoints.
- **FR-11** Create / list / delete **transactions** via HTTP endpoints, list newest-first.
- **FR-12** Filter listed transactions by `category` and by `account` (either side) via query params.
- **FR-13** Reject malformed input (missing required field, wrong type, unknown reference, invariant violation) with HTTP 400 and a JSON error body naming the offending field.

### Reporting (aggregations, depend on domain + persistence)
- **FR-14** `GET /reports/balances` returns the current balance for every account (FR-8).
- **FR-15** `GET /reports/spend?month=YYYY-MM` returns total spend per category for that month (spend = transactions whose `to_account` is a credit account or whose category is set, summed by category).
- **FR-16** `GET /reports/summary?month=YYYY-MM` returns, per category: budget, actual spend, remaining (budget − spend), and an `over_budget` boolean.

### Budgets
- **FR-17** Set / update a category's `monthly_budget` via the API.
- **FR-18** The summary report (FR-16) flags any category whose month spend exceeds its budget with `over_budget: true`.

### UI
- **FR-19** A single local web page showing: account balances, a transaction-entry form, the recent transaction list, and the current-month budget summary.
- **FR-20** Submitting the transaction form adds it and refreshes balances + summary without a full manual reload.

## 4. Non-Functional Requirements
- **NFR-1** No external runtime dependencies — standard library only (Node stdlib or Python stdlib).
- **NFR-2** `GET /reports/*` returns in under 200 ms for up to 5,000 transactions.
- **NFR-3** All rejections use HTTP 400 with a JSON body `{ "error": "<message>", "field": "<name>" }`.
- **NFR-4** Money amounts are handled without floating-point drift (integer minor units, e.g. cents).
- **NFR-5** The transaction log is the source of truth; balances and reports are always derived, never stored denormalized.

## 5. Out of Scope
- Authentication or multi-user accounts.
- Cloud sync, sharing, or multi-device.
- Editing a transaction after creation (delete + re-add only).
- Recurring transactions, currencies other than one, tax handling.
- Import from banks or other apps.

## 6. Acceptance / Done
- **FR-1..4** → After adding accounts, categories, and transactions then restarting the process, all three lists reload intact from disk.
- **FR-5** → POST a transaction with `from_account == to_account` returns 400 naming `to_account`.
- **FR-6** → POST a transaction with `amount <= 0` returns 400 naming `amount`.
- **FR-7** → POST a transaction with an unknown `category` returns 400 naming `category`.
- **FR-8** → After a sequence of transactions, `GET /reports/balances` matches the hand-computed balance for each account.
- **FR-9..11** → Each entity supports create (201 + stored record with id), list, and delete (204, then absent from list).
- **FR-12** → Listing filtered by `category` (or `account`) returns only matching transactions.
- **FR-13/NFR-3** → Every rejection returns 400 with `{error, field}` naming the offending field.
- **FR-14** → Balances report equals FR-8 for all accounts.
- **FR-15** → Month spend groups transactions correctly by category for the requested month only.
- **FR-16/FR-18** → Summary returns budget, spend, remaining, and `over_budget` per category; a category spent past its budget shows `over_budget: true`.
- **FR-17** → Updating a category budget changes the next summary's `remaining` and `over_budget`.
- **FR-19/20** → The page renders balances, list, and summary; submitting the form adds a transaction and updates balances + summary without a manual reload.
- **NFR-4** → Amounts round-trip exactly (no floating-point drift) across store, API, and reports.
