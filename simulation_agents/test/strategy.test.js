import test from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../strategy/agent.js';
import { checkStrategy, CHANNELS } from '../shared/core.js';
import { fixture } from './helpers.js';

test('deterministic generator returns 100–200 diverse, valid and traceable strategies', () => {
  const request = fixture();
  request.payload.candidate_count = 200;
  const result = generate(request);
  assert.equal(result.strategies.length, 200);
  assert.equal(new Set(result.strategies.map(s => s.strategy_id)).size, 200);
  assert.equal(new Set(result.strategies.map(s => JSON.stringify(s.initial_allocation))).size, 200);
  assert.deepEqual(result, generate(request));
  for (const strategy of result.strategies) {
    checkStrategy(strategy, request.payload.input, request.run_id);
    assert.equal(strategy.generator, 'deterministic-diversity-v1');
    assert.ok(CHANNELS.every(c => strategy.initial_allocation[c] >= 0.1));
  }
  const revision = generate({ ...request, payload: { ...request.payload, revision: 2 } });
  assert.equal(revision.strategies[0].strategy_id, result.strategies[0].strategy_id);
  assert.equal(revision.strategies[0].revision, 2);
});

test('self-contained context changes strategy identity and there is no raw-history input', () => {
  const request = fixture();
  const first = generate(request);
  request.payload.input.context = 'A different Orchestrator-supplied instruction';
  assert.notEqual(generate(request).strategies[0].strategy_id, first.strategies[0].strategy_id);
});
