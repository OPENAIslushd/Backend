import assert from 'node:assert/strict';
const ports = { memory: 8081, strategy: 8082, simulation: 8083, outcome: 8084 };
export async function call(request) {
  const service = request.action.split('.')[0];
  const response = await fetch(`http://127.0.0.1:${ports[service]}/v1/execute`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.SERVICE_TOKEN}` },
    body: JSON.stringify(request), signal: AbortSignal.timeout(180000)
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.request_id, request.request_id);
  assert.equal(body.run_id, request.run_id);
  return body.data;
}
