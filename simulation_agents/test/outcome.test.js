import test from 'node:test';
import assert from 'node:assert/strict';
import { handleOutcome, distinct } from '../outcome/agent.js';
import { digest } from '../shared/core.js';
import { compareObservation } from '../shared/records.js';
import { envelope, evaluationFixture, selectionFixture, actualFixture } from './helpers.js';

test('three recommendations have distinct allocations, risk reasons and complete metrics', () => {
  const evaluation = evaluationFixture();
  const ui = handleOutcome(envelope('outcome.prepare', { evaluation }));
  assert.equal(ui.status, 'complete');
  assert.deepEqual(ui.recommendations.map(r => r.profile), ['conservative', 'balanced', 'high_risk_high_reward']);
  for (let i = 0; i < ui.recommendations.length; i++) {
    for (let j = i + 1; j < ui.recommendations.length; j++) assert.ok(distinct(ui.recommendations[i].strategy, ui.recommendations[j].strategy));
    assert.ok(ui.recommendations[i].reasons.length);
    assert.ok(ui.recommendations[i].tradeoffs.length);
    assert.equal(typeof ui.recommendations[i].metrics.probability_of_loss, 'number');
  }
  const bestP10 = Math.max(...evaluation.results.map(r => r.adaptive.profit_p10));
  assert.equal(ui.recommendations[0].metrics.profit_p10, bestP10);
});

test('fewer distinct candidates are reported without filling duplicate recommendation slots', () => {
  const evaluation = evaluationFixture();
  evaluation.results = evaluation.results.slice(0, 1);
  delete evaluation.evaluation_id;
  evaluation.evaluation_id = `eval-${digest(evaluation)}`;
  const ui = handleOutcome(envelope('outcome.prepare', { evaluation }));
  assert.equal(ui.status, 'insufficient_distinct_candidates');
  assert.equal(ui.recommendations.length, 1);
});

test('selection snapshots exact input, strategy, evaluation, predictions and unknown actuals', () => {
  const evaluation = evaluationFixture();
  const proposal = selectionFixture(evaluation);
  const record = proposal.payload.record;
  assert.equal(proposal.proposed_action, 'memory.save_selection');
  assert.equal(record.evaluation_id, evaluation.evaluation_id);
  assert.deepEqual(record.input, evaluation.input);
  assert.equal(record.strategy.revision, 1);
  assert.equal(record.actual, null);
  assert.equal(record.comparison, null);
  const selected = record.strategy;
  assert.throws(() => handleOutcome(envelope('outcome.select', {
    evaluation, strategy_id: selected.strategy_id, strategy_revision: 2, selection_id: 'different', selected_at: record.selected_at
  })), /exact recommended/);
  const changed = structuredClone(evaluation);
  changed.results[0].adaptive.expected_contribution_profit += 1;
  assert.throws(() => handleOutcome(envelope('outcome.prepare', { evaluation: changed })), /immutable identifier/);
});

test('final actual results compare like horizons and partial results have null differences', () => {
  const record = selectionFixture().payload.record;
  const actual = actualFixture(record);
  const proposed = handleOutcome(envelope('outcome.observe', { record, actual }));
  const comparison = proposed.payload.comparison;
  assert.equal(comparison.comparable, true);
  assert.equal(comparison.actual_contribution_profit, actual.purchases * actual.unit_contribution - actual.spend);
  assert.equal(record.actual, null, 'outcome must not mutate the record it was given');
  for (const update of [{ status: 'partial' }, { attribution_end_day: 30 }]) {
    const partial = compareObservation(record, { ...actual, ...update });
    assert.equal(partial.comparable, false);
    assert.equal(partial.profit_difference, null);
  }
  const zero = compareObservation(record, { ...actual, spend: 0, purchases: 0 });
  assert.equal(zero.actual_roi, null);
  assert.equal(zero.actual_acquisition_cost, null);
  assert.throws(() => compareObservation(record, { ...actual, currency: 'EUR' }));
  assert.throws(() => compareObservation(record, { ...actual, observed_at: '2026-02-30T12:00:00Z' }));
});
