import { CHANNELS, MODEL_VERSION, CREATIVE_FACTORS, rng, normal, lognormal, digest, sum, round, checkStrategy, checkUniqueStrategies, assert } from '../shared/core.js';
import { validateDefinition } from '../shared/contracts.js';

// Independent streams by scenario/channel/day keep every strategy and its fixed
// counterpart on the same exogenous conditions, regardless of adaptation decisions.
export function scenarioConditions(input, seed, scenarioIndex) {
  const market = lognormal(rng([seed, scenarioIndex, 'market']), 0.15);
  return Object.fromEntries(CHANNELS.map(channel => {
    const assumption = input.channels[channel];
    const channelRandom = rng([seed, scenarioIndex, channel, 'systematic']);
    const cost = lognormal(channelRandom, assumption.cost_relative_sd);
    const conversion = lognormal(channelRandom, assumption.conversion_relative_sd) * market;
    return [channel, Array.from({ length: 30 }, (_, index) => {
      const random = rng([seed, scenarioIndex, channel, index]);
      return { cost: cost * lognormal(random, 0.1), conversion: conversion * lognormal(random, 0.1), purchaseNoise: normal(random) };
    })];
  }));
}

export function reallocate(balances, evidence, rule) {
  const remaining = sum(Object.values(balances));
  const before = { ...balances };
  const enough = CHANNELS.every(c => evidence[c].clicks >= rule.min_clicks_per_channel && evidence[c].purchases >= rule.min_purchases_per_channel);
  if (!rule.enabled || !enough || remaining <= 0) return { before, after: { ...before }, moved: 0, remaining, reason: 'insufficient_evidence_or_disabled' };
  const ranked = [...CHANNELS].sort((a, b) => evidence[a].purchases / evidence[a].spend - evidence[b].purchases / evidence[b].spend || a.localeCompare(b));
  const worst = ranked[0];
  const best = ranked.at(-1);
  const improvement = evidence[best].purchases / evidence[best].spend - evidence[worst].purchases / evidence[worst].spend;
  const movable = Math.max(0, balances[worst] - remaining * rule.exploration_floor);
  const moved = improvement > 1e-12 ? Math.min(movable, remaining * rule.max_reallocation_fraction) : 0;
  balances[worst] -= moved;
  balances[best] += moved;
  return { before, after: { ...balances }, moved, remaining, reason: moved > 0 ? 'observed_purchase_efficiency' : 'no_eligible_improvement' };
}

export function simulatePath(input, strategy, conditions, adaptive = true, withTrace = false) {
  const allocationTotal = sum(CHANNELS.map(c => strategy.initial_allocation[c]));
  const balances = Object.fromEntries(CHANNELS.map(c => [c, input.budget * strategy.initial_allocation[c] / allocationTotal]));
  const evidence = Object.fromEntries(CHANNELS.map(c => [c, { spend: 0, clicks: 0, purchases: 0 }]));
  const pending = Array.from({ length: 38 }, () => Object.fromEntries(CHANNELS.map(c => [c, 0])));
  const trace = [];
  let totalSpend = 0;
  let totalPurchases = 0;
  for (let day = 1; day <= 30; day++) {
    const daily = {};
    for (const channel of CHANNELS) {
      const a = input.channels[channel];
      const condition = conditions[channel][day - 1];
      const spend = balances[channel] / (31 - day);
      balances[channel] = Math.max(0, balances[channel] - spend);
      totalSpend += spend;
      const clicks = Math.floor(spend / (a.cost_per_click * condition.cost));
      const saturation = 1 / (1 + spend / a.daily_saturation_spend);
      const fatigue = Math.exp(-a.fatigue_per_day * (day - 1));
      const rate = Math.min(1, a.conversion_rate * condition.conversion * saturation * fatigue * CREATIVE_FACTORS[strategy.creative]);
      // Bounded normal approximation to a binomial; explicit MVP approximation.
      const purchases = Math.max(0, Math.min(clicks, Math.round(clicks * rate + condition.purchaseNoise * Math.sqrt(clicks * rate * (1 - rate)))));
      pending[day + a.conversion_delay_days][channel] += purchases;
      evidence[channel].spend += spend;
      evidence[channel].clicks += clicks;
      daily[channel] = { spend, clicks };
    }
    // Only conversions whose delay has elapsed are visible to this checkpoint.
    for (const channel of CHANNELS) {
      evidence[channel].purchases += pending[day][channel];
      totalPurchases += pending[day][channel];
      daily[channel].observed_purchases = pending[day][channel];
    }
    let checkpoint = null;
    if (day % strategy.adaptation.checkpoint_days === 0 && day < 30) {
      checkpoint = reallocate(balances, evidence, { ...strategy.adaptation, enabled: adaptive && strategy.adaptation.enabled });
    }
    if (withTrace) trace.push({ day, daily, observed_evidence: structuredClone(evidence), checkpoint, remaining: { ...balances } });
  }
  // Count late attributed purchases in final outcomes, never in earlier decisions.
  for (let day = 31; day <= 37; day++) totalPurchases += sum(Object.values(pending[day]));
  assert(Math.abs(totalSpend - input.budget) <= Math.max(1e-6, input.budget * 1e-10), 'Internal budget conservation failure', 'SIMULATION_INVARIANT', 500);
  return { spend: input.budget, purchases: totalPurchases, profit: totalPurchases * input.unit_contribution - input.budget, ...(withTrace ? { trace } : {}) };
}

