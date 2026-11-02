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
function v2Fixture(count = 2) {
    const rounds = {};
    for (let n = 1; n <= count; n++) {
        const id = `r${String(n).padStart(2, '0')}`;
        rounds[id] = { id, panoramaId: `fictional-panorama-${n}`, heading: 37, pitch: -4,
            answer: { lat: 10 + n, lng: 20 + n }, difficulty: 2000,
            ...(n > 1 ? { previousRoundId: `r${String(n - 1).padStart(2, '0')}` } : {}),
            ...(n < count ? { nextRoundId: `r${String(n + 1).padStart(2, '0')}` } : {}) };
    }
    return { ...target, event: { hostUid: 'host-a',
        public: { title: 'Synthetic ordered rounds', formatVersion: 2, roundCount: count,
            state: { phase: 'lobby', roundId: 'r01', revision: 0 } }, private: { rounds } } };
}
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
test('v2 accepts exact one, two and twenty round seed contracts while preserving v1', () => {
    for (const count of [1, 2, 20]) {
        const seed = v2Fixture(count);
        const accepted = validate(seed, target);
        assert.deepEqual(accepted.event, seed.event);
        assert.deepEqual(Object.keys(accepted.event.public).sort(), ['formatVersion', 'roundCount', 'state', 'title']);
        assert.deepEqual(Object.keys(accepted.event.private), ['rounds']);
        assert.equal(Object.keys(accepted.event.private.rounds).length, count);
    }
    assert.equal(validate(fixture(), target).event.public.phase, 'lobby');
    const v1 = fixture(); v1.event.private.round.heading = -0;
    assert.deepEqual(validate(v1, target).event, JSON.parse(JSON.stringify(v1.event)));
});
test('v2 rejects malformed version/count types, mixed schemas and endpoint links before account lookup', async () => {
    const untouched = new Proxy({}, { get() { assert.fail('invalid seed reached adapter'); } });
    const invalid = [];
    for (const formatVersion of [null, 1, 3, '2', true, {}, []]) invalid.push(value => value.event.public.formatVersion = formatVersion);
    for (const roundCount of [null, 0, 21, 1.5, '2', true, NaN, Infinity]) invalid.push(value => value.event.public.roundCount = roundCount);
    for (const state of [null, [], { phase: 'lobby', roundId: 'r01', revision: '0' },
        { phase: 'lobby', roundId: 'r01', revision: 0, lastRevealedRoundId: 'r01' }]) invalid.push(value => value.event.public.state = state);
    invalid.push(value => value.event.private.round = fixture().event.private.round,
        value => value.event.public.phase = 'lobby',
        value => value.event.public.rounds = { r02: { clue: {} } },
        value => value.event.private.guesses = {},
        value => value.event.public.participants = {},
        value => value.event.private.rounds.r01.previousRoundId = null,
        value => value.event.private.rounds.r02.nextRoundId = null,
        value => { value.event.private.rounds.r1 = value.event.private.rounds.r01; delete value.event.private.rounds.r01; },
        value => value.event.private.rounds.r01.panoramaId = 'REPLACE_PANORAMA',
        value => value.event.private.rounds.r02.difficulty = Infinity,
        value => value.event.private.rounds.r01.answer.lng = NaN);
    for (const mutate of invalid) {
        const value = v2Fixture(); mutate(value);
        await assert.rejects(provision(value, target, { apply: true, adapter: untouched }),
            error => ['invalid-event', 'invalid-round', 'invalid-rounds'].includes(error.code));
    }
    const one = v2Fixture(1); one.event.private.rounds.r01.nextRoundId = 'r02';
    assert.throws(() => validate(one, target), { code: 'invalid-round' });
    const twenty = v2Fixture(20); twenty.event.private.rounds.r20.nextRoundId = 'r21';
    assert.throws(() => validate(twenty, target), { code: 'invalid-round' });
    const mixed = fixture(); mixed.event.public.formatVersion = 2;
    assert.throws(() => validate(mixed, target), { code: 'invalid-event' });
});
test('v2 rejects malformed version/count/state, round IDs/links/fields and public future data', () => {
    const invalid = [
        value => value.event.public.formatVersion = 3,
        value => delete value.event.public.formatVersion,
        value => value.event.public.roundCount = 0,
        value => value.event.public.roundCount = 2.5,
        value => value.event.public.state.phase = 'guessing',
        value => value.event.public.state.roundId = 'r1',
        value => value.event.public.state.revision = 1,
        value => value.event.public.clue = { panoramaId: 'future-clue' },
        value => value.event.public.answer = { lat: 11, lng: 21 },
        value => value.event.private.rounds.r02.nextRoundId = 'r04',
        value => value.event.private.rounds.r02.previousRoundId = 'r00',
        value => value.event.private.rounds.r02.id = 'r2',
        value => value.event.private.rounds.r02.extra = true,
        value => value.event.private.rounds.r02.answer.lat = 91,
        value => value.event.private.rounds.r02.heading = 360,
        value => value.event.private.rounds.r02.pitch = -91,
        value => value.event.private.rounds.r02.difficulty = 0,
        value => value.event.private.rounds.r02.panoramaId = '<panorama-id>',
        value => value.event.private.rounds.r03 = v2Fixture(1).event.private.rounds.r01,
        value => delete value.event.private.rounds.r02,
        value => value.event.private.rounds.r02.answer.clue = 'secret',
    ];
    for (const mutate of invalid) {
        const value = v2Fixture(); mutate(value);
        assert.throws(() => validate(value, target));
    }
    const one = v2Fixture(1); one.event.private.rounds.r01.previousRoundId = 'r00';
    assert.throws(() => validate(one, target));
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
test('v2 seed is cloned before asynchronous host lookup and dry-run is offline', async () => {
    const input = v2Fixture(2);
    let stored;
    const selected = { ...target };
    const adapter = { target, async getUser(uid) {
        assert.equal(uid, 'host-a');
        input.event.hostUid = 'another-host';
        input.eventId = selected.eventId = 'another-event';
        input.event.private.rounds.r02.answer.lat = 90;
        input.event.public.title = 'mutated after validation';
        return user;
    }, async createIfAbsent(id, event) { assert.equal(id, target.eventId); stored = event; return true; } };
    const applied = await provision(input, selected, { apply: true, adapter });
    assert.equal(applied.written, true);
    assert.equal(stored.hostUid, 'host-a');
    assert.equal(stored.public.title, 'Synthetic ordered rounds');
    assert.equal(stored.private.rounds.r02.answer.lat, 12);
    const pure = await provision(v2Fixture(1), target, { apply: false, adapter: new Proxy({}, { get() { assert.fail('dry-run touched adapter'); } }) });
    assert.equal(pure.status, 'valid-dry-run');
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
test('v2 conditional PUT with lost acknowledgement remains uncertain and is never retried', async () => {
    for (const failure of ['transport', 'server']) {
        let puts = 0, stored = null;
        const adapter = emulatorAdapter(target, env, async (url, options) => {
            if (options.method === 'POST') return { ok: true, json: async () => ({ users: [{ localId: user.uid, disabled: false, providerUserInfo: user.providerData }] }) };
            if (options.method === 'PUT') {
                puts++;
                stored = JSON.parse(options.body);
                if (failure === 'transport') throw new Error('private transport details');
                return { status: 503, ok: false };
            }
            return { ok: true, headers: new Headers({ etag: '"null_etag"' }), json: async () => stored };
        });
        await rejects(provision(v2Fixture(), target, { apply: true, adapter }), 'create-unconfirmed');
        assert.equal(puts, 1);
        assert.deepEqual(stored, v2Fixture().event);
        await rejects(provision(v2Fixture(), target, { apply: true, adapter }), 'event-exists');
        assert.equal(puts, 1);
    }
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
        const invalid = v2Fixture(); delete invalid.event.private.rounds.r02;
        fs.writeFileSync(file, JSON.stringify(invalid));
        const malformed = spawnSync(process.execPath, args, { encoding: 'utf8', env: {} });
        assert.equal(malformed.status, 1);
        assert.deepEqual(JSON.parse(malformed.stderr), { status: 'failed', code: 'invalid-rounds' });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
