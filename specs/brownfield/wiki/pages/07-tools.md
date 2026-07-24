# `tools/` — 7 module(s)

7 module(s).

## Dependencies

```mermaid
flowchart LR
  n_js_tools_check_partition_js["check-partition.js"]
  n_js_tools_check_partition_test_js["check-partition.test.js"]
  n_js_tools_pack_install_smoke_test_js["pack-install-smoke.test.js"]
  n_js_tools_pack_install_js["pack-install.js"]
  n_js_tools_pack_install_test_js["pack-install.test.js"]
  n_js_tools_partition_report_js["partition-report.js"]
  n_js_tools_partition_report_test_js["partition-report.test.js"]
  n_js_tools_check_partition_js -->|imports| n_js_tools_partition_report_js
  n_js_tools_check_partition_test_js -->|imports| n_js_tools_check_partition_js
  n_js_tools_pack_install_smoke_test_js -->|imports| n_js_tools_pack_install_js
  n_js_tools_pack_install_test_js -->|imports| n_js_tools_pack_install_js
  n_js_tools_partition_report_test_js -->|imports| n_js_tools_partition_report_js
```

## `js:tools/check-partition.js`

- fan-in: 1, fan-out: 3

### Symbols
  - `escapeRe` (function) → js:tools/check-partition.js:29 — `escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`
  - `scriptPattern` (function) → js:tools/check-partition.js:48 — `function scriptPattern(name, fromKind)`
  - `libPattern` (function) → js:tools/check-partition.js:56 — `function libPattern(name, fromKind)`
  - `skillPattern` (function) → js:tools/check-partition.js:64 — `function skillPattern(name)`
  - `agentPattern` (function) → js:tools/check-partition.js:70 — `function agentPattern(name)`
  - `hardRefPattern` (function) → js:tools/check-partition.js:75 — `function hardRefPattern(kind, name, fromKind)`
  - `specName` (function) → js:tools/check-partition.js:105 — `specName = (spec) => String(spec).replace(/\.js$/, '').split('/').pop()`
  - `tryBlockSpans` (function) → js:tools/check-partition.js:108 — `function tryBlockSpans(text)`
  - `optionalRefs` (function) → js:tools/check-partition.js:124 — `function optionalRefs(text)`
  - `hardRefs` (function) → js:tools/check-partition.js:133 — `function hardRefs(text, names, optional = new Set(), fromKind = null)`
  - `guardedEdges` (function) → js:tools/check-partition.js:147 — `function guardedEdges(from, optionalNames, ids, assign)`
  - `partitionAccepted` (function) → js:tools/check-partition.js:162 — `function partitionAccepted(accepted)`
  - `recordEdge` (function) → js:tools/check-partition.js:178 — `function recordEdge(from, to, home, target, acceptedMap, sink)`
  - `checkPartition` (function) → js:tools/check-partition.js:186 — `function checkPartition({ assign, texts, names, accepted = [] })`
  - `walk` (function) → js:tools/check-partition.js:214 — `function walk(dir, acc = [])`
  - `readUnit` (function) → js:tools/check-partition.js:225 — `readUnit = (files) => files.map((f) =>`
  - `loadAssignment` (function) → js:tools/check-partition.js:229 — `function loadAssignment(partition)`
  - `loadUnitTexts` (function) → js:tools/check-partition.js:240 — `function loadUnitTexts()`
  - `main` (function) → js:tools/check-partition.js:257 — `function main()`

## `js:tools/check-partition.test.js`

- fan-in: 0, fan-out: 3

### Symbols
  _(no extracted symbols)_

## `js:tools/pack-install-smoke.test.js`

- fan-in: 0, fan-out: 7

### Symbols
  - `kernelOnly` (function) → js:tools/pack-install-smoke.test.js:26 — `function kernelOnly()`
  - `coreProfile` (function) → js:tools/pack-install-smoke.test.js:38 — `function coreProfile()`
  - `node` (function) → js:tools/pack-install-smoke.test.js:47 — `node = (args, opts = {}) => spawnSync('node', args, { encoding: 'utf8', timeout: 60000, ...opts })`
  - `brownfieldProfile` (function) → js:tools/pack-install-smoke.test.js:76 — `function brownfieldProfile()`

## `js:tools/pack-install.js`

- fan-in: 2, fan-out: 2

### Symbols
  - `loadPartition` (function) → js:tools/pack-install.js:60 — `function loadPartition(file = PARTITION)`
  - `mergeSpec` (function) → js:tools/pack-install.js:64 — `function mergeSpec(into, spec)`
  - `resolveSelection` (function) → js:tools/pack-install.js:75 — `function resolveSelection(partition, packs = [])`
  - `filesFor` (function) → js:tools/pack-install.js:89 — `function filesFor(selection)`
  - `copyRecursive` (function) → js:tools/pack-install.js:100 — `function copyRecursive(from, to)`
  - `materialize` (function) → js:tools/pack-install.js:111 — `function materialize(outDir, rels)`
  - `declaredNames` (function) → js:tools/pack-install.js:124 — `function declaredNames(partition)`
  - `undeclaredUnits` (function) → js:tools/pack-install.js:141 — `function undeclaredUnits(partition, root = ROOT)`
  - `argValue` (function) → js:tools/pack-install.js:156 — `function argValue(argv, flag)`
  - `listPacks` (function) → js:tools/pack-install.js:161 — `function listPacks(partition)`
  - `main` (function) → js:tools/pack-install.js:170 — `function main(argv = process.argv.slice(2))`

## `js:tools/pack-install.test.js`

- fan-in: 0, fan-out: 3

### Symbols
  _(no extracted symbols)_

## `js:tools/partition-report.js`

- fan-in: 2, fan-out: 0

### Symbols
  - `installs` (function) → js:tools/partition-report.js:13 — `function installs(profile, pack)`
  - `computeProfileBreaks` (function) → js:tools/partition-report.js:20 — `function computeProfileBreaks(crossPack, profiles)`
  - `reportCrossPack` (function) → js:tools/partition-report.js:32 — `function reportCrossPack(crossPack)`
  - `reportProfileBreaks` (function) → js:tools/partition-report.js:46 — `function reportProfileBreaks(breaks)`
  - `reportViolations` (function) → js:tools/partition-report.js:55 — `function reportViolations(violations)`
  - `printReport` (function) → js:tools/partition-report.js:72 — `function printReport({ partition, assign, result })`

## `js:tools/partition-report.test.js`

- fan-in: 0, fan-out: 3

### Symbols
  _(no extracted symbols)_
