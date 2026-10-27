#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { test, before, after, beforeEach, afterEach } = require('node:test');
const PROJECT = 'demo-geoguess-admission';
assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST, '127.0.0.1:9009');
assert.equal(process.env.GCLOUD_PROJECT, PROJECT);
// Only the guarded local test child removes the SDK's loopback-breaking proxy.
delete process.env.HTTP_PROXY;
delete process.env.http_proxy;
const appRoot = path.resolve(__dirname, '../../..');
const appRequire = createRequire(path.join(appRoot, 'package.json'));
const toolRequire = createRequire('/workspace/.geoguess-emulator-tools/package.json');
assert.equal(appRequire('firebase/package.json').version, '8.10.1');
assert.equal(toolRequire('@firebase/rules-unit-testing/package.json').version, '4.0.1');
const firebase = appRequire('firebase/app');
appRequire('firebase/database');
const { initializeTestEnvironment } = toolRequire('@firebase/rules-unit-testing');
const { ref, set, get } = toolRequire('firebase/database');
const babel = appRequire('@babel/core');
const sourceModules = new Map();
// Load the actual app modules; transform only ES import/export syntax for Node.
function sourceModule(filename) {
    if (sourceModules.has(filename)) return sourceModules.get(filename).exports;
    const module = { exports: {} };
    sourceModules.set(filename, module);
    const { code } = babel.transformSync(fs.readFileSync(filename, 'utf8'), {
        filename, babelrc: false, configFile: false,
        plugins: [appRequire.resolve('@babel/plugin-transform-modules-commonjs')],
    });
    const requireLocal = id => {
        assert.equal(id, './admission', 'Unexpected app dependency in isolated lobby fixture');
        return sourceModule(path.join(path.dirname(filename), 'admission.js'));
    };
    new Function('require', 'module', 'exports', code)(requireLocal, module, module.exports);
    return module.exports;
}
const { createLobbyClient } = sourceModule(path.join(appRoot, 'src/event/lobby.js'));
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
let env;
let serial = 0;
const apps = [];
const trusted = async callback => {
    let result;
    await env.withSecurityRulesDisabled(async context => { result = await callback(context.database()); });
    return result;
};
const fixture = eventId => trusted(db => set(ref(db, `events/${eventId}`), {
    hostUid: 'organizer', public: { title: 'SDK8 local fixture', phase: 'lobby' },
}));
function client(uid, interceptUpdate) {
    const app = firebase.initializeApp({ projectId: PROJECT, databaseURL: `https://${PROJECT}.firebaseio.com` }, `sdk8_${serial++}`);
    apps.push(app);
    const database = app.database();
    database.useEmulator('127.0.0.1', 9009, { mockUserToken: { sub: uid } });
    const injected = interceptUpdate ? {
        ref(target) {
            if (target !== undefined) return database.ref(target);
            return { update(changes) { return interceptUpdate(database, changes); } };
        },
    } : database;
    const identity = { ensureGuest: async () => ({ uid }) };
    return { database, injected, identity, service: createLobbyClient(injected, identity) };
}
before(async () => {
    env = await initializeTestEnvironment({ projectId: PROJECT, database: {
        host: '127.0.0.1', port: 9009, rules: fs.readFileSync(path.join(__dirname, 'rules.json'), 'utf8'),
    } });
});
beforeEach(async () => { await env.clearDatabase(); });
afterEach(async () => {
    for (const app of apps.splice(0)) { app.database().goOffline(); await app.delete(); }
});
after(async () => { if (env) await env.cleanup(); });

test('actual Firebase8 adapter admits distinct peers, subscribes redacted views, and rejoins after start', async () => {
    await fixture('sdk8');
    const a = client('sdk_guest_a');
    const b = client('sdk_guest_b');
    const results = await Promise.all([a.service.join('sdk8', ' Alex '), b.service.join('sdk8', 'Alex')]);
    assert.deepEqual(results.map(result => result.status), ['joined', 'joined']);
    const state = await trusted(db => get(ref(db, 'events/sdk8/public')).then(snapshot => snapshot.val()));
    assert.equal(Object.keys(state.participants).length, 2);
    assert.equal(new Set(Object.values(state.slots)).size, 2);
    const seen = deferred();
    const views = [];
    const dispose = a.service.subscribe('sdk8', value => { views.push(value); if (value.participants.length === 2) seen.resolve(); }, error => { throw error; });
    await Promise.race([seen.promise, pause(10000).then(() => { throw new Error('No initial SDK8 projection'); })]);
    assert.deepEqual(views.at(-1), { title: 'SDK8 local fixture', phase: 'lobby', participants: [
        { id: 'sdk_guest_a', nickname: 'Alex' }, { id: 'sdk_guest_b', nickname: 'Alex' },
    ] });
    dispose(); dispose();
    await trusted(db => set(ref(db, 'events/sdk8/public/phase'), 'guessing'));
    assert.deepEqual(await a.service.join('sdk8', 'Different'), { status: 'rejoined', participant: { id: 'sdk_guest_a', nickname: 'Alex' } });
    assert.deepEqual(await client('sdk_late').service.join('sdk8', 'Late'), { status: 'started' });
});

for (const outcome of ['accepted', 'rejected']) {
    test(`timed-out optimistic SDK8 write is not admission until server ${outcome} outcome`, async () => {
        const eventId = `offline_${outcome}`;
        await fixture(eventId);
        const queued = deferred();
        let first = true;
        const c = client(`guest_${outcome}`, (database, changes) => {
            if (first) { first = false; database.goOffline(); queued.resolve(); }
            return database.ref().update(changes);
        });
        const timedOut = c.service.join(eventId, 'Original');
        const failure = assert.rejects(timedOut, error => error.code === 'unavailable');
        await queued.promise;
        await failure; // Real 15-second deadline, not a fake SDK clock.
        const local = await c.database.ref(`events/${eventId}/public/participants/guest_${outcome}`).once('value');
        assert.equal(local.val().nickname, 'Original', 'SDK really exposes its optimistic cache');
        const next = createLobbyClient(c.injected, c.identity);
        let settled = false;
        const retry = next.join(eventId, 'Replacement').then(result => { settled = true; return result; });
        await pause(100);
        assert.equal(settled, false, 'A fresh service must not mistake a queued write for a confirmed member');
        if (outcome === 'rejected') await trusted(db => set(ref(db, `events/${eventId}/public/phase`), 'guessing'));
        c.database.goOnline();
        const result = await retry;
        const stored = await trusted(db => get(ref(db, `events/${eventId}/public/participants/guest_${outcome}`)).then(snapshot => snapshot.val()));
        if (outcome === 'accepted') {
            assert.deepEqual(result, { status: 'rejoined', participant: { id: `guest_${outcome}`, nickname: 'Original' } });
            assert.equal(stored.nickname, 'Original');
        } else {
            assert.deepEqual(result, { status: 'started' });
            assert.equal(stored, null);
        }
    });
}
