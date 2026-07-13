# `test/fixtures/code-index/sample/src/` — 2 module(s)

2 module(s).

## Dependencies

```mermaid
flowchart LR
  n_js_test_fixtures_code_index_sample_src_App_jsx["App.jsx"]
  n_js_test_fixtures_code_index_sample_src_Users_jsx["Users.jsx"]
  n_js_test_fixtures_code_index_sample_src_App_jsx -->|imports| n_js_test_fixtures_code_index_sample_src_Users_jsx
  n_js_test_fixtures_code_index_sample_src_App_jsx -->|renders| n_js_test_fixtures_code_index_sample_src_Users_jsx
```

## `js:test/fixtures/code-index/sample/src/App.jsx`

- fan-in: 0, fan-out: 6

### Symbols
  - `App` (component) → js:test/fixtures/code-index/sample/src/App.jsx:6 — `function App()`
  - `Toolbar` (component) → js:test/fixtures/code-index/sample/src/App.jsx:18 — `function Toolbar()`

## `js:test/fixtures/code-index/sample/src/Users.jsx`

- fan-in: 2, fan-out: 0

### Symbols
  - `Users` (component) → js:test/fixtures/code-index/sample/src/Users.jsx:1 — `function Users({ total })`
