import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, envelope } from '../helpers.js';
import { call } from './client.js';

test('selection and observed results survive memory container recreation', async () => {
  const input = fixture().payload.input;
  const history = await call(envelope('memory.retrieve', { business_id: input.business_id, product_id: input.product_id }));
  assert.equal(history.records.length, 1);
  assert.equal(history.records[0].selection_id, 'selection-container-persistence');
  assert.equal(history.records[0].record_revision, 2);
  assert.equal(history.records[0].actual.purchases, 280);
  assert.equal(history.records[0].comparison.comparable, true);
});
