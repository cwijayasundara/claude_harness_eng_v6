# Packed build journal

Completed plans, specs, and internal proposals behind shipped work. Nothing in this directory is read at runtime.

The full texts live in [`historical.tar.gz`](historical.tar.gz) (92 markdown files, ~509 KB). A handful of still-linked paths remain as stubs so existing README / HARNESS / test comments keep resolving.

## Restore one file

```bash
# list members
tar -tzf docs/archive/historical.tar.gz

# extract one member into /tmp
tar -xzf docs/archive/historical.tar.gz -C /tmp internal/HARNESS_ENGINEERING_GAP_ANALYSIS.md
```

Restore the tree in place (overwrites stubs):

```bash
tar -xzf docs/archive/historical.tar.gz -C docs/archive
```

## Still-linked stubs

These GitHub / in-repo links still exist; each stub names the tarball member:

| Stub | Member |
|---|---|
| [`internal/HARNESS_ENGINEERING_GAP_ANALYSIS.md`](internal/HARNESS_ENGINEERING_GAP_ANALYSIS.md) | `internal/HARNESS_ENGINEERING_GAP_ANALYSIS.md` |
| [`internal/SIMPLIFICATION_PROPOSAL.md`](internal/SIMPLIFICATION_PROPOSAL.md) | `internal/SIMPLIFICATION_PROPOSAL.md` |
| [`internal/DEEPWIKI_BROWNFIELD_PROPOSAL_2026-06-21.md`](internal/DEEPWIKI_BROWNFIELD_PROPOSAL_2026-06-21.md) | `internal/DEEPWIKI_BROWNFIELD_PROPOSAL_2026-06-21.md` |
| [`internal/PIPELINE_PROGRESS_PROPOSAL_2026-06-21.md`](internal/PIPELINE_PROGRESS_PROPOSAL_2026-06-21.md) | `internal/PIPELINE_PROGRESS_PROPOSAL_2026-06-21.md` |
| [`superpowers/plans/2026-07-09-devin-parity-hardening.md`](superpowers/plans/2026-07-09-devin-parity-hardening.md) | `superpowers/plans/2026-07-09-devin-parity-hardening.md` |
| [`superpowers/specs/2026-07-05-ubiquitous-language-design.md`](superpowers/specs/2026-07-05-ubiquitous-language-design.md) | `superpowers/specs/2026-07-05-ubiquitous-language-design.md` |
| [`superpowers/specs/2026-07-06-pe-ubiquitous-language-design.md`](superpowers/specs/2026-07-06-pe-ubiquitous-language-design.md) | `superpowers/specs/2026-07-06-pe-ubiquitous-language-design.md` |
| [`superpowers/specs/2026-08-17-story-bundle-design.md`](superpowers/specs/2026-08-17-story-bundle-design.md) | `superpowers/specs/2026-08-17-story-bundle-design.md` |
| [`superpowers/specs/2026-07-04-sprint-delta-lane-design.md`](superpowers/specs/2026-07-04-sprint-delta-lane-design.md) | `superpowers/specs/2026-07-04-sprint-delta-lane-design.md` |
| [`superpowers/specs/2026-07-06-expert-generalist-scaffold-composition-design.md`](superpowers/specs/2026-07-06-expert-generalist-scaffold-composition-design.md) | `superpowers/specs/2026-07-06-expert-generalist-scaffold-composition-design.md` |

## Index

### internal/

- `internal/AUTONOMOUS_ENGINEER_PROPOSAL_2026-06-20.md`
- `internal/BROWNFIELD_V2_PROPOSAL.md`
- `internal/DEEPWIKI_BROWNFIELD_PROPOSAL_2026-06-21.md`
- `internal/HARNESS_ENGINEERING_GAP_ANALYSIS.md`
- `internal/HARNESS_SIMPLIFICATION_2026-07-17.md`
- `internal/PIPELINE_PROGRESS_PROPOSAL_2026-06-21.md`
- `internal/SIMPLIFICATION_2026-07-23.md`
- `internal/SIMPLIFICATION_PROPOSAL.md`
- `internal/TESTING_AGENT_PROPOSAL.md`

### superpowers/plans/

