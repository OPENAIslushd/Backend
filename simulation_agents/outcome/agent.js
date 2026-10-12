import { CHANNELS, assert, digest, checkStrategy, checkUniqueStrategies, scope } from '../shared/core.js';
import { checkRecord, checkTimestamp, compareObservation } from '../shared/records.js';
import { validateUi, validateDefinition } from '../shared/contracts.js';

export function checkEvaluation(evaluation, runId) {
  validateDefinition('evaluation', evaluation);
  assert(evaluation.run_id === runId, 'Evaluation run_id must match the request');
  const { evaluation_id, ...body } = evaluation;
  assert(evaluation_id === `eval-${digest(body)}`, 'Evaluation content does not match its immutable identifier');
  checkUniqueStrategies(evaluation.results.map(r => r.strategy));
  evaluation.results.forEach(r => checkStrategy(r.strategy, evaluation.input, runId));
}
export function distinct(a, b) {
  // Total variation distance: at least 15% of budget assigned differently.
  return CHANNELS.reduce((total, c) => total + Math.abs(a.initial_allocation[c] - b.initial_allocation[c]), 0) / 2 >= 0.15 - 1e-10;
}
export function prepare(evaluation) {
  const profiles = [
    { name: 'conservative', score: m => m.profit_p10, reason: 'Prioritizes the highest tenth-percentile contribution profit.', tradeoff: 'Downside protection under these assumptions may sacrifice upside; losses remain possible.' },
    { name: 'balanced', score: m => m.expected_contribution_profit - 0.5 * m.profit_stddev, reason: 'Maximizes mean contribution profit minus half its standard deviation among distinct remaining options.', tradeoff: 'The risk penalty of 0.5 is an explicit product default, not a measured user preference.' },
    { name: 'high_risk_high_reward', score: m => m.profit_p90, reason: 'Prioritizes ninetieth-percentile contribution profit among distinct remaining options.', tradeoff: 'Upside-focused selection can have substantial loss risk. This profile does not guarantee greater realized profit or measured variance.' }
  ];
  const recommendations = [];
  for (const profile of profiles) {
    const eligible = evaluation.results.filter(result => recommendations.every(chosen => distinct(result.strategy, chosen.strategy)));
    eligible.sort((a, b) => profile.score(b.adaptive) - profile.score(a.adaptive) || a.strategy.strategy_id.localeCompare(b.strategy.strategy_id));
    if (!eligible.length) continue;
    const result = eligible[0];
    recommendations.push({ profile: profile.name, strategy: result.strategy, metrics: result.adaptive, fixed_metrics: result.fixed,
      paired_profit_delta: result.paired_profit_delta, reasons: [profile.reason], tradeoffs: [profile.tradeoff, 'Predictions depend on supplied assumptions and have not been validated against this campaign.'] });
  }
  const warnings = ['Simulation outputs are not observed campaign success. Conservative does not mean guaranteed safe.'];
  if (recommendations.length < 3) warnings.push('Fewer than three candidates meet the 15% allocation-distance requirement; no duplicate options were invented.');
  if (evaluation.input.data_provenance === 'synthetic') warnings.push('Input data is synthetic and must not be presented as real campaign history.');
  if (recommendations.some(r => r.metrics.expected_contribution_profit < 0)) warnings.push('One or more recommended options has negative expected contribution profit.');
  const output = {
    contract_version: '1.0', run_id: evaluation.run_id, ...scope(evaluation.input), evaluation_id: evaluation.evaluation_id,
    model_version: evaluation.model_version, currency: evaluation.input.currency, data_provenance: evaluation.input.data_provenance,
    status: recommendations.length === 3 ? 'complete' : 'insufficient_distinct_candidates', recommendations, warnings,
    definitions: {
      contribution_profit: 'Purchases × contribution per purchase (after variable product costs, before ads) − campaign spend.',
      roi: 'Expected contribution profit / expected campaign spend; a ratio, not a percentage.',
      acquisition_cost: 'Expected campaign spend / expected purchases; null if expected purchases are zero.',
      range: 'Tenth, median, and ninetieth percentiles of scenario contribution profit; not a confidence interval.',
      probability_of_loss: 'Fraction of simulated scenarios with contribution profit below zero, conditional on model assumptions.'
    }, assumptions: evaluation.assumptions
  };
  validateUi(output);
  return output;
}
export function handleOutcome(request) {
  const p = request.payload;
  if (request.action === 'outcome.observe') {
    checkRecord(p.record);
    assert(request.run_id === p.record.run_id, 'Observation must reference the original campaign run');
    const comparison = compareObservation(p.record, p.actual);
    const payload = {
      idempotency_key: `obs-${digest([p.record.selection_id, p.actual.observation_id, p.record.record_revision]).slice(0, 40)}`,
      ...scope(p.record), selection_id: p.record.selection_id, expected_revision: p.record.record_revision, actual: p.actual, comparison
    };
    validateDefinition('updateActual', payload);
    return { proposed_action: 'memory.update_actual', payload };
  }
  checkEvaluation(p.evaluation, request.run_id);
  if (request.action === 'outcome.prepare') return prepare(p.evaluation);
  assert(request.action === 'outcome.select', 'Unsupported outcome action');
  const recommended = prepare(p.evaluation).recommendations;
  const selected = recommended.find(r => r.strategy.strategy_id === p.strategy_id && r.strategy.revision === p.strategy_revision);
  assert(selected, 'Selection must match an exact recommended strategy identifier and revision');
  checkTimestamp(p.selected_at);
  const e = p.evaluation;
  const record = {
    selection_id: p.selection_id, record_revision: 1, ...scope(e.input), run_id: request.run_id, selected_at: p.selected_at,
    selection_kind: 'user_selected', input: e.input, strategy: selected.strategy, evaluation_id: e.evaluation_id, model_version: e.model_version,
    seed: e.seed, scenario_count: e.scenario_count, attribution_end_day: e.attribution_end_day, simulation_assumptions: e.assumptions,
    predicted: selected.metrics, fixed_prediction: selected.fixed_metrics, actual: null, comparison: null
  };
  checkRecord(record);
  return { proposed_action: 'memory.save_selection', payload: { idempotency_key: `sel-${digest([record.business_id, record.product_id, record.selection_id]).slice(0, 40)}`, record } };
}
