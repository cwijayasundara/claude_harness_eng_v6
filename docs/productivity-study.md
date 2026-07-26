# Matched productivity studies

Tranche C treats productivity multipliers as hypotheses. Tool calls, tokens,
commits, lines of code, and agent runs are utilization signals; none establishes
delivered value.

## Evidence contract

The study compares exactly one historical/manual `baseline` observation with
one `agentic` observation under a shared comparison id. Both observations must
match on risk tier, work class, and size bucket. Each task must have:

- an implementation start and outcome-confirmation timestamp;
- positive human-attention minutes;
- a passing gate event;
- explicit human acceptance and confirmed production survival;
- an evidence reference and SHA-256 evidence hash.

Missing or mismatched observations are excluded and reported. They never become
zero-cost or infinitely fast wins. Any exclusion in the named study prevents a
positive multiplier claim, which makes failed or incomplete recorded attempts
part of the result rather than survivorship-biased noise.

Record the matching metadata on lifecycle events:

```bash
npm run record-outcome -- \
  --kind outcome_confirmed \
  --study STUDY-2026-Q3 \
  --comparison AUTH-FEATURE-MEDIUM-01 \
  --cohort agentic \
  --work-class feature \
  --size-bucket medium \
  --attention-minutes 45 \
  --accepted true \
  --production-survived true \
  --evidence-reference .claude/evidence/task-completion-receipt.json \
  --evidence-hash <sha256>
```

Use the same study metadata on `implementation_started` and
`gate_completed`; record the gate verdict with `--meta verdict=pass`.

## Analysis

```bash
npm run productivity-study -- --study STUDY-2026-Q3
```

The report is written to `.claude/evidence/productivity-study.json`. It reports
median human-attention and cycle-time speedups, rework events, exclusions, and
a deterministic bootstrap confidence bound.

The default “8x supported” decision requires at least ten eligible matched
pairs and a 95% lower confidence bound of at least 8x for human-attention
productivity. The observed median alone is never enough.

This is an association from a controlled matched comparison, not universal
causal proof. Teams should pre-register the study id, matching rules, sample
window, and survival window before collecting the agentic cohort, and should
publish negative or insufficient results unchanged.
