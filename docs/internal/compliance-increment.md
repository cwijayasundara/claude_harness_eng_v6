# Compliance re-platforming — scoped increment

Separate from the v6 reduction. This touches a **live customer commitment**, so it is
scoped, sequenced and reviewed on its own rather than folded into Phase 3.

Status: **C1, C2, C3, C4 all implemented.** Remaining: land signing (C2), bind the customer catalog (C3), retire the imperative apply paths (C4) — each an operational or customer-input decision, not code.
independently of everything else here.

## Position

The four CISO control objectives are legitimate and industry-standard. Nothing in this
document argues for weakening them. What it argues is that ~60% of the *implementation*
re-invents formats that now have real standards — and that for a customer-facing
compliance deliverable, the standard formats are worth strictly more than bespoke ones,
while being less code to maintain.

| Objective | Standing |
|---|---|
| Rotate/scrub credentials | Sound. Out of scope here (ops runbook). |
| gitleaks + SAST as PR gates | Sound, correctly implemented. Keep. |
| Branch protection / CODEOWNERS / deploy approval | Right objective; provisioning re-invents Terraform. |
| Portfolio SDLC attestation | Right objective; format is bespoke and the integrity claim is overstated. |

## C1 — Correct the tamper-evidence claim (do this first, independently)

**Severity: material. This is a correctness fix, not a refactor.**

`canonical-json.js#contentHash` computes sha256 over the bundle with its own `integrity`
field removed, stores the result **inside that same file**, and `--verify` recomputes and
compares.

That detects **corruption**. It does not detect **tampering**: anyone who edits the record
recomputes the hash and rewrites the field. There is no key, no signature, no external
anchor.

What actually provides tamper-evidence today is that attestations are committed to git and
branch protection blocks force-push. That is real, but it is git and the ruleset doing the
work — not the checksum.

The skill's `description` frontmatter already states this correctly ("a sha256
**corruption-detecting** integrity checksum"). The overstatement is elsewhere:

- `HARNESS.md` — "durable, tamper-evident evidence bundle"
- `.claude/skills/attestation/SKILL.md` — "`--verify` re-checks the integrity hash for tamper"

**Action:** change both to "corruption-detecting", and state plainly that tamper-evidence
derives from the committed git history plus branch protection until signing lands. An
auditor asking "what stops someone editing this file?" must not get an answer the code
cannot support.

## C2 — Adopt in-toto for the evidence format — **DONE** (envelope), signing outstanding

**Correction to this increment's original framing.** It said "in-toto attestation format
carrying a **SLSA provenance** predicate". That conflated two different claims. SLSA
provenance describes how an **artifact** was built by a trusted builder; this bundle is
control evidence about a **commit**. Borrowing `slsa.dev/provenance` for it would assert
something stronger and different from what we actually verify.

What shipped instead is the part that was right: the **in-toto Statement envelope**, which
exists precisely to carry custom predicates and is what cosign/Sigstore sign.

```json
{
  "_type": "https://in-toto.io/Statement/v1",
  "subject": [{ "name": "git+https://github.com/<org>/<repo>",
                "digest": { "gitCommit": "<sha>" } }],
  "predicateType": "https://claude-harness.dev/attestation/control-evidence/v1",
  "predicate": { ...the existing bundle: control inventory, verify outputs, gate verdict... }
}
```

- The aggregation logic is unchanged — it became the predicate body, as planned.
- The integrity hash still covers the **predicate**, so a stored hash means the same thing
  before and after the change, and pre-C2 attestations stay readable and verifiable
  (`fromInTotoStatement` passes a bare bundle through).
- Because the hash covers only the predicate, the envelope would otherwise be editable
  without detection. `--verify` now cross-checks that the subject's repo and gitCommit
  match the evidence it wraps, so **repo and commit are bound** even against a re-hash.
  That closes part of the C1 gap without signing.
- A foreign `predicateType`, or a statement with no predicate, is **rejected** rather than
  read as empty evidence.

**Still outstanding — the part that makes C1 fully true:** signing. The envelope is now a
shape cosign can sign, but nothing signs it yet. Until then the honest claim remains
corruption-detection plus git history and branch protection, exactly as C1 states. The next
step is a CI step running `cosign attest` (or `actions/attest`) over the Statement, at
which point the "rehashed edit verifies clean" test in `test/attestation.test.js` should
start failing — which is the signal the guarantee genuinely got stronger.

