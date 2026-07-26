# Zero-trust authority operations

The harness treats repository content as untrusted during an agent run. A task
envelope limits work, but it does not grant external authority. Merge, deploy,
and branch-protection commands require a short-lived Ed25519 capability bound
to the exact task-envelope hash.

## Root of trust

Provision `.claude/trust/issuers.json` before the agent starts. Each issuer has
an explicit receipt role:

```json
{
  "schema_version": 1,
  "issuers": [{
    "issuer": "engineering-approval-service",
    "key_id": "2026-07",
    "public_key_pem": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n",
  "allowed_types": ["human_approval", "capability", "human_execution", "runtime_attestation"]
  }]
}
```

Never place the corresponding private key in the repository, agent container,
environment, secret mount, shell history, or Claude context. In production, an
approval service should read the task envelope, authenticate the human, apply
policy, sign the receipt, and inject it into `.claude/authority/`.

The bundled `authority-receipt.js` command implements the wire protocol for
local operator testing. Its `--private-key` must point outside the agent's
filesystem boundary.

## Approval and capability flow

1. Create and verify the risk and task envelopes.
2. A human reviews the intent, exact task hash, risk tier, scope, and evidence
   requirements.
3. The external service emits one signed `human_approval` receipt per distinct
   approver under `.claude/authority/approvals/`.
4. For a privileged command, the service emits a signed `capability` naming the
   permitted action and approval receipt IDs under
   `.claude/authority/capabilities/`.
5. The pre-Bash gate verifies issuer role, signature, task hash, action, expiry,
   and approval threshold. It atomically consumes the capability before use.
6. `/gate` runs `finalize-task-evidence.js`; PR creation requires its passing,
   task-bound completion receipt.

Capabilities are single-use and expire quickly. A failed command therefore
needs a newly authorized capability. `execute_production_change` is deliberately
non-delegable: a human executes it and the service emits a signed
`human_execution` receipt with an external audit reference.

## Runtime boundary

Hooks alone are not an operating-system security boundary: an unrestricted
shell process can attempt indirect writes that command parsing cannot see.
Unattended execution must mount the following paths read-only:

- `.claude/hooks`
- `.claude/settings.json`
- `.claude/settings.auto.json`
- `.claude/trust`
- `.claude/authority`
- `.claude/certification`

The isolation controller writes `.claude/state/isolation-evidence.json` with
`policy_files_read_only: true` and `authority_receipts_read_only: true`.
`unattended-preflight.js` fails closed without both attestations. Egress remains
deny-by-default and signing credentials must never enter the agent boundary.

The controller must also sign a short-lived `runtime_attestation` receipt under
`.claude/authority/runtime/`. The receipt binds the current task and the exact
hash of `.claude/unattended-policy.json`, and confirms network enforcement,
credential brokering, and the read-only paths. Changing policy invalidates the
runtime proof immediately.

Credentialed work is never executed inside the agent process. The policy maps a
credential identifier to explicitly permitted executables. The agent submits a
single-use-authorized request with `credential-request.js`; an external broker
executes it under a separate identity and returns ordinary evidence. Requests
contain the credential identifier but never its value.

## Adversarial certification

Before constructing an unattended read-only runtime boundary, generate and
verify the deterministic security certification:

```bash
npm run security-certification -- run --profile unattended-core
npm run security-certification -- verify --profile unattended-core
```

The `unattended-core` profile exercises 14 attacks covering prompt-driven
control weakening, opaque and encoded shells, nested interpreter writes,
unapproved egress, direct broker bypass, dependency installation, malicious
build-script egress, symlink escape, forged and expired authority receipts,
wrong-task receipts, replay, autonomy-policy weakening, and autonomy-state
forgery.

The result is written to
`.claude/certification/security-boundary.json`. It expires after 24 hours and
binds the exact unattended policy and enforcement-source hashes. Verification
also reruns the attack probes, so a copied but stale result does not satisfy
preflight. The certification directory is read-only inside the runtime.

## Progressive autonomy

Autonomy begins in `attended` mode and may advance only one level at a time:

```text
attended → supervised → unattended
```

`npm run autonomy-policy -- recommend --risk R1` evaluates current,
live-recomputed matched productivity evidence. Applying the recommendation
requires a signed, single-use capability whose action names the exact target,
for example `promote_autonomy:R1:supervised`.

```bash
npm run autonomy-policy -- apply --risk R1
```

Risk ceilings are fail-closed: R0/R1 may reach unattended, R2/R3 stop at
supervised, and R4 remains attended. Configuration or productivity-evidence
drift regresses the affected tier one level. Expired or invalid adversarial
security certification regresses unattended tiers to supervised. Promotions
need external authority; regressions toward safety do not.

Unattended preflight requires the current task's resolved autonomy mode to be
`unattended`. Both the autonomy configuration and integrity-chained state are
read-only inside the agent runtime.

## Task lifecycle and recovery

New task envelopes are versioned and expire after eight hours by default.
Creation enters `created`; execution requires an explicit transition to
`active`. Scope or expiry changes require a signed `amend_task` capability and
produce a new envelope version linked to the previous hash. Passing task
evidence permits `completed`; `completed` and `aborted` are terminal execution
states. Rotation archives the prior envelope before creating another task.

At each clean iteration boundary, `checkpoint-state.js create` atomically
records git state, progress/features, task/lifecycle state, budget origin,
current group, and exact next action. `checkpoint-state.js resume` returns a
deterministic state: exact resume, partial-iteration repair, post-checkpoint
divergence, budget stop, or a fail-closed contract/checkpoint error.

## Service integration

An external broker only needs to produce JSON matching
`.claude/templates/authority-receipt.schema.json`. Replace the local issuer CLI
with a GitHub App, CI environment approval, cloud KMS signer, or internal policy
service without changing the hook or evidence-finalization consumers.
