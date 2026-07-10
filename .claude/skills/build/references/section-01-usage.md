## Usage

```
/build path/to/requirements.md
/build path/to/requirements.md --mode lean
/build --lite "Python CLI that summarizes a URL"   # small new project (interactive)
/build --lite --auto path/to/prd.md                # headless lite: small PRD -> PR, zero gates
/build path/to/requirements.md --autonomous        # plan-approve once, then run to PR
/build path/to/prd.md --autonomous --plan-only     # produce specs/ for inspection, then stop
/build path/to/prd.md --autonomous --pod 3         # pod: each cluster raises its own PR
/build path/to/prd.md --autonomous --pod 3 --single-pr  # pod concurrency, one integrated PR
/build path/to/prd.md --auto --pod 3               # full-auto: PRD -> per-cluster PRs, zero gates
/build --auto --finalize                           # build-chain terminal link: Phases 9, 9.5, 10, 11 only
/build path/to/prd.md --auto --auto-merge        # full-auto, and auto-merge the PR when CI is green
```

The `--mode` flag controls which ratchet gates `/auto` enforces. Default: `full`.
