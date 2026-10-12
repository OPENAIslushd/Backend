import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryStore } from '../memory/store.js';
import { handleOutcome } from '../outcome/agent.js';
import { envelope, selectionFixture, actualFixture } from './helpers.js';

test('last ten records are selected-time ordered and scoped by business AND product; persistence survives reopen', t => {
  const directory = mkdtempSync(join(tmpdir(), 'simulation-memory-'));
  const path = join(directory, 'memory.sqlite');
  let store = new MemoryStore(path);
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  const base = selectionFixture().payload.record;
  for (let i = 0; i < 12; i++) {
    const record = structuredClone(base);
    record.selection_id = `selection-${String(i).padStart(2, '0')}`;
    record.run_id = `run-${i}`;
    record.strategy.run_id = record.run_id;
    record.selected_at = `2026-10-${String(i + 1).padStart(2, '0')}T12:00:00Z`;
    store.handle(envelope('memory.save_selection', { idempotency_key: `key-${i}`, record }, record.run_id));
  }
  for (const [business, product] of [['other-business', base.product_id], [base.business_id, 'other-product']]) {
    const record = structuredClone(base);
    for (const value of [record, record.input, record.strategy]) {
      value.business_id = business;
      value.product_id = product;
    }
    store.handle(envelope('memory.save_selection', { idempotency_key: 'other-key', record }));
  }
  store.close();
  store = new MemoryStore(path);
  const history = store.handle(envelope('memory.retrieve', { business_id: base.business_id, product_id: base.product_id }));
  assert.equal(history.records.length, 10);
  assert.equal(history.records[0].selection_id, 'selection-11');
  assert.equal(history.records.at(-1).selection_id, 'selection-02');
  assert.ok(history.records.every(r => r.business_id === base.business_id && r.product_id === base.product_id));
  const oldest = store.handle(envelope('memory.retrieve', { business_id: base.business_id, product_id: base.product_id, selection_id: 'selection-00' }));
  assert.equal(oldest.records[0].selection_id, 'selection-00');
  assert.equal(oldest.limit, 1);
});

test('atomic selection writes handle retries, changed keys, duplicates and conflicting content', t => {
  const store = new MemoryStore(':memory:');
  t.after(() => store.close());
  const proposal = selectionFixture();
  const request = envelope(proposal.proposed_action, proposal.payload);
  const first = store.handle(request);
  assert.deepEqual(store.handle({ ...request, request_id: 'retry-new-request-id' }), first);
  assert.deepEqual(store.handle({ ...request, payload: { ...request.payload, idempotency_key: 'another-key' } }), first);
  const conflicting = structuredClone(request);
  conflicting.payload.record.selected_at = '2026-10-02T12:00:00Z';
  assert.throws(() => store.handle(conflicting), { code: 'IDEMPOTENCY_CONFLICT' });
  conflicting.payload.idempotency_key = 'fresh-key';
  assert.throws(() => store.handle(conflicting), { code: 'SELECTION_CONFLICT' });
  const duplicate = structuredClone(request);
  duplicate.payload.idempotency_key = 'duplicate-key';
  duplicate.payload.record.selection_id = 'duplicate-selection';
  assert.throws(() => store.handle(duplicate), { code: 'SELECTION_CONFLICT' });
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM selections').get().n, 1);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM record_versions').get().n, 1);
});

test('observations preserve snapshots, require fresh revisions and cannot corrupt comparisons', t => {
  const store = new MemoryStore(':memory:');
  t.after(() => store.close());
  const proposal = selectionFixture();
  const original = store.handle(envelope(proposal.proposed_action, proposal.payload)).record;
  const observation = handleOutcome(envelope('outcome.observe', { record: original, actual: actualFixture(original) }));
  const update = envelope(observation.proposed_action, observation.payload);
  const saved = store.handle(update);
  assert.equal(saved.record.record_revision, 2);
  assert.deepEqual(saved.record.predicted, original.predicted);
  assert.deepEqual(store.handle(update), saved);
  assert.deepEqual(store.handle({ ...update, payload: { ...update.payload, idempotency_key: 'different-observation-retry' } }), saved);
  const refreshedProposal = handleOutcome(envelope('outcome.observe', { record: saved.record, actual: saved.record.actual }));
  assert.deepEqual(store.handle(envelope(refreshedProposal.proposed_action, refreshedProposal.payload)), saved);
  const changed = structuredClone(update);
  changed.payload.idempotency_key = 'fresh-observation';
  changed.payload.actual.observation_id = 'observation-next';
  assert.throws(() => store.handle(changed), { code: 'REVISION_CONFLICT' });
  changed.payload.expected_revision = 2;
  changed.payload.comparison.profit_difference += 1;
  assert.throws(() => store.handle(changed), /inconsistent/);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM record_versions').get().n, 2);
  const wrongScope = structuredClone(update);
  wrongScope.payload.business_id = 'not-this-business';
  assert.throws(() => store.handle(wrongScope), { code: 'NOT_FOUND' });
});
