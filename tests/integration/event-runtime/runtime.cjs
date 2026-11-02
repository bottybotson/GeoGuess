#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { test, before, beforeEach, afterEach, after } = require('node:test');
const PROJECT = 'demo-geoguess-admission';
assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST, '127.0.0.1:9009');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9099');
assert.equal(process.env.GCLOUD_PROJECT, PROJECT);
// Guards precede provider imports and disposable account creation.
delete process.env.HTTP_PROXY; delete process.env.http_proxy;
const appRoot = path.resolve(__dirname, '../../..');
const appRequire = createRequire(path.join(appRoot, 'package.json'));
const toolRequire = createRequire('/workspace/.geoguess-emulator-tools/package.json');
assert.equal(appRequire('firebase/package.json').version, '8.10.1');
assert.equal(toolRequire('firebase/package.json').version, '11.10.0');
assert.equal(toolRequire('@firebase/rules-unit-testing/package.json').version, '4.0.1');
const firebase = appRequire('firebase/app'); appRequire('firebase/auth'); appRequire('firebase/database');
const { initializeTestEnvironment } = toolRequire('@firebase/rules-unit-testing');
const { ref, set, get } = toolRequire('firebase/database');
const babel = appRequire('@babel/core');
const modules = new Map();
function sourceModule(filename) {
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} }; modules.set(filename, module);
    const { code } = babel.transformSync(fs.readFileSync(filename, 'utf8'), {
        filename, babelrc: false, configFile: false,
        plugins: [appRequire.resolve('@babel/plugin-transform-modules-commonjs')],
    });
    const requireLocal = id => id.startsWith('.') ? sourceModule(path.resolve(path.dirname(filename), `${id}.js`)) : appRequire(id);
    new Function('require', 'module', 'exports', code)(requireLocal, module, module.exports);
    return module.exports;
}
const { createVersionedLobbyClient, createPresenterClient } = sourceModule(path.join(appRoot, 'src/event/facade.js'));
const { createSessionClient } = sourceModule(path.join(appRoot, 'src/event/session.js'));
const { createRoundClient } = sourceModule(path.join(appRoot, 'src/event/round.js'));
const { createEventPresenterRuntime } = sourceModule(path.join(appRoot, 'src/event/runtime.js'));
const denied = promise => assert.rejects(promise, error => /permission.denied/i.test(error.code || error.message));
const apps = []; let serial = 0; let env; let hostUid; let hostEmail; let hostPassword;
const round = id => ({ id, panoramaId: `synthetic-${id}`, heading: 17, pitch: 0, answer: { lat: 0, lng: 0 }, difficulty: 2000 });
const clue = id => ({ id, panoramaId: `synthetic-${id}`, heading: 17, pitch: 0 });
function client() {
    const app = firebase.initializeApp({ apiKey: 'emulator-only', projectId: PROJECT, databaseURL: `https://${PROJECT}.firebaseio.com` }, `runtime_${serial++}`); apps.push(app);
    const auth = app.auth(); auth.useEmulator('http://127.0.0.1:9099', { disableWarnings: true });
    const database = app.database(); database.useEmulator('127.0.0.1', 9009);
    let identities = 0;
    const ensureGuest = async () => { identities++; return auth.currentUser || (await auth.signInAnonymously()).user; };
    const identity = { ensureUser: ensureGuest };
    return { app, auth, database, identities: () => identities, lobby: createVersionedLobbyClient(database, { ensureGuest }), presenter: createPresenterClient(database),
        session: createSessionClient(database, identity), legacy: createRoundClient(database, identity) };
}
const trusted = async callback => { let value; await env.withSecurityRulesDisabled(async context => { value = await callback(context.database()); }); return value; };
const stored = target => trusted(db => get(ref(db, target)).then(snapshot => snapshot.val()));
async function seed(eventId, version) {
    const v2 = version !== undefined;
    await trusted(db => set(ref(db, `events/${eventId}`), { hostUid,
        public: { title: 'Synthetic combined proof', ...(v2 ? { formatVersion: version, roundCount: 2, state: { phase: 'lobby', roundId: 'r01', revision: 0 } } : { phase: 'lobby' }) },
        private: { round: round('r1'), rounds: { r01: { ...round('r01'), nextRoundId: 'r02' }, r02: { ...round('r02'), previousRoundId: 'r01' } } },
    }));
}
async function organizer() { const c = client(); await c.auth.signInWithEmailAndPassword(hostEmail, hostPassword); return c; }
before(async () => {
    env = await initializeTestEnvironment({ projectId: PROJECT, database: { host: '127.0.0.1', port: 9009, rules: fs.readFileSync(path.join(__dirname, 'rules.json'), 'utf8') } });
    const h = client(); hostEmail = `runtime-${Date.now()}@emulator.invalid`; hostPassword = `local-${Date.now()}-fixture`;
    await h.auth.createUserWithEmailAndPassword(hostEmail, hostPassword); hostUid = h.auth.currentUser.uid;
});
beforeEach(async () => { await env.clearDatabase(); await seed('v1'); await seed('v2', 2); });
afterEach(async () => { for (const app of apps.splice(0)) { await app.auth().signOut(); app.database().goOffline(); await app.delete(); } });
after(async () => { if (env) await env.cleanup(); });

