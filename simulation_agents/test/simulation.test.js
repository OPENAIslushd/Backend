import test from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../strategy/agent.js';
import { evaluate, scenarioConditions, simulatePath, reallocate, summarize } from '../simulation/agent.js';
import { CHANNELS } from '../shared/core.js';
import { fixture, envelope } from './helpers.js';

test('every path conserves budget; every checkpoint respects movement and exploration limits', () => {
  const request = fixture();
  const input = request.payload.input;
  const strategies = generate(request).strategies.slice(0, 15);
  for (let seed = 0; seed < 5; seed++) {
    for (const strategy of strategies) {
      const path = simulatePath(input, strategy, scenarioConditions(input, seed, 0), true, true);
      const spent = path.trace.flatMap(day => Object.values(day.daily).map(c => c.spend)).reduce((a, b) => a + b, 0);
      assert.ok(Math.abs(spent - input.budget) < 1e-6);
      for (const day of path.trace) {
        assert.ok(CHANNELS.every(c => day.remaining[c] >= 0));
        const cp = day.checkpoint;
        if (!cp) continue;
        assert.ok(cp.moved <= cp.remaining * strategy.adaptation.max_reallocation_fraction + 1e-7);
        assert.ok(CHANNELS.every(c => cp.after[c] >= cp.remaining * strategy.adaptation.exploration_floor - 1e-7));
        const before = Object.values(cp.before).reduce((a, b) => a + b, 0);
        const after = Object.values(cp.after).reduce((a, b) => a + b, 0);
        assert.ok(Math.abs(before - after) < 1e-7);
      }
    }
  }
});

test('reallocation requires matured evidence and moves at most twenty percent', () => {
  const rule = generate(fixture()).strategies[1].adaptation;
  const balances = { paid_social: 500, paid_search: 300, influencer: 200 };
  const evidence = {
    paid_social: { clicks: 100, purchases: 3, spend: 500 },
    paid_search: { clicks: 100, purchases: 30, spend: 300 },
    influencer: { clicks: 100, purchases: 5, spend: 200 }
  };
  const blocked = structuredClone(evidence);
  blocked.influencer.purchases = 0;
  assert.equal(reallocate({ ...balances }, blocked, rule).moved, 0);
  const cp = reallocate({ ...balances }, evidence, rule);
  assert.equal(cp.moved, 200);
  assert.equal(cp.after.paid_social, 300);
  assert.equal(cp.after.paid_search, 500);
});

test('future scenario changes cannot alter earlier decisions or observations', () => {
  const request = fixture();
  const strategy = generate(request).strategies[0];
  const conditions = scenarioConditions(request.payload.input, 2, 0);
  const changed = structuredClone(conditions);
  for (const channel of CHANNELS) for (let day = 15; day < 30; day++) changed[channel][day].conversion *= 100;
  const before = simulatePath(request.payload.input, strategy, conditions, true, true);
  const after = simulatePath(request.payload.input, strategy, changed, true, true);
  assert.deepEqual(before.trace.slice(0, 15), after.trace.slice(0, 15));
});

test('delayed conversions are invisible before arrival, including at adaptation checkpoints', () => {
  const request = fixture();
  for (const c of CHANNELS) request.payload.input.channels[c].conversion_delay_days = 7;
  const strategy = generate(request).strategies[0];
  const path = simulatePath(request.payload.input, strategy, scenarioConditions(request.payload.input, 42, 1), true, true);
  for (const day of path.trace.slice(0, 7)) {
    assert.ok(CHANNELS.every(c => day.observed_evidence[c].purchases === 0));
    if (day.checkpoint) assert.equal(day.checkpoint.moved, 0);
  }
});

test('fixed/adaptive pairing is deterministic, order invariant, and identical when disabled', () => {
  const request = fixture();
  const strategies = generate(request).strategies.slice(0, 3);
  strategies[0].adaptation.enabled = false;
  const input = request.payload.input;
  const first = evaluate(envelope('simulation.evaluate', { input, strategies, scenario_count: 20, seed: 42 }));
  assert.deepEqual(first.results[0].adaptive, first.results[0].fixed);
  assert.deepEqual(first.results[0].paired_profit_delta, { mean: 0, p10: 0, p90: 0 });
  const second = evaluate(envelope('simulation.evaluate', { input, strategies: [...strategies].reverse(), scenario_count: 20, seed: 42 }));
  assert.deepEqual(first.results, second.results.reverse());
  assert.deepEqual(first, evaluate(envelope('simulation.evaluate', { input, strategies, scenario_count: 20, seed: 42 })));
});

test('invalid allocation, mismatched scope, duplicate revision are rejected', () => {
  const request = fixture();
  const strategy = generate(request).strategies[0];
  const run = strategies => evaluate(envelope('simulation.evaluate', { input: request.payload.input, strategies, scenario_count: 20 }));
  assert.throws(() => run([strategy, strategy]));
  assert.throws(() => run([{ ...strategy, product_id: 'other' }]));
  assert.throws(() => run([{ ...strategy, initial_allocation: { paid_social: 0.8, paid_search: 0.2, influencer: 0.2 } }]));
});

test('zero purchases produces finite loss metrics and null acquisition cost', () => {
  const metrics = summarize([{ spend: 100, purchases: 0, profit: -100 }, { spend: 100, purchases: 0, profit: -100 }]);
  assert.equal(metrics.acquisition_cost, null);
  assert.equal(metrics.roi, -1);
  assert.equal(metrics.probability_of_loss, 1);
  assert.equal(metrics.profit_stddev, 0);
});