export function quantile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const lo = Math.floor(position);
  const hi = Math.ceil(position);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (position - lo);
}
export function summarize(paths) {
  const n = paths.length;
  const purchases = sum(paths.map(p => p.purchases)) / n;
  const spend = sum(paths.map(p => p.spend)) / n;
  const profits = paths.map(p => p.profit);
  const profit = sum(profits) / n;
  return {
    expected_spend: round(spend), expected_purchases: round(purchases), expected_contribution_profit: round(profit),
    roi: spend === 0 ? null : round(profit / spend), acquisition_cost: purchases === 0 ? null : round(spend / purchases),
    profit_p10: round(quantile(profits, 0.1)), profit_p50: round(quantile(profits, 0.5)), profit_p90: round(quantile(profits, 0.9)),
    profit_stddev: round(Math.sqrt(sum(profits.map(p => (p - profit) ** 2)) / n)), probability_of_loss: round(profits.filter(p => p < 0).length / n)
  };
}
export function evaluate(request) {
  const { input, strategies, scenario_count = 100, seed = 42 } = request.payload;
  checkUniqueStrategies(strategies);
  strategies.forEach(s => checkStrategy(s, input, request.run_id));
  const scenarios = Array.from({ length: scenario_count }, (_, i) => scenarioConditions(input, seed, i));
  const results = strategies.map(strategy => {
    const adaptive = scenarios.map(conditions => simulatePath(input, strategy, conditions, true));
    const fixed = scenarios.map(conditions => simulatePath(input, strategy, conditions, false));
    const deltas = adaptive.map((path, i) => path.profit - fixed[i].profit);
    return { strategy, adaptive: summarize(adaptive), fixed: summarize(fixed), paired_profit_delta: { mean: round(sum(deltas) / deltas.length), p10: round(quantile(deltas, 0.1)), p90: round(quantile(deltas, 0.9)) } };
  });
  const evaluation = {
    run_id: request.run_id, model_version: MODEL_VERSION, input, seed, scenario_count,
    attribution_end_day: 30 + Math.max(...CHANNELS.map(c => input.channels[c].conversion_delay_days)),
    assumptions: [
      ...input.assumptions,
      'A 30-day purchase campaign spends the entire fixed budget; late purchases are attributed through the stated end day.',
      'Channel costs and conversion rates use lognormal scenario and daily shocks; a shared market shock has relative standard deviation 0.15.',
      'Daily cost and conversion shocks have relative standard deviation 0.10. Channels otherwise have independent shocks.',
      'Purchases use a bounded normal approximation to a binomial; low-count forecasts may be biased.',
      'Conversion rate is divided by (1 + daily spend / saturation spend) and multiplied by exp(-fatigue * elapsed days).',
      'Creative multipliers: proof 1.00, discovery 1.08, offer 1.03. These illustrative factors require calibration.',
      'Influencer partnerships are approximated as divisible CPC spend; no discrete booking or cancellation costs are modeled.',
      'No cross-channel attribution overlap, organic baseline, inventory constraints, or automatic model learning is modeled.',
      'Ranges and loss frequencies are conditional simulation results, not calibrated confidence intervals or guarantees.'
    ], results
  };
  evaluation.evaluation_id = `eval-${digest(evaluation)}`;
  validateDefinition('evaluation', evaluation);
  return evaluation;
}