test('v1/v2 coexist; opposite-protocol raw grants cannot alter or expose either event', async () => {
    const h = await organizer(); const g = client();
    assert.equal((await g.lobby.join('v1', 'Legacy')).status, 'joined');
    assert.equal((await g.lobby.join('v2', 'Ordered')).status, 'joined');
    const p = 'events/v2/public';
    // Populate plausible legacy phase/setup traps: version gating must still deny.
    await trusted(db => set(ref(db, `${p}/phase`), 'lobby'));
    await denied(h.database.ref().update({ [`${p}/phase`]: 'guessing', [`${p}/round`]: clue('r1') }));
    await trusted(db => set(ref(db, `${p}/phase`), 'guessing'));
    await denied(h.database.ref(`${p}/timing`).set({ roundId: 'r1', deadlineMs: Date.now() + 60000 }));
    await denied(g.database.ref(`events/v2/private/guesses/r1/${g.auth.currentUser.uid}`).set({ lat: 0, lng: 0 }));
    await trusted(db => set(ref(db, `${p}/round`), clue('r1')));
    await denied(h.database.ref(`${p}/phase`).set('closed'));
    await trusted(db => set(ref(db, `${p}/phase`), 'closed'));
    const legacyReveal = { roundId: 'r1', answer: { lat: 0, lng: 0 }, results: {
        [g.auth.currentUser.uid]: { nickname: 'Ordered', answered: false, points: 0 },
    } };
    await denied(h.database.ref().update({ [`${p}/phase`]: 'reveal', [`${p}/reveal`]: legacyReveal }));
    await denied(h.database.ref('events/v2/private/round').once('value'));
    await denied(h.database.ref('events/v1/private/rounds/r01').once('value'));
    // A fully plausible v2 state on v1 still cannot activate v2 grants.
    await trusted(db => set(ref(db, 'events/v1/public/state'), { phase: 'lobby', roundId: 'r01', revision: 0 }));
    await trusted(db => set(ref(db, 'events/v1/public/roundCount'), 2));
    await denied(g.database.ref('events/v1/public/state').once('value'));
    await denied(g.database.ref('events/v2/public/phase').once('value'));
    await denied(h.database.ref().update({ 'events/v1/public/state': { phase: 'guessing', roundId: 'r01', revision: 1 }, 'events/v1/public/rounds/r01/clue': clue('r01') }));
    await denied(g.database.ref(`events/v1/private/guesses/r01/${g.auth.currentUser.uid}`).set({ lat: 0, lng: 0 }));
    for (const id of ['v1', 'v2']) {
        await denied(h.database.ref(`events/${id}/public/formatVersion`).set(id === 'v1' ? 2 : null));
        await denied(h.database.ref(`events/${id}`).once('value'));
        await denied(h.database.ref(`events/${id}/public`).once('value'));
    }
    assert.equal((await h.session.start('v2', { roundId: 'r01', revision: 0 })).status, 'started');
    await assert.rejects(h.session.close('v2', { roundId: 'r01', revision: 0 }), error => error.code === 'stale-state');
    assert.equal((await h.legacy.start('v1')).status, 'started');
    assert.equal((await stored('events/v2/public/state')).roundId, 'r01');
    assert.equal(await stored('events/v1/public/phase'), 'guessing');
});

