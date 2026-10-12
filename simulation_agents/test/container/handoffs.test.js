import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, envelope, actualFixture } from '../helpers.js';
import { validateUi } from '../../shared/contracts.js';
import { call } from './client.js';

// This test client only forwards handoffs. It is not an Astra implementation or audit engine.
test('mock orchestrator exercises all eight actions across four containers', async () => {
  const request = fixture();
  const input = request.payload.input;
  const scope = { business_id: input.business_id, product_id: input.product_id };
  const initial = await call(envelope('memory.retrieve', scope));
  assert.equal(initial.records.length, 0);
  const generated = await call(request);
  assert.equal(generated.strategies.length, 100);
  const evaluation = await call(envelope('simulation.evaluate', { input, strategies: generated.strategies, scenario_count: 20, seed: 42 }));
  const ui = await call(envelope('outcome.prepare', { evaluation }));
  validateUi(ui);
  assert.equal(ui.recommendations.length, 3);
  const strategy = ui.recommendations[0].strategy;
  const selection = await call(envelope('outcome.select', {
    evaluation, strategy_id: strategy.strategy_id, strategy_revision: strategy.revision,
    selection_id: 'selection-container-persistence', selected_at: '2026-10-01T12:00:00Z'
  }));
  const saved = await call(envelope(selection.proposed_action, selection.payload));
  const retry = await call(envelope(selection.proposed_action, selection.payload));
  assert.deepEqual(saved, retry);
  const actual = actualFixture(saved.record);
  const observation = await call(envelope('outcome.observe', { record: saved.record, actual }));
  const updated = await call(envelope(observation.proposed_action, observation.payload));
  assert.equal(updated.record.record_revision, 2);
  assert.equal(updated.record.comparison.comparable, true);
  assert.deepEqual(await call(envelope(observation.proposed_action, observation.payload)), updated);
  const history = await call(envelope('memory.retrieve', scope));
  assert.equal(history.records.length, 1);
  assert.equal(history.records[0].selection_id, 'selection-container-persistence');
  const other = await call(envelope('memory.retrieve', { ...scope, business_id: 'different-business' }));
  assert.equal(other.records.length, 0);
});
