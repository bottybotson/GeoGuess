#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { test, before, after, beforeEach, afterEach } = require('node:test');
const PROJECT = 'demo-geoguess-admission';
assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST, '127.0.0.1:9009');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9099');
assert.equal(process.env.GCLOUD_PROJECT, PROJECT);
// Fail closed before importing either SDK, initializing providers or creating credentials.
delete process.env.HTTP_PROXY;
delete process.env.http_proxy;
const appRoot = path.resolve(__dirname, '../../..');
const appRequire = createRequire(path.join(appRoot, 'package.json'));
const toolRequire = createRequire('/workspace/.geoguess-emulator-tools/package.json');
assert.equal(appRequire('firebase/package.json').version, '8.10.1');
assert.equal(toolRequire('firebase/package.json').version, '11.10.0');
assert.equal(toolRequire('@firebase/rules-unit-testing/package.json').version, '4.0.1');
const firebase = appRequire('firebase/app');
appRequire('firebase/database'); appRequire('firebase/auth');
const { initializeTestEnvironment } = toolRequire('@firebase/rules-unit-testing');
const { ref, get, set } = toolRequire('firebase/database');
const babel = appRequire('@babel/core');
const modules = new Map();
function sourceModule(filename) {
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} };
    modules.set(filename, module);
    const { code } = babel.transformSync(fs.readFileSync(filename, 'utf8'), {
        filename, babelrc: false, configFile: false,
        plugins: [appRequire.resolve('@babel/plugin-transform-modules-commonjs')],
    });
    const requireLocal = id => {
        if (id.startsWith('.')) return sourceModule(path.resolve(path.dirname(filename), `${id}.js`));
        assert.equal(id, '@turf/distance');
        return appRequire(id);
    };
    new Function('require', 'module', 'exports', code)(requireLocal, module, module.exports);
    return module.exports;
}
const { createSessionClient } = sourceModule(path.join(appRoot, 'src/event/session.js'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const denied = promise => assert.rejects(promise, error => /permission.denied/i.test(error.code || error.message));
const stale = promise => assert.rejects(promise, error => error.code === 'stale-state');
const rid = n => `r${String(n).padStart(2, '0')}`;
const expected = (n, step) => ({ roundId: rid(n), revision: 4 * (n - 1) + step });
const setup = (n, count) => ({ id: rid(n), panoramaId: `emulator-fictional-${n}`, heading: n, pitch: -4,
    answer: { lat: 0, lng: 0 }, difficulty: 2000,
    ...(n > 1 ? { previousRoundId: rid(n - 1) } : {}), ...(n < count ? { nextRoundId: rid(n + 1) } : {}) });
const clue = n => ({ id: rid(n), panoramaId: `emulator-fictional-${n}`, heading: n, pitch: -4 });
let env, serial = 0, hostUid, email, password;
const apps = [];
const trusted = async callback => { let value; await env.withSecurityRulesDisabled(async context => { value = await callback(context.database()); }); return value; };
const stored = target => trusted(db => get(ref(db, target)).then(snapshot => snapshot.val()));
async function seed(count = 2, eventId = 'fixture') {
    await trusted(db => set(ref(db, `events/${eventId}`), {
        hostUid, public: { title: 'Local ordered-round proof', formatVersion: 2, roundCount: count,
            state: { phase: 'lobby', roundId: 'r01', revision: 0 } },
        private: { rounds: Object.fromEntries(Array.from({ length: count }, (_, i) => [rid(i + 1), setup(i + 1, count)])) },
    }));
}
function rawClient(intercept) {
    const app = firebase.initializeApp({ apiKey: 'emulator-only-key', projectId: PROJECT,
        databaseURL: `https://${PROJECT}.firebaseio.com` }, `session_${serial++}`);
    apps.push(app);
    const auth = app.auth();
    auth.useEmulator('http://127.0.0.1:9099', { disableWarnings: true });
    const database = app.database(); database.useEmulator('127.0.0.1', 9009);
    const injected = intercept ? { ref(target) {
        return target === undefined ? { update: changes => intercept(database, changes) } : database.ref(target);
    } } : database;
    const identity = { ensureUser: async () => auth.currentUser };
    return { app, auth, database, injected, identity, service: createSessionClient(injected, identity) };
}
async function host(intercept) { const client = rawClient(intercept); await client.auth.signInWithEmailAndPassword(email, password); return client; }
async function guest(nickname, seat = 1, eventId = 'fixture') {
    const client = rawClient(); await client.auth.signInAnonymously(); client.uid = client.auth.currentUser.uid;
    if (nickname) await client.database.ref().update({ [`events/${eventId}/public/participants/${client.uid}`]: { nickname, slot: `s${String(seat).padStart(2, '0')}` }, [`events/${eventId}/public/slots/s${String(seat).padStart(2, '0')}`]: client.uid });
    return client;
}
before(async () => {
    env = await initializeTestEnvironment({ projectId: PROJECT, database: { host: '127.0.0.1', port: 9009,
        rules: fs.readFileSync(path.join(__dirname, 'rules.json'), 'utf8') } });
    email = `organizer-${Date.now()}@emulator.invalid`; password = `emulator-${Date.now()}-only`;
    const provisioning = rawClient(); await provisioning.auth.createUserWithEmailAndPassword(email, password); hostUid = provisioning.auth.currentUser.uid;
});
beforeEach(async () => { await env.clearDatabase(); await seed(); });
afterEach(async () => { for (const app of apps.splice(0)) { await app.auth().signOut(); app.database().goOffline(); await app.delete(); } });
after(async () => { if (env) await env.cleanup(); });

test('two guests complete two actual rounds, retain missed guesses, pause, totals and reconnect', async () => {
    const h = await host(), h2 = await host();
    const a = await guest('Alex'), b = await guest('Missing', 2);
    const presenter = rawClient(); let identityRequests = 0;
    const publicService = createSessionClient(presenter.database, { ensureUser() { identityRequests++; throw new Error('Identity must not be requested'); } });
    assert.equal(await publicService.getClue('fixture', 'r02'), null);
    assert.equal(await publicService.getReveal('fixture', 'r01'), null);
    assert.equal(await publicService.getTiming('fixture', 'r01'), null);
    assert.ok(Number.isSafeInteger((await publicService.getServerTime('fixture')).nowMs));
    await denied(a.service.getHostSetup('fixture', 'r01'));
    for (const target of ['events/fixture', 'events/fixture/public', 'events/fixture/private/rounds/r02', 'events/fixture/private/rounds/r01/answer']) await denied(presenter.database.ref(target).once('value'));
    const starts = await Promise.all([h.service.start('fixture', expected(1, 0)), h2.service.start('fixture', expected(1, 0))]);
    assert.deepEqual(starts.map(x => x.status).sort(), ['already-started', 'started']);
    assert.deepEqual(await publicService.getClue('fixture', 'r01'), clue(1));
    assert.equal(await publicService.getClue('fixture', 'r02'), null);
    await a.service.submitGuess('fixture', 'r01', { lat: 0, lng: 0 });
    assert.equal((await createSessionClient(a.database, a.identity).submitGuess('fixture', 'r01', { lat: 1, lng: 1 })).status, 'already-submitted');
    await denied(b.database.ref(`events/fixture/private/guesses/r01/${a.uid}`).once('value'));
    await h.service.close('fixture', expected(1, 1));
    const reveals = await Promise.all([h.service.reveal('fixture', expected(1, 2)), h2.service.reveal('fixture', expected(1, 2))]);
    assert.deepEqual(reveals.map(x => x.status).sort(), ['already-revealed', 'revealed']);
    const first = await publicService.getReveal('fixture', 'r01');
    assert.deepEqual(first.results[a.uid], { nickname: 'Alex', answered: true, points: 5000, totalPoints: 5000, distance: 0 });
    assert.deepEqual(first.results[b.uid], { nickname: 'Missing', answered: false, points: 0, totalPoints: 0 });
    assert.deepEqual(await publicService.getState('fixture'), { phase: 'reveal', roundId: 'r01', revision: 3, lastRevealedRoundId: 'r01' });
    const advances = await Promise.all([h.service.next('fixture', expected(1, 3)), h2.service.next('fixture', expected(1, 3))]);
    assert.deepEqual(advances.map(x => x.status).sort(), ['advanced', 'already-advanced']);
    assert.deepEqual(await publicService.getState('fixture'), { phase: 'ready', roundId: 'r02', revision: 4, lastRevealedRoundId: 'r01' });
    assert.equal(await publicService.getClue('fixture', 'r02'), null);
    assert.equal((await h.service.close('fixture', expected(1, 1))).status, 'already-closed');
    assert.equal((await h.service.getState('fixture')).roundId, 'r02');
    await stale(h.service.close('fixture', { roundId: 'r01', revision: 5 }));
    await stale(h.service.setDeadline('fixture', expected(1, 1), Date.now() + 60000));
    await stale(h.service.start('fixture', { roundId: 'r02', revision: 0 }));
    await h.service.start('fixture', expected(2, 0));
    await denied(h.database.ref('events/fixture/public/state').set({ phase: 'closed', roundId: 'r01', revision: 6, lastRevealedRoundId: 'r01' }));
    await b.service.submitGuess('fixture', 'r02', { lat: 0, lng: 0 });
    a.database.goOffline(); a.database.goOnline();
    assert.deepEqual(await createSessionClient(a.database, a.identity).getOwnGuess('fixture', 'r01'), { lat: 0, lng: 0 });
    await h.service.close('fixture', expected(2, 1)); await h.service.reveal('fixture', expected(2, 2));
    const final = await publicService.getReveal('fixture', 'r02');
    assert.deepEqual(final.results[a.uid], { nickname: 'Alex', answered: false, points: 0, totalPoints: 5000 });
    assert.deepEqual(final.results[b.uid], { nickname: 'Missing', answered: true, points: 5000, totalPoints: 5000, distance: 0 });
    const completed = await Promise.all([h.service.complete('fixture', expected(2, 3)), h2.service.complete('fixture', expected(2, 3))]);
    assert.deepEqual(completed.map(x => x.status).sort(), ['already-completed', 'completed']);
    assert.deepEqual(await publicService.getState('fixture'), { phase: 'complete', roundId: 'r02', revision: 8, lastRevealedRoundId: 'r02' });
    assert.deepEqual(await publicService.getReveal('fixture', 'r01'), first);
    assert.equal(identityRequests, 0); assert.equal(presenter.auth.currentUser, null);
    assert.equal((await stored('events/fixture/public/participants'))[hostUid], undefined);
});

test('one-round lower boundary completes and empty lobby cannot start', async () => {
    await seed(1);
    const h = await host();
    await assert.rejects(h.service.start('fixture', expected(1, 0)), error => error.code === 'no-participants');
    await denied(h.database.ref().update({ 'events/fixture/public/state': { phase: 'guessing', roundId: 'r01', revision: 1 }, 'events/fixture/public/rounds/r01/clue': clue(1) }));
    await guest('Single');
    await h.service.start('fixture', expected(1, 0));
    await h.service.close('fixture', expected(1, 1));
    await h.service.reveal('fixture', expected(1, 2));
    await assert.rejects(h.service.next('fixture', expected(1, 3)));
    await h.service.complete('fixture', expected(1, 3));
    assert.deepEqual(await h.service.getState('fixture'), { phase: 'complete', roundId: 'r01', revision: 4, lastRevealedRoundId: 'r01' });
});

test('server denies direct phase/order/schema/provider/version/private/deletion attacks', async () => {
    const h = await host(), a = await guest('Guarded'), outsider = await guest();
    const base = 'events/fixture';
    const s = { phase: 'guessing', roundId: 'r01', revision: 1 };
    const start = { [`${base}/public/state`]: s, [`${base}/public/rounds/r01/clue`]: clue(1) };
    for (const [uid, provider] of [[hostUid, 'anonymous'], ['wrong-host', 'password']]) {
        const db = env.authenticatedContext(uid, { firebase: { sign_in_provider: provider } }).database();
        await denied(get(ref(db, `${base}/private/rounds/r01`)));
        await denied(toolRequire('firebase/database').update(ref(db), start));
    }
    for (const target of ['hostUid', 'public/formatVersion', 'public/roundCount', 'private/rounds/r01', 'public/participants/' + a.uid, 'public/slots/s01']) {
        await denied(h.database.ref(`${base}/${target}`).set(null));
        await denied(a.database.ref(`${base}/${target}`).set(null));
    }
    await denied(h.database.ref(`${base}/public/state`).set(s));
    await denied(h.database.ref().update({ ...start, [`${base}/public/state`]: { ...s, revision: 2 } }));
    await denied(h.database.ref().update({ ...start, [`${base}/public/rounds/r01/clue`]: { ...clue(1), answer: { lat: 0, lng: 0 } } }));
    await denied(h.database.ref().update({ ...start, [`${base}/public/rounds/r01/clue`]: { ...clue(1), panoramaId: 'wrong' } }));
    await h.service.start('fixture', expected(1, 0));
    await denied(outsider.database.ref(`${base}/private/guesses/r01/${outsider.uid}`).set({ lat: 0, lng: 0 }));
    for (const value of [{ lat: 91, lng: 0 }, { lat: 0, lng: 181 }, { lat: '0', lng: 0 }, { lat: 0, lng: 0, extra: true }]) await denied(a.database.ref(`${base}/private/guesses/r01/${a.uid}`).set(value));
    await a.service.submitGuess('fixture', 'r01', { lat: 0, lng: 0 });
    await h.service.close('fixture', expected(1, 1)); await h.service.reveal('fixture', expected(1, 2));
    for (const target of [base, `${base}/public`, `${base}/public/state`, `${base}/public/state/phase`, `${base}/public/rounds/r01`, `${base}/public/rounds/r01/clue`, `${base}/public/rounds/r01/reveal`, `${base}/public/rounds/r01/reveal/results/${a.uid}`, `${base}/private/guesses/r01/${a.uid}`]) await denied(h.database.ref(target).set(null));
    await denied(h.database.ref(`${base}/public/rounds/r01/reveal/results/${a.uid}/totalPoints`).set(0));
    await denied(h.database.ref(`${base}/public/state`).set({ phase: 'ready', roundId: 'r03', revision: 4, lastRevealedRoundId: 'r01' }));
    await denied(h.database.ref(`${base}/public/state`).set({ phase: 'complete', roundId: 'r01', revision: 4, lastRevealedRoundId: 'r01' }));
    await seed(2, 'unknown'); await trusted(db => set(ref(db, 'events/unknown/public/formatVersion'), 3));
    await denied(h.database.ref('events/unknown/public/state').once('value'));
    await denied(h.database.ref('events/unknown/private/rounds/r01').once('value'));
    await denied(h.database.ref('events/unknown/public/state').set(s));
});

test('server now expires first guesses, retains state and permits deliberate current-round extension', async () => {
    const h = await host(), a = await guest('Early'), b = await guest('Late', 2);
    await h.service.start('fixture', expected(1, 0));
    const target = (await h.service.getServerTime('fixture')).nowMs + 1200;
    await h.service.setDeadline('fixture', expected(1, 1), target);
    await a.service.submitGuess('fixture', 'r01', { lat: 0, lng: 0 });
    await pause(Math.max(0, target - Date.now()) + 100);
    await denied(b.database.ref(`events/fixture/private/guesses/r01/${b.uid}`).set({ lat: 0, lng: 0 }));
    assert.equal((await h.service.getState('fixture')).phase, 'guessing');
    assert.equal(await h.service.getReveal('fixture', 'r01'), null);
    const future = Date.now() + 60000;
    const timingPath = 'events/fixture/public/rounds/r01/timing';
    for (const value of [null, { roundId: 'r02', deadlineMs: future }, { roundId: 'r01', deadlineMs: Date.now() }, { roundId: 'r01', deadlineMs: future + 0.5 }, { roundId: 'r01', deadlineMs: future, extra: true }]) await denied(h.database.ref(timingPath).set(value));
    await h.service.setDeadline('fixture', expected(1, 1), future);
    await b.service.submitGuess('fixture', 'r01', { lat: 0, lng: 0 });
    await h.service.close('fixture', expected(1, 1)); await h.service.reveal('fixture', expected(1, 2)); await h.service.next('fixture', expected(1, 3)); await h.service.start('fixture', expected(2, 0));
    await denied(h.database.ref(timingPath).set({ roundId: 'r01', deadlineMs: future + 1000 }));
    assert.equal(await h.service.getTiming('fixture', 'r02'), null);
});

test('50 SDK guests complete 20 real rounds with answered/unanswered capacity and exact recurrence', async () => {
    await seed(20);
    const h = await host();
    const guests = await Promise.all(Array.from({ length: 50 }, (_, i) => guest(`Guest ${i + 1}`, i + 1)));
    const extra = await guest();
    await denied(extra.database.ref().update({ [`events/fixture/public/participants/${extra.uid}`]: { nickname: '51', slot: 's51' }, 'events/fixture/public/slots/s51': extra.uid }));
    let totals = Object.fromEntries(guests.map(g => [g.uid, 0]));
    for (let n = 1; n <= 20; n++) {
        await h.service.start('fixture', expected(n, 0));
        const answered = n === 1 ? guests : n === 2 ? [] : guests.filter((_, i) => (i + n) % 2 === 0);
        await Promise.all(answered.map(g => g.service.submitGuess('fixture', rid(n), { lat: 0, lng: 0 })));
        await h.service.close('fixture', expected(n, 1));
        if (n === 20) {
            const results = Object.fromEntries(guests.map(g => [g.uid, { nickname: `Guest ${guests.indexOf(g) + 1}`, answered: answered.includes(g), points: answered.includes(g) ? 5000 : 0, totalPoints: totals[g.uid] + (answered.includes(g) ? 5000 : 0), ...(answered.includes(g) ? { distance: 0 } : {}) }]));
            const publish = value => h.database.ref().update({ 'events/fixture/public/state': { phase: 'reveal', roundId: 'r20', revision: 79, lastRevealedRoundId: 'r20' }, 'events/fixture/public/rounds/r20/reveal': { roundId: 'r20', answer: { lat: 0, lng: 0 }, results: value } });
            const missing = { ...results }; delete missing[guests[49].uid]; await denied(publish(missing));
            await denied(publish({ ...results, [guests[49].uid]: { ...results[guests[49].uid], totalPoints: results[guests[49].uid].totalPoints + 1 } }));
            const prior = await stored(`events/fixture/public/rounds/r19/reveal/results/${guests[49].uid}`);
            await trusted(db => set(ref(db, `events/fixture/public/rounds/r19/reveal/results/${guests[49].uid}`), null));
            await denied(publish(results));
            await trusted(db => set(ref(db, `events/fixture/public/rounds/r19/reveal/results/${guests[49].uid}`), prior));
        }
        await h.service.reveal('fixture', expected(n, 2));
        const reveal = await h.service.getReveal('fixture', rid(n));
        assert.equal(Object.keys(reveal.results).length, 50);
        for (const g of guests) { totals[g.uid] += answered.includes(g) ? 5000 : 0; assert.equal(reveal.results[g.uid].totalPoints, totals[g.uid]); }
        if (n < 20) await h.service.next('fixture', expected(n, 3));
        else await h.service.complete('fixture', expected(n, 3));
    }
    assert.deepEqual(await h.service.getState('fixture'), { phase: 'complete', roundId: 'r20', revision: 80, lastRevealedRoundId: 'r20' });
    assert.equal(await stored('events/fixture/public/totals'), null);
    // Reuse the actual r19 history in isolated disposable boundary fixtures; each
    // r20 start/guess/close/reveal/complete still runs through the application SDK.
    const history = await stored('events/fixture');
    for (const answerAll of [true, false]) {
        const eventId = answerAll ? 'all-answered-r20' : 'all-unanswered-r20';
        const fixture = JSON.parse(JSON.stringify(history));
        fixture.public.state = { phase: 'ready', roundId: 'r20', revision: 76, lastRevealedRoundId: 'r19' };
        delete fixture.public.rounds.r20;
        delete fixture.private.guesses.r20;
        await trusted(db => set(ref(db, `events/${eventId}`), fixture));
        await h.service.start(eventId, expected(20, 0));
        if (answerAll) await Promise.all(guests.map(g => g.service.submitGuess(eventId, 'r20', { lat: 0, lng: 0 })));
        await h.service.close(eventId, expected(20, 1));
        await h.service.reveal(eventId, expected(20, 2));
        const boundary = await h.service.getReveal(eventId, 'r20');
        assert.equal(Object.keys(boundary.results).length, 50);
        for (const g of guests) {
            assert.equal(boundary.results[g.uid].answered, answerAll);
            assert.equal(boundary.results[g.uid].totalPoints, history.public.rounds.r19.reveal.results[g.uid].totalPoints + (answerAll ? 5000 : 0));
        }
        await h.service.complete(eventId, expected(20, 3));
    }
});

for (const method of ['reveal', 'next', 'setDeadline']) for (const outcome of ['accepted', 'rejected']) {
    test(`real SDK8 ${method} uncertain ${outcome} acknowledgement preserves original command and shared barrier`, async () => {
        const queued = deferred(); let arm = false;
        const intercept = (database, changes) => { if (arm) { arm = false; database.goOffline(); queued.resolve(); } return database.ref().update(changes); };
        const h = await host(intercept); await guest('Queued'); await h.service.start('fixture', expected(1, 0));
        if (method !== 'setDeadline') await h.service.close('fixture', expected(1, 1));
        if (method === 'next') await h.service.reveal('fixture', expected(1, 2));
        const exp = expected(1, method === 'reveal' ? 2 : method === 'next' ? 3 : 1), absolute = Date.now() + 120000;
        const call = service => method === 'setDeadline' ? service.setDeadline('fixture', exp, absolute) : service[method]('fixture', exp);
        arm = true;
        const timeout = assert.rejects(call(h.service), error => error.code === 'unavailable');
        await queued.promise; await timeout;
        const fresh = createSessionClient(h.injected, h.identity);
        let retrySettled = false, readSettled = false;
        const retry = call(fresh).then(value => { retrySettled = true; return { value }; }, error => { retrySettled = true; return { error }; });
        const read = Promise.all([fresh.getState('fixture'), method === 'reveal' ? fresh.getReveal('fixture', 'r01') : method === 'next' ? fresh.getClue('fixture', 'r02') : fresh.getTiming('fixture', 'r01')]).then(value => { readSettled = true; return value; });
        await pause(100); assert.equal(retrySettled, false); assert.equal(readSettled, false);
        if (outcome === 'rejected') await trusted(db => set(ref(db, 'events/fixture/hostUid'), 'revoked-by-trusted-fixture'));
        h.database.goOnline(); const result = await retry; await read;
        if (outcome === 'accepted') { assert.equal(result.error, undefined); assert.equal(result.value.status, { reveal: 'already-revealed', next: 'already-advanced', setDeadline: 'already-set' }[method]); }
        else { assert.ok(result.error); assert.equal((await stored('events/fixture/public/state')).revision, exp.revision); }
    });
}
