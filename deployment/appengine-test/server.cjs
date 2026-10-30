'use strict';
// Static handlers serve the frontend; no admin SDK, credentials or header trust.
require('node:http').createServer((req, res) => {
  res.writeHead(404, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(req.method === 'HEAD' ? undefined : 'Not found\n');
}).listen(Number(process.env.PORT || 8080), '0.0.0.0');
