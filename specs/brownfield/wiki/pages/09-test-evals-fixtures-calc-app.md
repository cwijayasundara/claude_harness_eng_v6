# `test/evals/fixtures/calc-app/` — 3 module(s)

3 module(s).

## Dependencies

```mermaid
flowchart LR
  n_js_test_evals_fixtures_calc_app_calc_js["calc.js"]
  n_js_test_evals_fixtures_calc_app_calc_test_js["calc.test.js"]
  n_js_test_evals_fixtures_calc_app_dead_code_js["dead-code.js"]
  n_js_test_evals_fixtures_calc_app_calc_test_js -->|imports| n_js_test_evals_fixtures_calc_app_calc_js
```

## `js:test/evals/fixtures/calc-app/calc.js`

- fan-in: 1, fan-out: 0

### Symbols
  - `sum` (function) → js:test/evals/fixtures/calc-app/calc.js:3 — `function sum(numbers)`
  - `average` (function) → js:test/evals/fixtures/calc-app/calc.js:9 — `function average(numbers)`

## `js:test/evals/fixtures/calc-app/calc.test.js`

- fan-in: 0, fan-out: 3

### Symbols
  _(no extracted symbols)_

## `js:test/evals/fixtures/calc-app/dead-code.js`

- fan-in: 0, fan-out: 0

### Symbols
  - `oldSum` (function) → js:test/evals/fixtures/calc-app/dead-code.js:5 — `function oldSum(arr)`
