// .claude/scripts/build-chain.js
'use strict';

// Cross-process session-chaining driver. Spawns a FRESH `claude -p` per link so
// a long /build --auto run survives past a single process's lifetime:
//
//   PLAN  ->  /build --auto --plan-only <prd>     (writes specs/, features.json)
//   BUILD ->  /auto --once                        (one wave, commit, checkpoint, exit)  [loop]
//   FINAL ->  /build --auto --finalize            (Phases 9 -> 9.5 -> 10 -> 11, open PR)
//
// Between links it reads only state the harness already writes (claude-progress.txt
// + features.json). Decision logic lives in build-chain-state.js (pure, unit-tested).

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const S = require('./build-chain-state.js');

function done(state, reason, links) {
  return { state, reason, links };
}

// One BUILD wave, with a single sequential fallback if the wave link fails
// uncleanly (e.g. a wave too big to finish under the per-link timeout).
function runBuildLink(spawnLink) {
  if (spawnLink(S.STATES.BUILD, { sequential: false }).ok) return true;
  return spawnLink(S.STATES.BUILD, { sequential: true }).ok;
}

async function runChain(deps) {
  const { spawnLink, loadState, log = () => {}, maxLinks = 50, maxNoProgress = 3 } = deps;

  log('chain: PLAN');
  if (!spawnLink(S.STATES.PLAN).ok) return done(S.STATES.STUCK, 'plan link failed', 0);

  let links = 0;
  let lastPassing = -1;
  let noProgress = 0;
  for (;;) {
    const block = loadState();
    if (S.isBuildComplete(block)) break;
    if (S.budgetExceeded(links, maxLinks)) return done(S.STATES.STUCK, `link budget exceeded (${links})`, links);
    if (S.stallExceeded(noProgress, maxNoProgress)) return done(S.STATES.STUCK, `no feature progress for ${noProgress} links`, links);

    log(`chain: BUILD #${links + 1}`);
    const linkOk = runBuildLink(spawnLink);
    links += 1;

    const after = loadState();
    if (linkOk && after.featuresPassing > lastPassing) { lastPassing = after.featuresPassing; noProgress = 0; }
    else { noProgress += 1; }
  }

  log('chain: FINALIZE');
  if (!spawnLink(S.STATES.FINALIZE).ok) return done(S.STATES.STUCK, 'finalize link failed', links);
  return done(S.STATES.DONE, 'PR raised', links);
}

// ---- real deps (used by the CLI entrypoint; not exercised by unit tests) ----

function promptFor(kind, prd, opts = {}) {
  if (kind === S.STATES.PLAN) return `/build --auto --plan-only ${prd}`;
  if (kind === S.STATES.FINALIZE) return '/build --auto --finalize';
  return `/auto --once${opts.sequential ? ' --sequential' : ''}`; // BUILD
}

function realSpawnLink(cwd, prd) {
  const model = process.env.BUILD_CHAIN_MODEL || 'sonnet';
  const timeout = parseInt(process.env.BUILD_CHAIN_LINK_TIMEOUT_MS || '1800000', 10); // 30 min < wall
  const pluginDir = process.env.HARNESS_PLUGIN_DIR || null;
  return (kind, opts = {}) => {
    const args = ['-p', '--model', model];
    if (pluginDir) args.push('--plugin-dir', pluginDir);
    const r = spawnSync('claude', args, {
      input: promptFor(kind, prd, opts),
      cwd, encoding: 'utf8', timeout, killSignal: 'SIGKILL',
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    return { ok: r.status === 0 && !r.signal };
  };
}

function realLoadState(cwd) {
  return () => {
    let text = '';
    try { text = fs.readFileSync(path.join(cwd, 'claude-progress.txt'), 'utf8'); } catch (_) { /* none yet */ }
    return S.parseLastBlock(text);
  };
}

if (require.main === module) {
  const prd = process.argv[2];
  if (!prd || !fs.existsSync(prd)) {
    process.stderr.write('usage: node .claude/scripts/build-chain.js <path-to-prd.md>\n');
    process.exit(2);
  }
  const cwd = process.cwd();
  runChain({ spawnLink: realSpawnLink(cwd, prd), loadState: realLoadState(cwd), log: (m) => process.stdout.write(`${m}\n`) })
    .then((res) => {
      process.stdout.write(`chain finished: ${res.state} — ${res.reason} (${res.links} build links)\n`);
      process.exit(res.state === S.STATES.DONE ? 0 : 1);
    });
}

module.exports = { runChain };
