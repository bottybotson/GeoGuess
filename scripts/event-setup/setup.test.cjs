'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { provision, validate } = require('./core.cjs');
const { emulatorAdapter, PROJECT, DATABASE } = require('./emulator.cjs');
const target = { projectId: PROJECT, databaseUrl: DATABASE, eventId: 'rehearsal-a' };
function fixture() { return { ...target, event: { hostUid: 'host-a', public: { title: 'Synthetic rehearsal', phase: 'lobby' }, private: { round: { id: 'r1', panoramaId: 'fictional-pano', heading: 37, pitch: -4, answer: { lat: 10, lng: 20 }, difficulty: 2000 } } } }; }
const user = { uid: 'host-a', disabled: false, providerData: [{ providerId: 'password' }] };
const env = { GCLOUD_PROJECT: PROJECT, FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIREBASE_DATABASE_EMULATOR_HOST: '127.0.0.1:9009' };
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code && error.message === code);
test('dry-run makes no adapter calls and does not pretend to verify identity or panorama', async () => {
    const adapter = new Proxy({}, { get() { throw new Error('adapter must not be touched'); } });
    assert.deepEqual(await provision(fixture(), target, { adapter, apply: 'false' }), { status: 'valid-dry-run', identityVerified: false, panoramaVerified: false, written: false });
});
test('schema/target checks reject malformed, unknown and nonfinite fields', () => {
    const mutations = [x => x.event.private.round.answer.lat = NaN, x => x.event.private.round.answer.lng = 181, x => x.event.private.round.heading = 360,
        x => x.event.private.round.pitch = -91, x => x.event.private.round.difficulty = 0, x => x.event.private.round.panoramaId = '',
        x => x.event.private.round.panoramaId = '<panorama-id>', x => x.event.hostUid = 'YOUR_UID', x => x.event.public.phase = 'guessing', x => x.event.public.title = ' ', x => x.event.hostUid = 'a/b', x => x.event.public.results = {},
        x => x.event.private.round.answer.extra = 1, x => x.eventId = 'x/y'];
    for (const mutate of mutations) { const value = fixture(); mutate(value); assert.throws(() => validate(value, target)); }
    assert.throws(() => validate(fixture(), { ...target, eventId: 'different' }), { code: 'target-mismatch' });
    for (const databaseUrl of ['http://demo.firebaseio.com', 'https://user:secret@demo.firebaseio.com', 'https://demo.firebaseio.com/?token=secret', 'https://demo.example.com']) {
        assert.throws(() => validate({ ...fixture(), databaseUrl }, { ...target, databaseUrl }));
    }
});
test('apply requires exact adapter target before host lookup', async () => {
    await rejects(provision(fixture(), target, { apply: true, adapter: { target: { ...target, projectId: 'other' }, getUser() { assert.fail(); }, createIfAbsent() { assert.fail(); } } }), 'target-mismatch');
});
test('apply requires exact enabled password-provider host and redacts lookup errors', async () => {
    for (const value of [null, { ...user, uid: 'other' }, { ...user, disabled: true }, { ...user, disabled: undefined }, { ...user, providerData: [{ providerId: 'anonymous' }] }]) {
        await rejects(provision(fixture(), target, { apply: true, adapter: { target, getUser: async () => value, createIfAbsent() { assert.fail(); } } }), 'invalid-host');
    }
    await rejects(provision(fixture(), target, { apply: true, adapter: { target, getUser() { throw new Error('credential-and-private-answer'); }, createIfAbsent() { assert.fail(); } } }), 'host-lookup-failed');
});
test('simultaneous creators preserve exactly one event and existing event remains unchanged', async () => {
    let stored = null;
    const adapter = { target, getUser: async () => user, async createIfAbsent(id, event) { assert.equal(id, target.eventId); if (stored) return false; stored = event; return true; } };
    const results = await Promise.allSettled([provision(fixture(), target, { apply: true, adapter }), provision(fixture(), target, { apply: true, adapter })]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.find(result => result.status === 'rejected').reason.code, 'event-exists');
    const before = JSON.stringify(stored);
    await rejects(provision(fixture(), target, { apply: true, adapter }), 'event-exists');
    assert.equal(JSON.stringify(stored), before);
});
test('validated seed is copied before async host lookup; unexpected write errors are redacted', async () => {
    const input = fixture();
    const adapter = { target, async getUser() { input.event.private.round.answer.lat = 90; return user; }, async createIfAbsent(id, event) { assert.equal(event.private.round.answer.lat, 10); throw new Error('secret'); } };
    await rejects(provision(input, target, { apply: true, adapter }), 'create-failed');
});
test('emulator adapter refuses all nonfixed projects/hosts before network access', () => {
    const request = () => assert.fail('guard must precede network');
    for (const changed of [{ ...target, projectId: 'customgeoguess' }, { ...target, databaseUrl: 'https://customgeoguess.firebaseio.com' }]) assert.throws(() => emulatorAdapter(changed, env, request), { code: 'emulator-target-required' });
    for (const key of Object.keys(env)) assert.throws(() => emulatorAdapter(target, { ...env, [key]: 'remote.invalid' }, request), { code: 'emulator-target-required' });
});
test('emulator conditional write uses exact ETag and treats 412 as conflict without retrying', async () => {
    const calls = [];
    const adapter = emulatorAdapter(target, env, async (url, options) => {
        calls.push({ url, options });
        if (options.method === 'PUT') return { status: 412, ok: false };
        return { ok: true, headers: new Headers({ etag: '"null_etag"' }), json: async () => null };
    });
    assert.equal(await adapter.createIfAbsent(target.eventId, fixture().event), false);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].options.headers['if-match'], '"null_etag"');
    assert.equal(calls[1].options.redirect, 'error');
});
test('CLI prints no supplied values and refuses generic or unguarded apply', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geoguess-seed-'));
    try {
        const file = path.join(dir, 'input.json'); fs.writeFileSync(file, JSON.stringify(fixture()));
        const args = [path.join(__dirname, 'cli.cjs'), '--input', file, '--project', PROJECT, '--database-url', DATABASE, '--event-id', target.eventId];
        const good = spawnSync(process.execPath, args, { encoding: 'utf8', env: {} });
        assert.equal(good.status, 0); assert.equal(JSON.parse(good.stdout).status, 'valid-dry-run');
        assert.equal(good.stdout.includes('fictional-pano'), false); assert.equal(good.stdout.includes('host-a'), false);
        const bad = spawnSync(process.execPath, [...args, '--apply'], { encoding: 'utf8', env: {} });
        assert.equal(bad.status, 1); assert.equal(bad.stderr.includes(file), false);
        const live = spawnSync(process.execPath, [...args, '--apply-emulator'], { encoding: 'utf8', env: {} });
        assert.equal(live.status, 1); assert.deepEqual(JSON.parse(live.stderr), { status: 'failed', code: 'emulator-target-required' });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
