'use strict';
const { createHandler } = require('./http.cjs');
const { createRuntime } = require('./runtime.cjs');
function createServer(options = {}) {
  const runtime = options.runtime || createRuntime();
  const server = require('node:http').createServer(createHandler({ getService: context => runtime.getService(context), ...options }));
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  return server;
}
if (require.main === module) createServer().listen(Number(process.env.PORT || 8080), '0.0.0.0');
module.exports = { createServer };