test('unknown and malformed versions expose only dispatch leaf and deny both protocol grants', async () => {
    const h = await organizer(); const g = client(); await g.auth.signInAnonymously();
    for (const [i, version] of [0, 1, 3, '2', true, { number: 2 }, [2]].entries()) {
        const id = `unknown_${i}`; await seed(id, version);
        // Satisfy both protocols' other admission/start conditions; version must
        // independently deny the plausible legacy and v2 grants.
        await trusted(db => set(ref(db, `events/${id}/public/phase`), 'lobby'));
        await trusted(db => set(ref(db, `events/${id}/public/participants/support`), { nickname: 'Support', slot: 's50' }));
        await trusted(db => set(ref(db, `events/${id}/public/slots/s50`), 'support'));
        assert.deepEqual((await g.database.ref(`events/${id}/public/formatVersion`).once('value')).val(), version);
        await assert.rejects(g.lobby.join(id, 'Unknown'), error => error.code === 'unsupported-format');
        assert.equal(g.identities(), 0);
        for (const leaf of ['title', 'phase', 'state', 'roundCount', 'participants', 'slots', 'round', 'rounds/r01/clue']) await denied(g.database.ref(`events/${id}/public/${leaf}`).once('value'));
        const uid = g.auth.currentUser.uid;
        await denied(g.database.ref().update({ [`events/${id}/public/participants/${uid}`]: { nickname: 'Unknown', slot: 's01' }, [`events/${id}/public/slots/s01`]: uid }));
        await denied(h.database.ref().update({ [`events/${id}/public/state`]: { phase: 'guessing', roundId: 'r01', revision: 1 }, [`events/${id}/public/rounds/r01/clue`]: clue('r01') }));
        await denied(h.database.ref().update({ [`events/${id}/public/phase`]: 'guessing', [`events/${id}/public/round`]: clue('r1') }));
        await denied(h.database.ref(`events/${id}/private/round`).once('value'));
        await denied(h.database.ref(`events/${id}/private/rounds/r01`).once('value'));
    }
});

