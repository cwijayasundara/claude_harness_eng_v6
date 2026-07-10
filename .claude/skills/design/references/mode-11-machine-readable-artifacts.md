## Machine-Readable Artifacts

| Artifact | Purpose |
|----------|---------|
| `api-contracts.schema.json` | OpenAPI 3.0 schema — machine-readable by the evaluator for contract testing |
| `data-models.schema.json` | JSON Schema — used by builder agents to generate type-safe code |
| `component-map.md` | Maps stories to implementation files — used by builder agents for routing |

The `.schema.json` files enable automated validation in later pipeline stages (the evaluator validates contracts and shapes against them).

---
