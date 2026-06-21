'use strict';

// PR creation + auto-merge — the GitHub side of a completed run, split out of the
// scheduler (which owns claim/workspace/run/state) for single-responsibility.

const { runCommand } = require('./workspace-manager');

async function maybeCreatePr(workspacePath, issue, group, config) {
  if (!config.github.createPr) return null;

  try {
    const title = `Implement ${issue.key} group ${group.id}`;
    const body = `Automated Claude Harness run for ${issue.key}.\n\nGroup: ${group.id}\nStories: ${group.stories.join(', ') || 'not listed'}`;
    const { stdout } = await runCommand('gh', [
      'pr', 'create', '--title', title, '--body', body, '--base', config.github.baseBranch
    ], { cwd: workspacePath });
    return stdout.trim().split('\n').pop();
  } catch (error) {
    return `PR creation skipped or failed: ${error.message}`;
  }
}

function isRealPrUrl(prUrl) {
  // Require the canonical PR URL shape (host/owner/repo/pull/<n>), not just an
  // http(s) prefix: maybeCreatePr scrapes the last stdout line, so a stray line
  // from a target repo's PR-template/post-create output must not be mergeable.
  return typeof prUrl === 'string' && /^https?:\/\/[^/\s]+\/[^/\s]+\/[^/\s]+\/pull\/\d+(?:[/?#].*)?$/.test(prUrl.trim());
}

// owner/repo (lowercased) from a git remote URL — scp-style (git@host:o/r.git),
// https (https://host/o/r[.git]), or ssh:// — or null if unparseable.
function repoSlugFromGitUrl(url) {
  const m = String(url || '').match(/[:/]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
}

// owner/repo (lowercased) from a canonical PR URL, or null.
function repoSlugFromPrUrl(prUrl) {
  const m = String(prUrl || '').match(/^https?:\/\/[^/\s]+\/([^/\s]+)\/([^/\s]+)\/pull\/\d+/);
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
}

// Enable GitHub native auto-merge: GitHub merges the PR only once required status
// checks pass and branch protections are satisfied, so a failing build is never
// merged. Returns {enabled} so the caller falls back to human review on failure.
async function enableAutoMerge(prUrl, cwd, config) {
  if (!isRealPrUrl(prUrl)) return { enabled: false, reason: 'no PR to merge' };
  // Pin to the configured target repo: a shape-valid PR URL for a different repo
  // must never be merged, even if it was scraped from stray output.
  const wantSlug = repoSlugFromGitUrl(config.repoUrl);
  const prSlug = repoSlugFromPrUrl(prUrl);
  if (wantSlug && prSlug && prSlug !== wantSlug) {
    return { enabled: false, reason: `PR repo ${prSlug} does not match configured ${wantSlug}` };
  }
  const method = (config.autoMerge && config.autoMerge.method) || 'merge';
  try {
    await runCommand('gh', ['pr', 'merge', '--auto', `--${method}`, '--', prUrl], { cwd });
    return { enabled: true };
  } catch (error) {
    return { enabled: false, reason: error.message };
  }
}

module.exports = { maybeCreatePr, isRealPrUrl, enableAutoMerge, repoSlugFromGitUrl, repoSlugFromPrUrl };
