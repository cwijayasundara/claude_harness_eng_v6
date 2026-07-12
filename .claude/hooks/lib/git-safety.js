'use strict';

// Multi-agent git safety (Bun Phase A).
// Denies destructive git commands when parallel implement is active.
// Escape: HARNESS_GIT_SAFETY=off

/**
 * Patterns that parallel agents must not run (Bun: stash/reset stepped on each other).
 * Matched against the full bash command string (case-sensitive git subcommands).
 */
const FORBIDDEN = Object.freeze([
  {
    id: 'git-stash',
    re: /\bgit\s+stash\b/,
    message: 'git stash is forbidden during parallel implement (agents step on each other)',
  },
  {
    id: 'git-reset-hard',
    re: /\bgit\s+reset\s+(-[a-zA-Z]*\s+)*--hard\b/,
    message: 'git reset --hard is forbidden during parallel implement',
  },
  {
    id: 'git-clean-fd',
    re: /\bgit\s+clean\b[^;&|\n]*(-[a-zA-Z]*f[a-zA-Z]*d|-fd|-df)/,
    message: 'git clean -fd is forbidden during parallel implement',
  },
  {
    id: 'git-push-force',
    re: /\bgit\s+push\b[^;&|\n]*--force\b|\bgit\s+push\b[^;&|\n]*\s-f\b/,
    message: 'git push --force is forbidden during parallel implement',
  },
]);

/**
 * @param {string} command bash command
 * @returns {{ id: string, message: string } | null}
 */
function findForbiddenGit(command) {
  if (!command || typeof command !== 'string') return null;
  // Skip pure comments
  const trimmed = command.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  for (const p of FORBIDDEN) {
    if (p.re.test(command)) return { id: p.id, message: p.message };
  }
  return null;
}

/**
 * Whether the deny list is active for this environment / project.
 * Active when:
 * - HARNESS_PARALLEL_AGENTS=1, or
 * - .claude/state/parallel-implement.lock exists under projectDir
 * Disabled when HARNESS_GIT_SAFETY=off.
 *
 * @param {object} opts
 * @param {string} [opts.projectDir]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {(p: string) => boolean} [opts.existsSync]
 */
function isGitSafetyActive(opts = {}) {
  const env = opts.env || process.env;
  if (String(env.HARNESS_GIT_SAFETY || '').toLowerCase() === 'off') return false;
  if (String(env.HARNESS_PARALLEL_AGENTS || '') === '1') return true;
  const projectDir = opts.projectDir;
  if (!projectDir) return false;
  const existsSync = opts.existsSync || require('fs').existsSync;
  const path = require('path');
  return existsSync(path.join(projectDir, '.claude', 'state', 'parallel-implement.lock'));
}

/**
 * @returns {{ block: boolean, reason?: string, id?: string }}
 */
function checkGitSafety(command, opts = {}) {
  if (!isGitSafetyActive(opts)) return { block: false };
  const hit = findForbiddenGit(command);
  if (!hit) return { block: false };
  return {
    block: true,
    id: hit.id,
    reason:
      `BLOCKED: ${hit.message}\n` +
      `(command: ${command})\n` +
      `Fix: commit specific owned paths only; never stash/reset --hard/clean -fd/force-push while parallel agents run.\n` +
      `Escape (human only): HARNESS_GIT_SAFETY=off\n`,
  };
}

module.exports = {
  FORBIDDEN,
  findForbiddenGit,
  isGitSafetyActive,
  checkGitSafety,
};