## C3 — Replace `standard-map.json` with OSCAL — **DONE** (emitter), catalog is a 1-file answer

The shipped map had four invented clause ids and an empty `by_id` — it resolved to nothing
an auditor recognises.

`oscal-emit.js` now emits the control inventory as an **OSCAL component-definition**
(`oscal-version 1.1.2`), one `implemented-requirement` per control.

The "which standard?" question turned out **not to block the mechanism**, only the catalog.
OSCAL identifies a control by (source catalog, control-id), so the catalog is a parameter:
`.claude/config/oscal-catalog.json` (`by_id` wins over `by_axis`). The customer's answer —
SOC 2 / ISO 27001 / FedRAMP — becomes a **data file, not a code change**.
`oscal-catalog.example.json` ships with SOC 2 TSC ids as a starting point.

Until a catalog is bound, every control is emitted **UNMAPPED** under an explicit
`urn:harness:unmapped` source — a visible, countable gap rather than the old confident
fiction. Bind the example and the same 132 controls resolve to real SOC 2 criteria.

## C4 — Move provisioning to Terraform, keep fleet discovery — **DONE** (both parts)

**Part 1 — emit (`terraform-emit.js`).** Generates `github_organization_ruleset` /
`github_repository_ruleset` / `github_repository_environment` from the SAME
`project-manifest.json#github` spec the imperative provisioners read, so the two cannot
disagree about intent while both exist. Two safety properties enforced at emit time: an
environment with no reviewer throws (not an approval gate), and an empty `org` throws (a
ruleset that targets nothing). The gitleaks + sast required-check floor is applied here too.

**Part 2 — verify (`terraform-verify.js`).** Drift now comes from
`terraform plan -detailed-exitcode` (0 = match, 2 = drift, 1 = error) instead of the
hand-rolled GET-and-diff in `provision-*.js --verify`. It keeps the SAME output contract
(`{ compliant: boolean, drift: [] }`) that `attestation-io#classifyVerify` and
fleet-retrofit consume, and every non-success path (terraform absent, plan error,
uninitialised dir) is reported `compliant:false` — never a vacuous pass.

**Kept, not replaced:** fleet discovery. Terraform owns the policy; `fleet.json` still owns
which repos exist. Declarative rulesets + scripted enumeration is the recognised hybrid.

**Deliberately staged:** the imperative `provision-*.js` apply paths are NOT retired yet, so
the declarative and imperative routes can be compared on a real fleet before either is
removed. That is the one remaining C4 step, and it is an operational decision, not code.

## Sequence and effect

| | Item | Depends on | Effort |
|---|---|---|---|
| 1 | **C1** wording fix | nothing — do now | ~1 hr |
| 2 | **C3** customer standard question | customer answer | — |
| 3 | **C2** in-toto/SLSA + Sigstore signing | C1 | ~2 days |
| 4 | **C3** OSCAL mapping output | C2 + answer | ~2 days |
| 5 | **C4** Terraform provisioners | independent | ~2 days |

Expected effect: the compliance pack drops from **20 units to roughly 8**, and what remains
is in formats auditors already recognise. This is the case where simplifying *increases*
compliance value rather than trading against it.

## Constraint carried forward

No client names or client-specific literals in code. Everything stays generic and
config-driven, as today.

## References

- [GitHub artifact attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations)
- [actions/attest-build-provenance](https://github.com/actions/attest-build-provenance)
- [SLSA provenance specification](https://slsa.dev/spec/v0.1/provenance)
- [Artifact provenance and attestations: SLSA to in-toto](https://secure-pipelines.com/ci-cd-security/artifact-provenance-attestations-slsa-in-toto/)
- [NIST OSCAL Control Mapping Model](https://pages.nist.gov/OSCAL/learn/concepts/layer/control/mapping/)
- [AWS SOC 1/2 reports in OSCAL, Spring 2026](https://aws.amazon.com/blogs/security/spring-2026-soc-1-and-2-reports-are-now-available-in-oscal-format/)
- [Terraform github_repository_ruleset](https://registry.terraform.io/providers/integrations/github/latest/docs/resources/repository_ruleset)
