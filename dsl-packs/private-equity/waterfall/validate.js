const ORDER = { roc: 0, pref: 1, catchup: 2, carry: 3 };

function pct(x) { return `${round(x * 100)}%`; }
function round(x) { return Math.round(x * 100) / 100; }

function checkCanonicalOrder(tiers) {
  const f = [];
  let lastRank = -1;
  tiers.forEach((t, i) => {
    const rank = ORDER[t.op];
    if (rank < lastRank) {
      f.push({ rule: 'R1', severity: 'error', path: `tiers[${i}]`,
        message: `Tier ${i + 1} (${t.op}) is out of order — canonical order is return of capital → preferred return → catch-up → carried interest; carry cannot be split before the catch-up tier resolves.` });
    }
    lastRank = Math.max(lastRank, rank);
  });
  return f;
}

function checkRocPresent(tiers) {
  if (!tiers[0] || tiers[0].op !== 'roc') {
    return [{ rule: 'R8', severity: 'error', path: 'tiers[0]',
      message: 'A return_of_capital tier must be present and first — LP capital is returned before any profit split.' }];
  }
  return [];
}

function checkCatchupTarget(tiers) {
  const carries = tiers.filter(t => t.op === 'carry');
  const catchup = tiers.find(t => t.op === 'catchup');
  if (!catchup || !carries.length) return [];

  const base = carries.find(c => c.aboveMoic === null) || carries[0];
  if (base && Math.abs(catchup.targetCarry - base.gpSplit) > 1e-9) {
    return [{ rule: 'R2', severity: 'error', path: 'gp_catchup',
      message: `gp_catchup.target_carry (${pct(catchup.targetCarry)}) ≠ carried_interest gp split (${pct(base.gpSplit)}) — the GP would catch up to a carry it never earns. Set them equal.` }];
  }
  return [];
}

function checkHurdleCoherence(ir, tiers) {
  const f = [];
  const hasCatchup = tiers.some(t => t.op === 'catchup');
  const hasPref = tiers.some(t => t.op === 'pref');

  if (ir.hurdle === 'hard' && hasCatchup) {
    f.push({ rule: 'R3', severity: 'error', path: 'waterfall.hurdle',
      message: 'hurdle: hard declares a gp_catchup tier — a hard hurdle pays carry only on profit above the preferred return and admits no catch-up. Remove the catch-up tier or switch to hurdle: soft.' });
  }
  if (ir.hurdle === 'soft' && !hasCatchup) {
    f.push({ rule: 'R3', severity: 'error', path: 'waterfall.hurdle',
      message: 'hurdle: soft is missing a gp_catchup tier — a soft hurdle requires the GP to catch up after the preferred return.' });
  }
  if (ir.hurdle === 'soft' && !hasPref) {
    f.push({ rule: 'R3', severity: 'error', path: 'waterfall.hurdle',
      message: 'hurdle: soft requires a preferred_return tier before the catch-up.' });
  }
  return f;
}

function checkSplits(tiers) {
  const f = [];
  const carries = tiers.filter(t => t.op === 'carry');
  carries.forEach((c, i) => {
    if (Math.abs(c.gpSplit + c.lpSplit - 1) > 1e-9) {
      f.push({ rule: 'R4', severity: 'error', path: `carried_interest[${i}]`,
        message: `carried_interest split sums to ${round(c.gpSplit + c.lpSplit)}, not 1.0.` });
    }
  });
  return f;
}

function checkCarryGates(tiers) {
  const carries = tiers.filter(t => t.op === 'carry');
  const gated = carries.filter(c => c.aboveMoic !== null).map(c => c.aboveMoic);
  const f = [];
  for (let i = 1; i < gated.length; i++) {
    if (gated[i] <= gated[i - 1]) {
      f.push({ rule: 'R5', severity: 'error', path: 'carried_interest',
        message: `multi-tier carry hurdles are not ascending — tier gated at ${gated[i]}x precedes tier gated at ${gated[i - 1]}x.` });
    }
  }
  return f;
}

function checkRates(tiers) {
  const f = [];
  const pref = tiers.find(t => t.op === 'pref');
  if (pref && !(pref.rate > 0 && pref.rate < 0.5)) {
    f.push({ rule: 'R6', severity: 'error', path: 'preferred_return.rate',
      message: `preferred_return.rate (${pct(pref.rate)}) is outside the sane range (0%, 50%).` });
  }

  const carries = tiers.filter(t => t.op === 'carry');
  carries.forEach((c, i) => {
    if (!(c.gpSplit > 0 && c.gpSplit < 1)) {
      f.push({ rule: 'R6', severity: 'error', path: `carried_interest[${i}].split.gp`,
        message: `carried_interest gp split (${pct(c.gpSplit)}) must be strictly between 0% and 100%.` });
    } else if (c.gpSplit > 0.30) {
      f.push({ rule: 'R6', severity: 'warn', path: `carried_interest[${i}].split.gp`,
        message: `carried_interest gp split (${pct(c.gpSplit)}) exceeds the 30% convention — confirm this is a super-carry tier.` });
    }
  });

  const catchup = tiers.find(t => t.op === 'catchup');
  if (catchup && !(catchup.gpRate > 0 && catchup.gpRate <= 1)) {
    f.push({ rule: 'R6', severity: 'error', path: 'gp_catchup.rate',
      message: `gp_catchup.rate (${pct(catchup.gpRate)}) must be in (0%, 100%].` });
  }
  return f;
}

function checkAmericanClawback(ir) {
  if (ir.mode === 'american' && !ir.clawback) {
    return [{ rule: 'R7', severity: 'warn', path: 'waterfall.clawback',
      message: 'mode: american without a clawback provision — deal-by-deal distributions can over-pay the GP on early winners; declare clawback: true or confirm intentional.' }];
  }
  return [];
}

function validate(ir) {
  const tiers = ir.tiers;
  const findings = [];

  findings.push(...checkCanonicalOrder(tiers));
  findings.push(...checkRocPresent(tiers));
  findings.push(...checkCatchupTarget(tiers));
  findings.push(...checkHurdleCoherence(ir, tiers));
  findings.push(...checkSplits(tiers));
  findings.push(...checkCarryGates(tiers));
  findings.push(...checkRates(tiers));
  findings.push(...checkAmericanClawback(ir));

  return findings;
}

module.exports = { validate };