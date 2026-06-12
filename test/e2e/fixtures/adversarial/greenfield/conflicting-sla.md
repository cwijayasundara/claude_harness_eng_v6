# Adversarial Greenfield Prompt: Conflicting SLA

Build a tenant-facing incident intake service for small healthcare clinics.

The product request is intentionally ambiguous and contains a conflict: users say
the system must acknowledge every incident in under 100 ms, but the compliance
team also requires durable audit logging before any acknowledgement is visible.
The first release cannot use paid external services, cannot store PHI in logs,
and must run on a single low-cost container.

Required output from the harness:
- A BRD that calls out the latency versus audit durability trade-off instead of
  hiding it.
- A spec with acceptance criteria for validation errors, audit events, and
  retry behavior.
- A design with test or verification proof for the acknowledgement path,
  audit persistence, and PHI redaction constraints.
