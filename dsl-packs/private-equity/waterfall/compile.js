function normalizeTier(t) {
  switch (t.tier) {
    case "return_of_capital":
      return { op: "roc", to: "lp", basis: t.basis || "contributed_capital" };
    case "preferred_return":
      return { op: "pref", rate: t.rate, compounding: t.compounding || "annual", basis: t.basis || "contributed_capital" };
    case "gp_catchup":
      return { op: "catchup", gpRate: t.rate, targetCarry: t.target_carry };
    case "carried_interest":
      return { op: "carry", gpSplit: t.split.gp, lpSplit: t.split.lp, aboveMoic: (t.above === undefined ? null : t.above) };
    default:
      throw new Error(`unknown tier type: ${t.tier}`);
  }
}

function compile(surface) {
  const w = surface.waterfall;
  const clawback = (w.clawback === undefined) ? (w.mode === "american") : w.clawback;
  return {
    fund: w.fund,
    mode: w.mode,
    hurdle: w.hurdle,
    clawback,
    tiers: surface.tiers.map(normalizeTier)
  };
}

module.exports = { compile };
