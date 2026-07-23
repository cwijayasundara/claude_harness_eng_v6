# Compliance re-platforming — scoped increment

Separate from the v6 reduction. This touches a **live customer commitment**, so it is
scoped, sequenced and reviewed on its own rather than folded into Phase 3.

Status: **scoped, not started.** One item (C1) is a correctness fix that should land
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

## C3 — Replace `standard-map.json` with OSCAL

The shipped map contains four invented clause ids (`SDL-secure-development`,
`AUD-audit-traceability`, `ARC-architecture-integrity`, `MNT-maintainability`) and an empty
`by_id: {}`. The abstraction is right; the target is not real — it maps to nothing an
auditor recognises.

NIST **OSCAL** now does this job, and the timing is the point:

- OSCAL **v1.2.1 Control Mapping Model** shipped March 2026 — machine-readable, computable
  mappings between frameworks, turning multi-framework compliance from O(N²) to O(N).
- **AWS** began publishing SOC 1/2 reports in OSCAL in Spring 2026 (first major cloud provider).
- **FedRAMP** requires machine-readable authorization data by **30 September 2026**.

**Blocking question for the customer:** which evidence standard are their auditors on
(SOC 2 / ISO 27001 / FedRAMP)? That answer decides whether OSCAL is a nice-to-have or a
near-term requirement, and it is the one input this increment cannot supply itself.

## C4 — Move provisioning to Terraform, keep fleet discovery

`provision-protection.js` (279 lines) and `provision-environments.js` (291 lines) hand-roll
what `github_organization_ruleset` / `github_repository_ruleset` do declaratively — including
drift detection, which `terraform plan` provides natively and which our `--verify` modes
re-implement by hand.

**But `fleet-retrofit.js` + `fleet.json` is not re-invention.** The recognised pattern is
exactly this hybrid: Terraform for ruleset definitions, plus scripts and scheduled workflows
for dynamic repository discovery and metadata. Keep that half unchanged.

**Action:** ruleset/environment definitions move to Terraform; `--verify` becomes a thin
drift reporter over `terraform plan`; fleet discovery stays as-is.

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
