# `test/e2e/brownfield-run-output/` — 2 module(s)

2 module(s).

## Dependencies

```mermaid
flowchart LR
  n_js_test_e2e_brownfield_run_output_calc_js["calc.js"]
  n_js_test_e2e_brownfield_run_output_main_js["main.js"]
  n_js_test_e2e_brownfield_run_output_main_js -->|imports| n_js_test_e2e_brownfield_run_output_calc_js
```

## `js:test/e2e/brownfield-run-output/calc.js`

- fan-in: 1, fan-out: 0

### Symbols
  - `add` (function) → js:test/e2e/brownfield-run-output/calc.js:3 — `function add(a, b)`

## `js:test/e2e/brownfield-run-output/main.js`

- fan-in: 0, fan-out: 1

### Symbols
  - `main` (function) → js:test/e2e/brownfield-run-output/main.js:5 — `function main(argv)`
