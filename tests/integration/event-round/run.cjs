#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST, '127.0.0.1:9009');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9099');
assert.equal(process.env.GCLOUD_PROJECT, 'demo-geoguess-admission');
// These suites reset the same disposable database: run sequentially.
for (const [filename, timeout] of [['round.cjs', 240000], ['admission-regression.cjs', 60000]]) {
    const result = spawnSync(process.execPath, ['--test', `--test-timeout=${timeout}`, path.join(__dirname, filename)], {
        stdio: 'inherit', timeout, killSignal: 'SIGTERM',
    });
    if (result.error) throw result.error;
    if (result.signal || result.status !== 0) process.exit(result.status || 1);
}
