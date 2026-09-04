// Test doubles for the HTTP layer, plus fixture replay.
import { Readable } from 'node:stream';
import { readFileSync } from 'node:fs';

export function mockRequest({ method = 'POST', url = '/v1/ingest', token, body } = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body ?? {});
  const req = Readable.from([Buffer.from(payload)]);
  req.method = method;
  req.url = url;
  req.headers = { 'content-type': 'application/json' };
  if (token) req.headers.authorization = `Bearer ${token}`;
  return req;
}

export function mockResponse() {
  const res = {
    statusCode: null,
    headers: {},
    body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    writeHead(status, headers = {}) {
      this.statusCode = status;
      for (const [k, v] of Object.entries(headers)) this.headers[k.toLowerCase()] = v;
      return this;
    },
    end(chunk) { if (chunk) this.body += chunk; this.done = true; },
    json() { return JSON.parse(this.body); },
  };
  return res;
}

export function loadFixture(path) {
  return readFileSync(path, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
}

/**
 * Push every payload the collector produced through the real ingest handler.
 * The clock follows the fixture rather than the wall so a recorded day replays
 * without tripping the skew guard.
 */
export async function replayFixture(handler, payloads, token) {
  let ok = 0, stored = 0, rejected = 0;
  for (const payload of payloads) {
    const latest = payload.samples?.reduce((m, s) => Math.max(m, s.wall || 0), 0) || 0;
    const req = mockRequest({ token, body: payload });
    const res = mockResponse();
    // The handler reads its clock at call time; point it at the fixture's own
    // moment so skew validation behaves as it would in production.
    handler.setClock?.(latest);
    await handler(req, res);
    if (res.statusCode === 200) { ok++; stored += res.json().stored; } else rejected++;
  }
  return { ok, stored, rejected };
}
