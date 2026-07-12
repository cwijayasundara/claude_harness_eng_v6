# Canary record

**Trigger:** mechanical migrate always canaries **3 files** (or the smallest representative set) before full fan-out.

| # | File | Result (pass/fail) | Notes |
|---|------|--------------------|-------|
| 1 | | | |
| 2 | | | |
| 3 | | | |

**Commands run on canary:**

```bash
# tests / lint / types — record exact commands and exit codes
```

**Decision:** proceed to fan-out | revise mapping | abort  

**Reviewers:** mapping reviewed by <!-- dual code-reviewer | human --> on <!-- date -->