- `superpowers/plans/2026-06-22-build-chain-session-chaining.md`
- `superpowers/plans/2026-06-25-feature-brownfield-change-route.md`
- `superpowers/plans/2026-06-26-per-cluster-stacked-prs.md`
- `superpowers/plans/2026-06-27-autonomous-brownfield-lane.md`
- `superpowers/plans/2026-06-27-brownfield-tracker-routing.md`
- `superpowers/plans/2026-06-27-symphony-workspace-security.md`
- `superpowers/plans/2026-06-28-concurrency-cap-enforcement.md`
- `superpowers/plans/2026-06-28-g10-topology-templates.md`
- `superpowers/plans/2026-06-28-g11-harness-coverage.md`
- `superpowers/plans/2026-06-28-g12-approved-fixtures.md`
- `superpowers/plans/2026-06-28-g12-contract-drift-gate.md`
- `superpowers/plans/2026-06-28-g12-default-a11y.md`
- `superpowers/plans/2026-06-28-g12-flake-detection.md`
- `superpowers/plans/2026-06-28-g9-app-observability-baseline.md`
- `superpowers/plans/2026-06-28-g9-runtime-slo-sensor.md`
- `superpowers/plans/2026-06-28-in-session-auto-merge.md`
- `superpowers/plans/2026-06-28-publish-to-jira.md`
- `superpowers/plans/2026-07-01-harness-hardening-followups.md`
- `superpowers/plans/2026-07-01-verification-matrix-gate.md`
- `superpowers/plans/2026-07-02-ci-e2e-and-ownership.md`
- `superpowers/plans/2026-07-02-docs-polish.md`
- `superpowers/plans/2026-07-02-interview-grounding.md`
- `superpowers/plans/2026-07-02-matrix-precommit-backstop.md`
- `superpowers/plans/2026-07-02-pr-respond.md`
- `superpowers/plans/2026-07-04-sprint-delta-lane-plan.md`
- `superpowers/plans/2026-07-05-pe-ic-memo-implementation.md`
- `superpowers/plans/2026-07-05-ubiquitous-language-implementation.md`
- `superpowers/plans/2026-07-06-pe-ubiquitous-language-implementation.md`
- `superpowers/plans/2026-07-06-tech-stack-specialty-pack-implementation.md`
- `superpowers/plans/2026-07-06-unified-scaffold-composition-implementation.md`
- `superpowers/plans/2026-07-06-vertical-glossary-registry-implementation.md`
- `superpowers/plans/2026-07-07-python-react-specialty-pack-implementation.md`
- `superpowers/plans/2026-07-08-sprint-dedup-precheck.md`
- `superpowers/plans/2026-07-09-devin-parity-hardening.md`
- `superpowers/plans/2026-07-12-bun-adversarial-phase-a.md`
- `superpowers/plans/2026-07-14-sensors-cli-parity.md`
- `superpowers/plans/2026-07-16-boundary-test-doubles.md`
- `superpowers/plans/2026-07-16-pe-waterfall-dsl-pack.md`
- `superpowers/plans/2026-07-16-scaffold-encoding-and-ts-kit.md`
- `superpowers/plans/2026-07-17-duplication-gate-p0.md`
- `superpowers/plans/2026-07-18-reuse-or-justify-dialogue-p1b.md`
- `superpowers/plans/2026-07-18-reuse-scout-p1a.md`

### superpowers/specs/

- `superpowers/specs/2026-06-22-build-chain-session-chaining-design.md`
- `superpowers/specs/2026-06-25-feature-brownfield-change-route-design.md`
- `superpowers/specs/2026-06-26-per-cluster-stacked-prs-design.md`
- `superpowers/specs/2026-06-27-autonomous-brownfield-lane-design.md`
- `superpowers/specs/2026-06-27-brownfield-tracker-routing-design.md`
- `superpowers/specs/2026-06-27-symphony-workspace-security-design.md`
- `superpowers/specs/2026-06-28-concurrency-cap-enforcement-design.md`
- `superpowers/specs/2026-06-28-g10-topology-templates-design.md`
- `superpowers/specs/2026-06-28-g11-harness-coverage-design.md`
- `superpowers/specs/2026-06-28-g12-approved-fixtures-design.md`
- `superpowers/specs/2026-06-28-g12-contract-drift-gate-design.md`
- `superpowers/specs/2026-06-28-g12-default-a11y-design.md`
- `superpowers/specs/2026-06-28-g12-flake-detection-design.md`
- `superpowers/specs/2026-06-28-g9-app-observability-baseline-design.md`
- `superpowers/specs/2026-06-28-g9-runtime-slo-sensor-design.md`
- `superpowers/specs/2026-06-28-in-session-auto-merge-design.md`
- `superpowers/specs/2026-06-28-publish-to-jira-design.md`
- `superpowers/specs/2026-07-01-verification-matrix-gate-design.md`
- `superpowers/specs/2026-07-02-audit-fixes-design.md`
- `superpowers/specs/2026-07-04-sprint-delta-lane-design.md`
- `superpowers/specs/2026-07-05-pe-ic-memo-design.md`
- `superpowers/specs/2026-07-05-ubiquitous-language-design.md`
- `superpowers/specs/2026-07-06-expert-generalist-scaffold-composition-design.md`
- `superpowers/specs/2026-07-06-pe-ubiquitous-language-design.md`
- `superpowers/specs/2026-07-07-python-react-specialty-pack-design.md`
- `superpowers/specs/2026-07-08-sprint-dedup-precheck-design.md`
- `superpowers/specs/2026-07-09-devin-parity-hardening-design.md`
- `superpowers/specs/2026-07-14-sensors-cli-parity-design.md`
- `superpowers/specs/2026-07-16-boundary-test-doubles-design.md`
- `superpowers/specs/2026-07-16-pe-dsl-pluggable-domain-packs-design.md`
- `superpowers/specs/2026-07-16-pe-waterfall-dsl-semantic-model-design.md`
- `superpowers/specs/2026-07-17-evolution-loop-harness-mechanism-design.md`
- `superpowers/specs/2026-07-18-secure-repo-baseline-ratchet-design.md`
- `superpowers/specs/2026-07-19-branch-protection-provisioner-design.md`
- `superpowers/specs/2026-07-19-compliance-attestation-design.md`
- `superpowers/specs/2026-07-19-deploy-approval-environments-design.md`
- `superpowers/specs/2026-07-19-fleet-retrofit-runner-design.md`
- `superpowers/specs/2026-07-19-portfolio-rollup-design.md`
- `superpowers/specs/2026-07-22-spdd-brd-spec-uplift-design.md`
- `superpowers/specs/2026-07-25-brd-review-loop-design.md`
- `superpowers/specs/2026-08-17-story-bundle-design.md`
