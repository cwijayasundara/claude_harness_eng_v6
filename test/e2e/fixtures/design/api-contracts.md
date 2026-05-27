# API Contracts (CLI Interface)

| Command | Args | Output | Exit Code |
|---------|------|--------|-----------|
| add | `<text>` | Prints new todo ID | 0 (success), 1 (missing text) |
| list | none | Formatted table | 0 |
| complete | `<id>` | Confirmation message | 0 (success), 1 (invalid id) |
| delete | `<id>` | Confirmation message | 0 (success), 1 (invalid id) |
