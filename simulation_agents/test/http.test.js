import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createService } from '../shared/http.js';
import { generate } from '../strategy/agent.js';
import { fixture, envelope } from './helpers.js';

test('HTTP boundary authenticates, validates requests and enforces action ownership', async t => {
  const token = 'synthetic-test-service-token';
  const server = createService('strategy', generate, { token });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body, headers = {}) => fetch(`${base}/v1/execute`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.equal((await post(fixture(), { Authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await post('{')).status, 400);
  assert.equal((await post(fixture(), { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await post(envelope('memory.retrieve', { business_id: 'business', product_id: 'product' }))).status, 400);
  const success = await post(fixture());
  assert.equal(success.status, 200);
  const body = await success.json();
  assert.equal(body.request_id, fixture().request_id);
  assert.equal(body.run_id, fixture().run_id);
  assert.equal(body.data.strategies.length, 100);
});
