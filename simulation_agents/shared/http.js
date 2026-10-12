import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { validateRequest } from './contracts.js';
import { ServiceError } from './core.js';

const MAX_BODY_BYTES = 24 * 1024 * 1024;
export function createService(service, handler, { token = process.env.SERVICE_TOKEN } = {}) {
  if (!token || token.length < 16) throw new Error('SERVICE_TOKEN of at least 16 characters is required');
  return http.createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET' && req.url === '/health') return send(200, { service, status: 'ok', contract_version: '1.0' });
    let envelope;
    try {
      if (req.method !== 'POST' || req.url !== '/v1/execute') throw new ServiceError('NOT_FOUND', 'Use POST /v1/execute', 404);
      const supplied = Buffer.from(req.headers.authorization ?? '');
      const expected = Buffer.from(`Bearer ${token}`);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new ServiceError('UNAUTHORIZED', 'A valid service token is required', 401);
      if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw new ServiceError('CONTENT_TYPE', 'Use application/json', 415);
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) throw new ServiceError('BODY_TOO_LARGE', 'Request exceeds 24 MiB', 413);
        chunks.push(chunk);
      }
      try { envelope = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw new ServiceError('INVALID_JSON', 'Request body must be valid JSON'); }
      validateRequest(envelope);
      if (!envelope.action.startsWith(`${service}.`)) throw new ServiceError('WRONG_SERVICE', `Action must be routed to its owning service`);
      const data = await handler(envelope);
      send(200, { contract_version: '1.0', request_id: envelope.request_id, run_id: envelope.run_id, action: envelope.action, data });
    } catch (error) {
      const known = error instanceof ServiceError;
      if (!known) console.error(JSON.stringify({ service, error: error.name, message: error.message }));
      send(known ? error.status : 500, {
        contract_version: '1.0', request_id: typeof envelope?.request_id === 'string' ? envelope.request_id : null,
        error: { code: known ? error.code : 'INTERNAL_ERROR', message: known ? error.message : 'Internal service error', ...(known && error.details ? { details: error.details } : {}) }
      });
    }
  });
}
export function start(service, handler, close = () => {}) {
  const server = createService(service, handler);
  server.requestTimeout = 120_000;
  server.headersTimeout = 15_000;
  server.listen(Number(process.env.PORT ?? 8080), '0.0.0.0');
  const shutdown = () => server.close(() => { close(); process.exit(0); });
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  return server;
}
