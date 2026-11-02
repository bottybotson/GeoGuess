#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST, '127.0.0.1:9009');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9099');
assert.equal(process.env.GCLOUD_PROJECT, 'demo-geoguess-admission');
const hash = createHash('sha256').update(fs.readFileSync(path.join(__dirname, 'rules.json'))).digest('hex');
// Suites reset the same demo database; sequential processes retain every assertion.
const suites = [
    ['../event-round/admission-regression.cjs', 90000],
    ['lobby-regression.cjs', 70000],
    ['../event-round/round.cjs', 240000],
    ['../event-round/timing-observer.cjs', 70000],
    ['../event-session/session.cjs', 240000],
    ['runtime.cjs', 90000],
    ['timing-observer.cjs', 70000],
];
for (const [filename, timeout] of suites) {
    process.stdout.write(`\nCombined Rules proof: ${filename}\n`);
    const result = spawnSync(process.execPath, ['--require', path.join(__dirname, 'combined-only.cjs'), '--test', `--test-timeout=${timeout}`, path.resolve(__dirname, filename)], {
        stdio: 'inherit', timeout: timeout + 10000, killSignal: 'SIGTERM',
        env: { ...process.env, GEOGUESS_COMBINED_RULES_SHA256: hash },
    });
    if (result.error) throw result.error;
    if (result.signal || result.status !== 0) process.exit(result.status || 1);
}
