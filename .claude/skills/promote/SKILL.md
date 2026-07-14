---
name: promote
description: Implement an approved /retro recommendation and open a PR against this harness repo. Use after a human has approved a recommendation via /retro --apply-decisions. Merge always stays human — this skill only opens the PR, never merges. Refuses gate-loosen/security-class recommendations outright; those are permanently human-gated and must go through /vibe or /change manually.
argument-hint: "<recommendation-id>"
context: fork
---

# /promote — implement an approved harness recommendation as a PR

Agentic-flywheel Phase B (`docs/agentic-flywheel-design.md` §4.3). This is the
harness's own "promotion-as-PR" step: it turns a human-approved `/retro`
recommendation into a real, reviewable pull request against this repo.
Registered in `scaffold-copy.js`'s `CORE_SCRIPTS`/`CORE_SKILLS`, so it ships
to every scaffolded project too, operating on whatever repo it runs in —
nothing here is hardcoded to this meta-repo. That's untested against a real
scaffolded project (same caveat `/retro` already carries, §9 Decision 2).
"Meta-repo only" in earlier drafts described this feature's *verification*
scope during development, not a registration boundary — do not read it as
one.

> **Effort:** run at `high`. This delegates the actual code editing to
> `/vibe`/`/change` (which already run at their own appropriate effort) — this
> skill's own job is orchestration and git/PR mechanics, not deep reasoning.

The **merge** decision is never automated by this skill, in any phase. Opening
the PR is as far as automation goes; a human reviews and merges through the
normal GitHub flow, unchanged.

---

## Usage

```
/promote REC-20260714-001
```

## What this skill will NOT do (hard boundaries, not suggestions)

- **Never promote a `gate-loosen` or `security`-class recommendation.** Enforced
  by a deterministic script (Step 1), not by these instructions — do not
  attempt to work around a refusal by editing `recommendations.jsonl`'s
  `status`/`class` by hand to force eligibility. Those changes are
  permanently human-only, routed through `/vibe` or `/change` directly.
- **Never touch `CLAUDE.md`, `.mcp.json`, or a `.claude/settings*.json` file.**
  These are prefix-cache-protected (`pre-write-gate`); a Phase B recommendation
  targeting one of these is out of scope for this skill and must be handled by
  a human between sessions. Refuse and report — do not attempt the
  `HARNESS_PREFIX_EDIT` escape hatch here.
- **Never open a PR over a red build.** Mirrors this harness's own "no PR is
  ever opened over a red build regardless of model" invariant.
- **Never merge.** Not now, not for any recommendation class or confidence
  score — that's a human action through the normal PR review flow.
- **Never interpolate a recommendation's free-text fields (`target`, `change`,
  `evidence`) directly into a shell command string.** They are untrusted
  content, not trusted parameters — write them to a temp file first and pass
  the file (`git commit -F`, `gh pr create --body-file`), per Steps 7 and 8. The same
  applies to the recommendation `id` in a branch name — `promote-recommendation.js`
  already refuses anything not matching `REC-YYYYMMDD-NNN` before you reach
  this step, but treat that as a backstop, not a reason to interpolate freely
  elsewhere.

---

<execution_steps>

### Step 1 — Deterministic eligibility check (hard gate, non-negotiable)

Run:
```bash
node .claude/scripts/promote-recommendation.js --check <recommendation-id>
```

