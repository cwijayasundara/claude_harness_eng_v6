# Generated SKU packages

Do not hand-edit trees under `dist/skus/` or `packages/harness-*`.

```bash
# from repo root
npm run package:skus     # core + lite + full → dist/skus/
npm run package:core
npm run package:lite
```

Load:

```bash
claude --plugin-dir "$(pwd)/dist/skus/harness-core"
```

See [docs/product-skus-and-tiers.md](../docs/product-skus-and-tiers.md).
