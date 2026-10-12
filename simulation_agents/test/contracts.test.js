import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateRequest, validateUi, validateDefinition } from '../shared/contracts.js';
import { handleOutcome } from '../outcome/agent.js';
import { fixture, envelope, evaluationFixture, selectionFixture, actualFixture } from './helpers.js';

test('both shareable schemas compile and every action has a valid handoff example', () => {
  validateRequest(fixture());
  validateUi(JSON.parse(readFileSync(new URL('../contracts/examples/ui-insufficient.json', import.meta.url), 'utf8')));
  const evaluation = evaluationFixture();
  const selected = selectionFixture(evaluation);
  const record = selected.payload.record;
  const ui = handleOutcome(envelope('outcome.prepare', { evaluation }));
  validateUi(ui);
  validateDefinition('record', record);
  envelope('memory.retrieve', { business_id: record.business_id, product_id: record.product_id });
  envelope(selected.proposed_action, selected.payload);
  const observation = envelope('outcome.observe', { record, actual: actualFixture(record) });
  const update = handleOutcome(observation);
  envelope(update.proposed_action, update.payload);
});

test('reject missing fields, wrong versions, unknown actions and extra historical outcome fields', () => {
  const mutations = [
    r => delete r.request_id,
    r => { r.contract_version = '2.0'; },
    r => { r.action = 'strategy.query_memory'; },
    r => { r.payload.candidate_count = 99; },
    r => { r.payload.candidate_count = 201; },
    r => { r.payload.input.actual_results = { purchases: 900 }; },
    r => { r.payload.input.history = []; },
    r => { r.payload.input.budget = null; },
    r => { r.payload.input.channels.paid_social.conversion_delay_days = 8; },
    r => { r.payload.input.channels.paid_social.conversion_rate = -1; },
    r => { r.payload.input.currency = 'usd'; }
  ];
  for (const mutate of mutations) {
    const request = fixture();
    mutate(request);
    assert.throws(() => validateRequest(request), { code: 'CONTRACT_VALIDATION' });
  }
});

test('null acquisition cost is valid for zero purchases; nonnumeric unknowns are rejected', () => {
  const evaluation = evaluationFixture();
  const metrics = { ...evaluation.results[0].adaptive, expected_purchases: 0, acquisition_cost: null };
  validateDefinition('metrics', metrics);
  assert.throws(() => validateDefinition('metrics', { ...metrics, acquisition_cost: 'unknown' }));
});
