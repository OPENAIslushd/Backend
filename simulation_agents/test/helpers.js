import { readFileSync } from 'node:fs';
import { generate } from '../strategy/agent.js';
import { evaluate } from '../simulation/agent.js';
import { handleOutcome } from '../outcome/agent.js';
import { validateRequest } from '../shared/contracts.js';

export function fixture() {
  return JSON.parse(readFileSync(new URL('./fixtures/generate-request.json', import.meta.url), 'utf8'));
}
export function envelope(action, payload, runId = 'run-synthetic-demo') {
  return validateRequest({ contract_version: '1.0', request_id: `request-${action}`, run_id: runId, action, payload });
}
export function evaluationFixture() {
  const request = fixture();
  const { strategies } = generate(request);
  return evaluate(envelope('simulation.evaluate', { input: request.payload.input, strategies: strategies.slice(0, 12), scenario_count: 20, seed: 42 }));
}
export function selectionFixture(evaluation = evaluationFixture(), selectionId = 'selection-synthetic') {
  const ui = handleOutcome(envelope('outcome.prepare', { evaluation }));
  const selected = ui.recommendations[0].strategy;
  return handleOutcome(envelope('outcome.select', { evaluation, strategy_id: selected.strategy_id, strategy_revision: selected.revision, selection_id: selectionId, selected_at: '2026-10-01T12:00:00Z' }));
}
export function actualFixture(record, overrides = {}) {
  return {
    observation_id: 'observation-synthetic-final', observed_at: '2026-11-10T12:00:00Z', source: 'SYNTHETIC TEST OBSERVATION, not actual business results',
    status: 'final', attribution_end_day: record.attribution_end_day, spend: record.input.budget, purchases: 280, unit_contribution: record.input.unit_contribution,
    currency: record.input.currency, ...overrides
  };
}
