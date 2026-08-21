'use strict';

// Where the live e2e routes build their throwaway projects.
//
// Each live route scaffolds a WHOLE project — hundreds of files, a git repo, a
// node_modules — and the routes used to drop those trees inside the harness's
// own checkout (`test/e2e/<name>-output/`). Two things go wrong there:
//
//   1. On an iCloud-synced checkout the sync daemon races the scaffold's
//      concurrent writes and spawns `<name> 2.<ext>` duplicates. Those wedge
//      `scaffold-copy` / `skills-consistency` and hang `npm test` — the exact
//      failure the root CLAUDE.md documents under "Working-tree hygiene".
//   2. A generated tree inside the repo is one `.gitignore` slip away from
//      being committed, and it makes `git status` unreadable during a run.
//
// The build product is not source, so it does not belong in the source tree.
// Root order: $HARNESS_E2E_WORKDIR (explicit opt-in, e.g. a fast local disk),
// else <tmpdir>/harness-e2e.

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_DIRNAME = 'harness-e2e';

/** The out-of-repo root that every live route's project dir lives under. */
function e2eRoot() {
  const override = process.env.HARNESS_E2E_WORKDIR;
  const root = override && override.trim()
    ? path.resolve(override.trim())
    : path.join(os.tmpdir(), DEFAULT_DIRNAME);
  return fs.realpathSync.native(ensureDir(root));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * The project dir for one route, e.g. e2eWorkdir('plan').
 *
 * `name` is a single path segment on purpose: these paths get handed to
 * `freshProject`, which rm -rf's them. A name carrying `..` or a separator
 * would let a caller aim that delete at an arbitrary directory.
 */
function e2eWorkdir(name) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9._-]+$/.test(name) || name === '.' || name === '..') {
    throw new Error(`e2eWorkdir: name must be a single path segment, got ${JSON.stringify(name)}`);
  }
  return path.join(e2eRoot(), name);
}

module.exports = { e2eRoot, e2eWorkdir, DEFAULT_DIRNAME };
