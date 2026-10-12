import { assert, sameScope, checkStrategy, round, digest, CHANNELS } from './core.js';
import { validateDefinition } from './contracts.js';

export function checkTimestamp(value) {
  const time = new Date(value);
  assert(Number.isFinite(time.getTime()) && time.toISOString().replace('.000Z', 'Z') === value.replace('.000Z', 'Z'), 'Timestamp must be a real UTC date/time');
}
export function compareObservation(record, actual) {
  assert(actual.currency === record.input.currency, 'Observed and predicted currency must match');
  checkTimestamp(actual.observed_at);
  assert(new Date(actual.observed_at) >= new Date(record.selected_at), 'Observation cannot precede selection');
  const comparable = actual.status === 'final' && actual.attribution_end_day === record.attribution_end_day;
  const profit = actual.purchases * actual.unit_contribution - actual.spend;
  const roi = actual.spend === 0 ? null : profit / actual.spend;
  const prediction = record.predicted;
  const purchasesDelta = actual.purchases - prediction.expected_purchases;
  const profitDelta = profit - prediction.expected_contribution_profit;
  return {
    comparable, reason: comparable ? 'Final observations use the same attribution horizon; differences are descriptive, not causal.' : 'Partial results or a different attribution horizon cannot be compared directly with the full prediction.',
    actual_contribution_profit: round(profit), actual_roi: roi === null ? null : round(roi), actual_acquisition_cost: actual.purchases === 0 ? null : round(actual.spend / actual.purchases),
    purchases_difference: comparable ? round(purchasesDelta) : null, profit_difference: comparable ? round(profitDelta) : null,
    roi_difference: comparable && roi !== null && prediction.roi !== null ? round(roi - prediction.roi) : null,
    purchases_relative_error: comparable && prediction.expected_purchases !== 0 ? round(purchasesDelta / Math.abs(prediction.expected_purchases)) : null,
    profit_relative_error: comparable && prediction.expected_contribution_profit !== 0 ? round(profitDelta / Math.abs(prediction.expected_contribution_profit)) : null
  };
}
export function checkRecord(record) {
  validateDefinition('record', record);
  assert(sameScope(record, record.input), 'Record scope must match saved input');
  checkStrategy(record.strategy, record.input, record.run_id);
  checkTimestamp(record.selected_at);
  assert(record.attribution_end_day === 30 + Math.max(...CHANNELS.map(c => record.input.channels[c].conversion_delay_days)), 'Record attribution horizon must match input');
  assert(Math.abs(record.predicted.expected_spend - record.input.budget) < 1e-5, 'Saved prediction must use the selected campaign budget');
  assert((record.actual === null) === (record.comparison === null), 'Actual results and comparison must both be present or both null');
  if (record.actual !== null) assert(digest(record.comparison) === digest(compareObservation(record, record.actual)), 'Saved comparison does not match observed results');
}