Exit 0 means eligible; **any non-zero exit means STOP immediately** and report
the printed reason to the human. Do not proceed past a refusal for any
reason — this is the guardrail that must live outside the loop the agent can
rewrite in the same run. Never pass a custom file path argument to this
script — always let it check the real, tracked
`specs/retro/recommendations.jsonl`. (The optional path argument exists only
for this repo's own test isolation; using it here would let the check pass
against a file that isn't the one anything else reads.)

### Step 2 — Read the recommendation

Read the full record for `<recommendation-id>` from
`specs/retro/recommendations.jsonl`: `target`, `change`, `evidence`, `class`,
`risk`/`cost`/`benefit`.

If `target` names `CLAUDE.md`, `.mcp.json`, or a `.claude/settings*.json`
path, **stop here** and report that this recommendation is out of scope for
`/promote` (prefix-cache-protected) — the human must implement it manually,
between sessions.

### Step 3 — Confirm a clean starting point

Run `git status`. The working tree must be clean and on `main`. If not, stop
and report what's there — do not stash or discard anything. If a branch
`retro/<recommendation-id>` already exists (local or on `origin`), stop and
report it — a prior attempt may be in progress; do not overwrite it.

### Step 4 — Create the branch and implement the change

```bash
git checkout -b retro/<recommendation-id>
```

Implement `change` against `target`. Route the actual editing the same way
this harness always does: use `/vibe` when the change is narrowly scoped to
a single file, `/change` when it touches more than a few files or needs its
own test-first cycle. Follow whichever skill's own discipline once invoked —
this skill's job is orchestration, not re-implementing that judgment.

### Step 5 — Gate: full suite must be green

Run `npm test`. It must be 100% green (this is the agentic-flywheel §4.4
"harness eval suite" gate — the existing deterministic test suite, not a
new framework: 1800+ tests including per-gate wiring-contract tests and the
`harness-manifest.json` honesty invariant already comprehensively answer "did
this harness change break anything," which is what §4.4 needed).

If anything fails, **stop — do not open a PR.** Report the failure and leave
the branch as-is on disk for a human to inspect; do not attempt further fixes
beyond what `/vibe`/`/change`'s own verification step already covered.

### Step 6 — Stage carefully

Run `git status --porcelain`. If `/vibe`/`/change` already committed the
change itself, there is nothing to stage here — skip to Step 7. Otherwise:

```bash
git add -u
```

**Do not use `git add -A`.** `-u` stages only files git already tracks; a
blanket `-A` would sweep in anything untracked that happens to be sitting in
the working tree (a stray local file, a transient lock, an artifact from an
unrelated tool) and push it to the real remote. If the change genuinely adds
a new file, `git add` that specific path explicitly. Review
`git diff --cached --stat` and confirm the staged set is exactly what the
recommendation's `target` implies before continuing.

### Step 7 — Commit

Write the commit message to a temp file first — never inline a recommendation's
free-text fields into `-m "..."`:

```bash
cat > /tmp/promote-commit-msg.txt <<'MSG'
<conventional commit message referencing the recommendation id>
MSG
git commit -F /tmp/promote-commit-msg.txt
```

### Step 8 — Push, then show the human before opening the PR

```bash
git push -u origin retro/<recommendation-id>
```

If this fails (no auth, no remote access), **stop and report** — the commit
exists locally; a human resolves the push manually. Do not retry blindly or
force-push.

On success, draft the PR title and body (write the body to a temp file, same
reasoning as the commit message — never inline `--body "..."`). The body must
include: the recommendation's `target`, `change`, `evidence`, `class`, and
`risk`/`cost`/`benefit`, plus a line noting it was opened by `/promote` from
an approved `/retro` recommendation (id, and that `npm test` passed before
opening). State plainly in the body that this PR requires human review and
merge like any other.

**Before running `gh pr create`, show the human the diff
(`git diff main...retro/<recommendation-id>`) and the drafted title/body, and
wait for explicit go-ahead in the conversation.** The pushed branch is already
visible on the remote at this point, but nothing public (a PR) exists yet —
this is the last checkpoint before that changes. Do not open the PR in the
same turn without that confirmation.

```bash
gh pr create --title "<title>" --body-file /tmp/promote-pr-body.txt
```

If this fails (`gh` not authenticated, etc.), **stop and report** — the
branch is pushed but no PR exists; the human opens one manually or fixes `gh`
auth and re-runs this step.

### Step 9 — Record the promotion directly on `main`

This is bookkeeping, not a harness behavior change, so it bypasses PR review
the same way any other direct-to-main commit in this repo does — but it must
happen now, synchronously, not be left for later:

```bash
git checkout main
git pull --ff-only
```

Update the recommendation's entry in `specs/retro/recommendations.jsonl` in
place: `status: "promoted"`, add `pr_url: "<the PR URL from Step 8>"`. Run
`npm run validate-recommendations` to confirm the file is still well-formed,
then:

```bash
git add specs/retro/recommendations.jsonl
git commit -m "chore: record promotion of <recommendation-id> as <PR URL>"
git push origin main
```

This must complete before the skill is done — a `/promote` run that opens a
PR but never reaches this step leaves the tracked recommendation
re-promotable (nothing on `main` would show it as already handled) and leaves
the working tree on a stale branch. If this step's push fails, stop and
report exactly what's uncommitted so a human can finish it by hand — do not
silently leave it undone.

### Step 10 — Report

Give the human the PR URL and state plainly that merge is a separate, manual
step — nothing here merges anything. Confirm you're back on `main` with a
clean tree.

</execution_steps>

---

## Relationship to other harness surfaces

- **`/retro`** drafts and the human approves recommendations; **`/promote`**
  is the separate, explicit, on-demand next step for an approved one — it is
  never auto-invoked (unlike `/retro` itself at `/auto` session end). A human
  runs it deliberately, per recommendation.
- **`promote-recommendation.js`** is a pure deterministic guardrail script —
  it decides eligibility only, never implements or touches git. Reusable by
  any future automation (e.g. a Phase C auto-approval path, not built) without
  re-deriving the eligibility rule.
- This is Phase B (`docs/agentic-flywheel-design.md` §7) — still human-approved
  *twice*: once approving the recommendation (`/retro`), once merging the PR
  (normal GitHub review). Phase C (scored
  auto-approval, unbuilt, blocked on Decision 3's ≥30-resolved-entries
  precondition) is out of scope here.