test('v2 actual lobby admits 50 plus one, rejoins each phase without more claims and projects without identity', async () => {
    const presenter = client(); let stop;
    try {
        const projected = await new Promise((resolve, reject) => { stop = presenter.presenter.lobby.subscribe('v2', resolve, reject); });
        assert.equal(projected.phase, 'lobby'); assert.equal(projected.roundId, 'r01'); assert.equal(projected.revision, 0); assert.equal(projected.roundCount, 2);
        assert.equal(presenter.identities(), 0); assert.equal(presenter.auth.currentUser, null);
    } finally { if (stop) stop(); }
    const guests = Array.from({ length: 51 }, client);
    const outcomes = await Promise.all(guests.map((g, i) => g.lobby.join('v2', `Guest ${i + 1}`)));
    assert.equal(outcomes.filter(x => x.status === 'joined').length, 50); assert.equal(outcomes.filter(x => x.status === 'full').length, 1);
    const admitted = guests[outcomes.findIndex(x => x.status === 'joined')];
    const uid = admitted.auth.currentUser.uid; const membership = await stored(`events/v2/public/participants/${uid}`);
    const states = [
        { phase: 'guessing', roundId: 'r01', revision: 1 }, { phase: 'closed', roundId: 'r01', revision: 2 },
        { phase: 'reveal', roundId: 'r01', revision: 3, lastRevealedRoundId: 'r01' },
        { phase: 'ready', roundId: 'r02', revision: 4, lastRevealedRoundId: 'r01' },
        { phase: 'guessing', roundId: 'r02', revision: 5, lastRevealedRoundId: 'r01' },
        { phase: 'closed', roundId: 'r02', revision: 6, lastRevealedRoundId: 'r01' },
        { phase: 'reveal', roundId: 'r02', revision: 7, lastRevealedRoundId: 'r02' },
        { phase: 'complete', roundId: 'r02', revision: 8, lastRevealedRoundId: 'r02' },
    ];
    const fresh = client();
    for (const state of states) {
        await trusted(db => set(ref(db, 'events/v2/public/state'), state));
        const restored = createVersionedLobbyClient(admitted.database, { ensureGuest: async () => admitted.auth.currentUser });
        assert.equal((await restored.join('v2', 'Changed')).status, 'rejoined');
        assert.equal((await fresh.lobby.join('v2', 'Late')).status, 'started');
    }
    assert.deepEqual(await stored(`events/v2/public/participants/${uid}`), membership);
    assert.equal(Object.keys(await stored('events/v2/public/slots')).length, 50);
    const h = await organizer(); assert.equal((await h.lobby.join('v2', 'Host')).status, 'started');
    assert.equal(await stored(`events/v2/public/participants/${hostUid}`), null);
    await denied(presenter.database.ref('events/v2/private/rounds/r02').once('value'));
    await denied(presenter.database.ref(`events/v2/private/guesses/r01/${uid}`).once('value'));
    assert.equal(await presenter.presenter.session.getClue('v2', 'r02'), null);
    assert.equal(presenter.identities(), 0);
});

test('actual SDK8 named presenter runtime remains signed out while the separate guest app is signed in', async () => {
    const options = { apiKey: 'demo-key', projectId: PROJECT, databaseURL: `https://${PROJECT}.firebaseio.com` };
    const guestApp = firebase.initializeApp(options, 'geoguess-event-demo-guest'); apps.push(guestApp);
    guestApp.auth().useEmulator('http://127.0.0.1:9099', { disableWarnings: true });
    await guestApp.auth().signInAnonymously();
    const app = firebase.initializeApp(options, 'geoguess-event-demo-presenter');
    apps.push(app);
    // SDK8 database() may initialize its internal Auth provider. Our public
    // runtime never requests a user or calls any sign-in operation on it.
    const auth = app.auth(); let signIns = 0;
    auth.useEmulator('http://127.0.0.1:9099', { disableWarnings: true });
    const original = auth.signInAnonymously;
    auth.signInAnonymously = () => { signIns++; throw new Error('Public runtime attempted anonymous sign-in'); };
    const stops = [];
    try {
        const presenter = createEventPresenterRuntime(firebase, { emulators: true, mode: 'development', hostname: '127.0.0.1' });
        const view = await new Promise((resolve, reject) => { stops.push(presenter.lobby.subscribe('v2', resolve, reject)); });
        assert.equal(view.phase, 'lobby');
        assert.equal((await presenter.session.getState('v2')).roundId, 'r01');
        const timing = await new Promise((resolve, reject) => {
            stops.push(presenter.session.subscribeTiming('v2', 'r01', value => { if (value.connected) resolve(value); }, reject));
        });
        assert.equal(timing.timing, null);
        assert.equal(await presenter.round.getReveal('v1'), null);
        assert.deepEqual(Object.keys(presenter.round).sort(), ['getReveal', 'getServerTime', 'getTiming', 'subscribeTiming']);
        assert.equal(auth.currentUser, null);
        assert.ok(guestApp.auth().currentUser);
        assert.equal(signIns, 0);
        assert.equal(await stored('events/v2/public/participants'), null);
        assert.equal(await stored('events/v2/public/slots'), null);
    } finally { stops.forEach(stop => stop()); auth.signInAnonymously = original; }
});
