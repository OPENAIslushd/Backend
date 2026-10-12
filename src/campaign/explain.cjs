// Test results per plan: each plan's own success criteria checked against its simulated metrics,
// plus its standing against 100 random allocations. Only numbers from this run are used.
const PROFILE = {
  conservative: "Temkinli",
  balanced: "Dengeli",
  high_risk_high_reward: "Yüksek risk / getiri",
};
const RULE = {
  conservative: "kötü senaryolardaki kârı (P10) en yüksek plan",
  balanced: "beklenen kâr − 0,5 × oynaklık en yüksek plan",
  high_risk_high_reward: "iyi senaryolardaki kârı (P90) en yüksek plan",
};
const fmt = (n) => Math.round(n).toLocaleString("tr-TR");
const pct = (n) =>
  `%${(n * 100).toLocaleString("tr-TR", { maximumFractionDigits: 1 })}`;
function criteria(plan, m, cur) {
  const c = plan.success_criteria,
    out = [];
  if (c.max_cost_per_purchase != null && m.acquisition_cost != null)
    out.push({
      label: "Satış başı maliyet",
      target: `≤ ${fmt(c.max_cost_per_purchase)} ${cur}`,
      actual: `${fmt(m.acquisition_cost)} ${cur}`,
      met: m.acquisition_cost <= c.max_cost_per_purchase,
    });
  if (c.max_loss_probability != null)
    out.push({
      label: "Zarar olasılığı",
      target: `≤ ${pct(c.max_loss_probability)}`,
      actual: pct(m.probability_of_loss),
      met: m.probability_of_loss <= c.max_loss_probability,
    });
  if (c.min_purchases != null)
    out.push({
      label: "30 günde satış",
      target: `≥ ${fmt(c.min_purchases)}`,
      actual: fmt(m.expected_purchases),
      met: m.expected_purchases >= c.min_purchases,
    });
  out.push({
    label: "Beklenen kâr",
    target: "> 0",
    actual: `${fmt(m.expected_contribution_profit)} ${cur}`,
    met: m.expected_contribution_profit > 0,
  });
  return out;
}
function buildEvidence({
  plans,
  planEvaluation,
  baselineEvaluation,
  ui,
  input,
}) {
  const cur = input.currency;
  const baseline = baselineEvaluation.results.map(
    (r) => r.adaptive.expected_contribution_profit,
  );
  const baseP10 = baselineEvaluation.results.map((r) => r.adaptive.profit_p10);
  const chosen = Object.fromEntries(
    ui.recommendations.map((r) => [r.strategy.strategy_id, r.profile]),
  );
  return plans.map((plan) => {
    const result = planEvaluation.results.find(
      (r) => r.strategy.strategy_id === plan.strategyId,
    );
    if (!result) return { planId: plan.id, tested: false };
    const m = result.adaptive;
    const checks = criteria(plan, m, cur);
    const met = checks.filter((x) => x.met).length;
    const beats = baseline.filter(
      (x) => x < m.expected_contribution_profit,
    ).length;
    const beatsP10 = baseP10.filter((x) => x < m.profit_p10).length;
    const profile = chosen[plan.strategyId] || null;
    return {
      planId: plan.id,
      tested: true,
      verdict:
        met === checks.length
          ? "supported"
          : met === 0
            ? "rejected"
            : "partial",
      checks,
      metrics: m,
      adaptiveGain: result.paired_profit_delta.mean,
      baseline: { count: baseline.length, beatsProfit: beats, beatsP10 },
      findings: [
        `Kâr, ${baseline.length} rastgele kanal dağılımının ${beats} tanesinden yüksek; kötü senaryo kârı ${beatsP10} tanesinden yüksek.`,
        `Planın 3 günlük kaydırma kuralı, payları hiç değiştirmemeye göre ortalama ${result.paired_profit_delta.mean >= 0 ? "+" : ""}${fmt(result.paired_profit_delta.mean)} ${cur} kâr farkı yarattı.`,
        `Senaryoların %80'i ${fmt(m.profit_p10)} ile ${fmt(m.profit_p90)} ${cur} arasında kâr veriyor.`,
      ],
      recommendedAs: profile && {
        profile,
        label: PROFILE[profile],
        rule: `${PROFILE[profile]} öneri: ${RULE[profile]}.`,
      },
    };
  });
}
module.exports = { buildEvidence };
