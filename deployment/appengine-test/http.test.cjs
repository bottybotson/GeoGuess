'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const { test } = require('node:test');
const { createServer } = require('./server.cjs');
const { createCreationService } = require('./creation.cjs');
const { ORIGIN } = require('./policy.cjs');
const { fixture, input, deferred } = require('./test-fixtures.cjs');
async function listening(t, options = {}) {
  const f = fixture(); let loads = 0;
  const server = createServer({ runtime: { async getService() { loads++; return createCreationService(f); } }, ...options });
  server.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return { f, server, loads: () => loads, port: server.address().port };
}
function call(port, { path = '/api/event-creations', method = 'POST', headers = {}, body = JSON.stringify(input), raw = false } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path, method,
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json', Authorization: 'Bearer synthetic.token', 'Content-Length': Buffer.byteLength(body), ...headers } }, response => {
      let data = ''; response.setEncoding('utf8'); response.on('data', chunk => data += chunk);
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, data,
        body: data && !raw ? JSON.parse(data) : undefined }));
    });
    request.on('error', reject); request.end(body);
  });
}
function safe(response, expectedStatus, error) {
  assert.equal(response.status, expectedStatus); assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['x-content-type-options'], 'nosniff'); assert.match(response.headers['x-robots-tag'], /noindex/);
  assert.match(response.headers['content-type'], /application\/json/);
  assert.equal(response.headers['access-control-allow-origin'], undefined);
  if (error) assert.deepEqual(response.body, { error });
}
test('actual server gives canonical created/replayed JSON and fixed no-store errors without private data', async t => {
  const { port, f } = await listening(t);
  const created = await call(port); safe(created, 201); assert.equal(created.body.status, 'created');
  const replay = await call(port); safe(replay, 200); assert.equal(replay.body.status, 'already-created');
  assert.deepEqual(replay.body.links, created.body.links); assert.equal(f.events.size, 2);
  f.auth.verifyIdToken = async () => { throw new Error('SECRET INTERNAL PROVIDER'); };
  const failure = await call(port); safe(failure, 401, 'unauthenticated'); assert.equal(failure.data.includes('SECRET'), false);
});

test('actual methods and API-looking asset/SPA paths never return HTML or initialize Admin', async t => {
  const { port, loads } = await listening(t);
  for (const method of ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE', 'PATCH']) {
    const response = await call(port, { method }); safe(response, 405);
    assert.equal(response.headers.allow, 'POST');
    if (method === 'HEAD') assert.equal(response.data, '');
    else assert.deepEqual(response.body, { error: 'method-not-allowed' });
  }
  for (const path of ['/api', '/api/', '/api/a.json', '/api/event-creations.json', '/api/event-creations?source=x', '/js/app.js', '/event/example/host', '/']) {
    safe(await call(port, { path }), 404, 'not-found');
  }
  assert.equal(loads(), 0);
});

test('request bounds and supplementary origin checks reject before SDK initialization', async t => {
  const { port, loads } = await listening(t);
  for (const headers of [{ Origin: 'https://evil.invalid' }, { Origin: '' }, { Origin: `${ORIGIN}/` }, { Origin: 'null', 'X-Forwarded-Host': 'customgeoguess.ew.r.appspot.com' }]) {
    safe(await call(port, { headers }), 403, 'origin-forbidden');
  }
  for (const headers of [{ 'Content-Type': 'text/plain' }, { 'Content-Type': '' }, { 'Content-Type': 'application/json; extra=true' }]) {
    safe(await call(port, { headers }), 415, 'unsupported-media-type');
  }
  for (const headers of [{ Authorization: '' }, { Authorization: 'Basic abc' }, { Authorization: 'Bearer abc def' }, { Authorization: '', Cookie: 'session=synthetic' }]) {
    safe(await call(port, { headers }), 401, 'unauthenticated');
  }
  for (const body of ['', '{', '[]', 'null', JSON.stringify({ ...input, eventId: 'chosen' }), JSON.stringify({ ...input, requestId: 'A'.repeat(32) }), JSON.stringify({ ...input, sourceEventId: '../source' }), JSON.stringify({ ...input, requestId: 'a'.repeat(31) })]) {
    safe(await call(port, { body }), 400, 'invalid-request');
  }
  safe(await call(port, { body: 'x'.repeat(1025) }), 413, 'payload-too-large');
  safe(await call(port, { body: 'x'.repeat(1025), headers: { 'Content-Length': '1025' } }), 413, 'payload-too-large');
  assert.equal(loads(), 0);
  safe(await call(port, { body: `${JSON.stringify(input)}${' '.repeat(1024 - JSON.stringify(input).length)}`, headers: { 'Content-Type': 'application/json; charset=utf-8', Host: 'forged.invalid', 'X-Forwarded-For': '203.0.113.2' } }), 201);
});

test('slow request bodies share the overall deadline and do not load the runtime', async t => {
  const { port, loads } = await listening(t, { budgetMs: 20 });
  const response = await new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path: '/api/event-creations', method: 'POST',
      headers: { Origin: ORIGIN, Authorization: 'Bearer token', 'Content-Type': 'application/json' } }, result => {
      let data = ''; result.on('data', chunk => data += chunk); result.on('end', () => { request.end(); resolve({ status: result.statusCode, headers: result.headers, body: JSON.parse(data) }); });
    });
    request.on('error', reject); request.write('{');
  });
  safe(response, 503, 'service-unavailable'); assert.equal(loads(), 0);
});

test('deadline encompasses runtime initialization and late rejection is safely tracked', async t => {
  const wait = deferred();
  const { port } = await listening(t, { budgetMs: 10, runtime: { getService: () => wait.promise } });
  safe(await call(port), 503, 'service-unavailable');
  wait.reject(new Error('provider-private-details')); await new Promise(resolve => setImmediate(resolve));
});
