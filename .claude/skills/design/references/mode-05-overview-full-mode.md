## Overview (full mode)

This is the third gate in the SDLC pipeline. Two agents run concurrently in a single message: a `planner` agent produces system architecture and machine-readable schemas, while the `generator` agent produces self-contained HTML mockups. After both complete, an `evaluator` agent (artifact mode) validates cross-phase traceability, schema correctness, and field-shape consistency between mockups and API contracts.

---
