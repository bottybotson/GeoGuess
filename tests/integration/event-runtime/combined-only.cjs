'use strict';
// Existing proof suites explicitly upload their adjacent rules.json at startup.
// Redirect only those exact fixture reads, so none can silently test old grants.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST, '127.0.0.1:9009');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9099');
assert.equal(process.env.GCLOUD_PROJECT, 'demo-geoguess-admission');
const read = fs.readFileSync.bind(fs);
const candidate = read(path.join(__dirname, 'rules.json'));
const hash = createHash('sha256').update(candidate).digest('hex');
assert.equal(hash, process.env.GEOGUESS_COMBINED_RULES_SHA256, 'Combined Rules artifact changed during proof');
const paths = new Set(['event-admission', 'event-round', 'event-session', 'event-runtime'].map(name => path.resolve(__dirname, '..', name, 'rules.json')));
let reads = 0;
fs.readFileSync = function(filename, options) {
    if (typeof filename === 'string' && paths.has(path.resolve(filename))) {
        reads++;
        if (reads === 1) process.stdout.write(`# Exact combined Rules SHA256 ${hash}\n`);
        const encoding = typeof options === 'string' ? options : options && options.encoding;
        return encoding ? candidate.toString(encoding) : Buffer.from(candidate);
    }
    return read(filename, options);
};
// node --test preloads this in its orchestration process as well as each worker.
if (process.env.NODE_TEST_CONTEXT) process.on('beforeExit', () => assert.ok(reads > 0, 'Proof worker did not load the combined Rules artifact'));
