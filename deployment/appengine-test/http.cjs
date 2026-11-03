'use strict';
const { fail, status, ORIGIN, requestValid, withinBudget } = require('./policy.cjs');
function readBody(request, context) {
  return new Promise((resolve, reject) => {
    let size = 0, chunks = [], done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      request.removeListener('data', data); request.removeListener('end', end);
      request.removeListener('aborted', aborted); request.removeListener('error', aborted);
      context.signal.removeEventListener('abort', timeout);
      request.resume();
      error ? reject(error) : resolve(value);
    };
    const data = chunk => {
      size += chunk.length;
      if (size > 1024) finish(fail('payload-too-large'));
      else chunks.push(chunk);
    };
    const end = () => {
      try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); finish(null, value); }
      catch { finish(fail('invalid-request')); }
      chunks = [];
    };
    const aborted = () => finish(fail('invalid-request'));
    const timeout = () => { try { context.active(); } catch (error) { finish(error); } };
    request.on('data', data); request.once('end', end); request.once('aborted', aborted); request.once('error', aborted);
    context.signal.addEventListener('abort', timeout, { once: true });
    if (Number(request.headers['content-length']) > 1024) finish(fail('payload-too-large'));
  });
}
function createHandler({ getService, origin = ORIGIN, budgetMs = 30000 }) {
  return async (request, response) => {
    const send = (code, body) => {
      if (response.destroyed || response.writableEnded) return;
      response.writeHead(code, {
        'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex, nofollow, noarchive', 'X-Content-Type-Options': 'nosniff',
        ...(code === 405 ? { Allow: 'POST' } : {}),
      });
      response.end(request.method === 'HEAD' ? undefined : JSON.stringify(body));
    };
    try {
      const result = await withinBudget(async context => {
        if (request.url !== '/api/event-creations') throw fail('not-found');
        if (request.method !== 'POST') throw fail('method-not-allowed');
        if (request.headers.origin !== origin) throw fail('origin-forbidden');
        if (typeof request.headers['content-type'] !== 'string' || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'])) throw fail('unsupported-media-type');
        const authorization = request.headers.authorization;
        if (typeof authorization !== 'string' || !/^Bearer [A-Za-z0-9._-]+$/.test(authorization) || authorization.length > 16384) throw fail('unauthenticated');
        const input = await readBody(request, context);
        context.active();
        if (!requestValid(input)) throw fail('invalid-request');
        const service = await getService(context);
        context.active();
        return service.create(authorization.slice(7), input, context);
      }, budgetMs);
      send(result.status === 'created' ? 201 : 200, result);
    } catch (error) {
      const code = Object.hasOwn(status, error?.code) ? error.code : 'service-unavailable';
      send(status[code], { error: code });
    } finally { request.resume(); }
  };
}
module.exports = { createHandler };
