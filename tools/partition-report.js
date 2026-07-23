'use strict';

// Derived views over the partition-check result, split out of check-partition.js so the
// checker stays the rule engine and this stays presentation + profile analysis.
//
// The load-bearing addition here is the PROFILE-CLOSURE analysis. check-partition proves
// the kernel never hard-references a pack; that is the special case of a more general
// rule the profiles imply: a composed install (kernel + a profile's packs) must be closed
// under hard references, or it crashes on a require() for a module it did not ship. The
// profiles are a nested chain (kernel c core c brownfield c full), so a cross-pack edge is
// only safe when every profile that installs the caller also installs the callee's pack.

function installs(profile, pack) {
  return pack === 'kernel' || (profile.packs || []).includes(pack);
}

// A cross-pack hard edge breaks a profile when that profile ships the caller (FROM) but
// not the callee's pack (TO). Those are the edges whose composed install cannot run —
// distinct from a benign cross-pack edge, where the two packs always travel together.
function computeProfileBreaks(crossPack, profiles) {
  const out = [];
  for (const e of crossPack) {
    const breaking = Object.keys(profiles || {})
      .filter((n) => installs(profiles[n], e.fromPack) && !installs(profiles[n], e.toPack));
    if (breaking.length) {
      out.push({ from: e.from, to: e.to, fromPack: e.fromPack, toPack: e.toPack, profiles: breaking });
    }
  }
  return out;
}

function reportCrossPack(crossPack) {
  if (!crossPack.length) return;
  const pairs = {};
  for (const e of crossPack) {
    const k = `${e.fromPack} -> ${e.toPack}`;
    pairs[k] = (pairs[k] || 0) + 1;
  }
  console.log(`\ncross-pack edges (allowed, but each is a coupling to retire): ${crossPack.length}`);
  Object.entries(pairs).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${String(v).padStart(4)}  ${k}`));
}

// Reported loudly but not (yet) a --strict failure: these are real, observed breakages —
// a composed `core` install crashes loading these callers — so the count must reach zero,
// at which point check-partition can fail on them the way it fails on kernel -> pack.
function reportProfileBreaks(breaks) {
  if (!breaks.length) return;
  console.log(`\nPROFILE-BREAKING edges: ${breaks.length} — a profile installs the caller but ` +
    `not the callee's pack, so that profile's composed install CRASHES on the require:`);
  for (const b of breaks) console.log(`    ${b.from}  ->  ${b.to}   breaks: ${b.profiles.join(', ')}`);
  console.log('Resolve by guarding the load (try/require/catch → degrade when the pack is absent),\n' +
    'moving the callee into a lower pack, or narrowing the profile. Target: zero.');
}

function reportViolations(violations) {
  const byPack = {};
  for (const v of violations) (byPack[v.pack] = byPack[v.pack] || []).push(v);
  console.log(`\nKERNEL -> PACK violations: ${violations.length}`);
  for (const [pack, list] of Object.entries(byPack).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n  ${pack} (${list.length})`);
    for (const v of list) console.log(`    ${v.from}  ->  ${v.to}`);
  }
  console.log(
    '\nEach line is a kernel unit that cannot run without that pack installed.\n' +
    'Resolve by: moving the caller into the pack, moving the callee into the kernel,\n' +
    'or making the call optional (degrade when the pack is absent).'
  );
}

// The full console report for a partition check. Kept here (not in check-partition.js)
// so the checker stays the rule engine; main() only decides the exit code.
function printReport({ partition, assign, result }) {
  const { violations, crossPack, optional, accepted, staleAccepted, units } = result;
  const counts = {};
  for (const v of Object.values(assign)) counts[v] = (counts[v] || 0) + 1;
  console.log(`partition: ${units} units — ` +
    Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', '));
  if (optional.length) {
    console.log(`\nkernel -> pack edges already guarded (lazy/try-catch, not violations): ${optional.length}`);
    for (const e of optional) console.log(`    ${e.from}  ~>  ${e.to}  [${e.pack}]`);
  }
  if (accepted.length) {
    console.log(`\naccepted kernel -> pack edges (declared exceptions, reviewed): ${accepted.length}`);
    for (const e of accepted) console.log(`    ${e.from}  ->  ${e.to}  [${e.pack}] — ${e.why}`);
  }
  if (staleAccepted.length) {
    console.log(`\nSTALE accepted_edges (no longer a real edge — delete them): ${staleAccepted.join(', ')}`);
  }
  reportCrossPack(crossPack);
  reportProfileBreaks(computeProfileBreaks(crossPack, partition.profiles || {}));
  if (!violations.length) { console.log('\nOK: no kernel -> pack hard references.'); return; }
  reportViolations(violations);
}

module.exports = {
  installs, computeProfileBreaks, printReport,
  reportCrossPack, reportProfileBreaks, reportViolations,
};
