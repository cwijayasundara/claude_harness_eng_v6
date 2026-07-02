---
name: context
description: Build a bounded, cited context pack from the living DeepWiki/code-map before broad source reads. Use in brownfield lanes and whenever source orientation could otherwise require large file reads.
argument-hint: "\"question\" [--budget N]"
context: fork
---

# Context Pack

Use `/context` to retrieve exact files and line ranges from the current
DeepWiki/code-map before reading source broadly.

## Command

```bash
node .claude/scripts/context-pack.js "$ARGUMENTS"
```

Optional flags:

```bash
node .claude/scripts/context-pack.js --budget 1600 "$ARGUMENTS"
```

## Reading The Result

The JSON result contains:

- `status`: `ok`, `no_match`, `missing`, or `placeholder`
- `results[]`: cited file paths, line ranges, symbols, reasons, confidence
- `read_next[]`: exact source reads to perform next
- `estimated_tokens`: approximate context-pack size
- `warnings[]`: stale/missing/no-match guidance

## Rules

- Read the `read_next` ranges before reading entire files.
- If status is `placeholder`, use the planned component map until source exists.
- If status is `missing`, run `/code-map` or `/brownfield`.
- If status is `no_match`, use `rg` narrowly, then refresh the code-map if you
  find relevant source that was not indexed.
