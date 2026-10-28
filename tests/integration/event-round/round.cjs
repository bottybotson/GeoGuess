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
// No provider setup or credential generation precedes the fail-closed guards.
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
const { ref, get, set, update } = toolRequire('firebase/database');
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
const { createRoundClient } = sourceModule(path.join(appRoot, 'src/event/round.js'));
const { createLobbyClient } = sourceModule(path.join(appRoot, 'src/event/lobby.js'));
const { getScore } = sourceModule(path.join(appRoot, 'src/utils/game/score.js'));
const turf = appRequire('@turf/distance').default;
const setup = { id: 'r1', panoramaId: 'emulator-fictional-panorama', heading: 37, pitch: -4,
    answer: { lat: 0, lng: 0 }, difficulty: 2000 };
const clue = { id: setup.id, panoramaId: setup.panoramaId, heading: setup.heading, pitch: setup.pitch };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const denied = promise => assert.rejects(promise, error => /permission.denied/i.test(error.code || error.message));
let env;
let serial = 0;
let hostUid;
let email;
let password;
const apps = [];
const trusted = async callback => {
    let value;
    await env.withSecurityRulesDisabled(async context => { value = await callback(context.database()); });
    return value;
};
const stored = target => trusted(db => get(ref(db, target)).then(snapshot => snapshot.val()));
function rawClient(intercept) {
    const app = firebase.initializeApp({ apiKey: 'emulator-only-key', projectId: PROJECT,
        databaseURL: `https://${PROJECT}.firebaseio.com` }, `round_${serial++}`);
    apps.push(app);
    const auth = app.auth();
    auth.useEmulator('http://127.0.0.1:9099', { disableWarnings: true });
    const database = app.database();
    database.useEmulator('127.0.0.1', 9009);
    const injected = intercept ? { ref(target) {
        return target === undefined ? { update: changes => intercept(database, changes) } : database.ref(target);
    } } : database;
    const identity = { ensureUser: async () => auth.currentUser };
    return { app, auth, database, injected, identity, service: createRoundClient(injected, identity),
        lobby: createLobbyClient(injected, { ensureGuest: identity.ensureUser }) };
}
async function host(intercept) {
    const client = rawClient(intercept);
    await client.auth.signInWithEmailAndPassword(email, password);
    assert.equal(client.auth.currentUser.uid, hostUid);
    assert.equal((await client.auth.currentUser.getIdTokenResult()).signInProvider, 'password');
    return client;
}
async function guest(nickname, eventId = 'fixture', intercept) {
    const client = rawClient(intercept);
    await client.auth.signInAnonymously();
    client.uid = client.auth.currentUser.uid;
    if (nickname) assert.equal((await client.lobby.join(eventId, nickname)).status, 'joined');
    return client;
}
before(async () => {
    env = await initializeTestEnvironment({ projectId: PROJECT, database: { host: '127.0.0.1', port: 9009,
        rules: fs.readFileSync(path.join(__dirname, 'rules.json'), 'utf8') } });
    email = `organizer-${Date.now()}@emulator.invalid`;
    password = `emulator-fixture-${Date.now()}-only`;
    // Disposable email/password user, provisioned only after demo/loopback guards.
    const provisioning = rawClient();
    await provisioning.auth.createUserWithEmailAndPassword(email, password);
    hostUid = provisioning.auth.currentUser.uid;
});
beforeEach(async () => {
    await env.clearDatabase();
    await trusted(db => set(ref(db, 'events/fixture'), {
        hostUid, public: { title: 'Local one-round proof', phase: 'lobby' }, private: { round: setup },
    }));
});
afterEach(async () => {
    for (const app of apps.splice(0)) { await app.auth().signOut(); app.database().goOffline(); await app.delete(); }
});
after(async () => { if (env) await env.cleanup(); });

test('actual password host and anonymous guests complete one immutable scored round', async () => {
    const h = await host();
    const a = await guest('Alex');
    const b = await guest('Missing');
    assert.equal(await a.service.getRound('fixture'), null);
    assert.equal(await a.service.getReveal('fixture'), null);
    await denied(a.service.getHostSetup('fixture'));
    await denied(a.service.start('fixture'));
    assert.deepEqual(await h.service.start('fixture'), { status: 'started' });
    assert.deepEqual(await a.service.getRound('fixture'), clue);
    for (const guess of [{ lat: 91, lng: 0 }, { lat: 0, lng: 181 }, { lat: '0', lng: 0 }, { lat: 0, lng: 0, score: 5000 }]) {
        await denied(a.database.ref(`events/fixture/private/guesses/r1/${a.uid}`).set(guess));
    }
    const position = { lat: 10, lng: 20 };
    assert.deepEqual(await a.service.submitGuess('fixture', 'r1', position), { status: 'submitted', guess: position });
    assert.deepEqual(await createRoundClient(a.database, a.identity).submitGuess('fixture', 'r1', { lat: 0, lng: 0 }), { status: 'already-submitted', guess: position });
    assert.deepEqual(await a.service.getOwnGuess('fixture', 'r1'), position);
    await denied(b.database.ref(`events/fixture/private/guesses/r1/${a.uid}`).once('value'));
    await denied(a.database.ref('events/fixture/private/guesses/r1').once('value'));
    await denied(a.database.ref('events/fixture/private/round/answer').once('value'));
    await assert.rejects(h.service.reveal('fixture'), error => error.code === 'invalid-phase');
    assert.deepEqual(await h.service.close('fixture'), { status: 'closed' });
    await denied(b.service.submitGuess('fixture', 'r1', { lat: 0, lng: 0 }));
    assert.deepEqual(await h.service.reveal('fixture'), { status: 'revealed' });
    const revealed = await a.service.getReveal('fixture');
    const meters = Math.floor(turf([0, 0], [20, 10], { units: 'meters' }));
    assert.deepEqual(revealed, { roundId: 'r1', answer: setup.answer, results: {
        [a.uid]: { nickname: 'Alex', answered: true, points: getScore(meters, 2000, 0, 'normal'), distance: meters },
        [b.uid]: { nickname: 'Missing', answered: false, points: 0 },
    } });
    assert.deepEqual(await h.service.start('fixture'), { status: 'already-started' });
    assert.deepEqual(await h.service.close('fixture'), { status: 'already-closed' });
    assert.deepEqual(await createRoundClient(h.database, h.identity).reveal('fixture'), { status: 'already-revealed' });
    assert.deepEqual(await h.service.getReveal('fixture'), revealed);
    assert.equal(Object.hasOwn((await stored('events/fixture/public/participants')), hostUid), false);
});

test('server protects host binding, phase order, every immutable payload and private grants', async () => {
    const h = await host();
    const a = await guest('Guest');
    const outsider = await guest();
    await guest('Also missing');
    const presenter = rawClient();
    const base = 'events/fixture';
    // A password user with the wrong UID cannot become this event's host.
    const wrong = rawClient();
    await wrong.auth.createUserWithEmailAndPassword(`wrong-${Date.now()}@emulator.invalid`, password);
    // Even a matching UID with an anonymous token must fail host operations.
    const anonymousHostDb = env.authenticatedContext(hostUid, { firebase: { sign_in_provider: 'anonymous' } }).database();
    for (const client of [a, outsider, presenter, wrong]) {
        for (const target of [base, `${base}/public`, `${base}/hostUid`, `${base}/private`, `${base}/private/round`, `${base}/private/guesses/r1`]) {
            await denied(client.database.ref(target).once('value'));
        }
        for (const target of [`${base}/hostUid`, `${base}/public/title`, `${base}/private/round`]) {
            await denied(client.database.ref(target).set(null));
        }
        await denied(client.database.ref(`${base}/public/phase`).set('guessing'));
        await denied(client.database.ref().update({ [`${base}/public/round`]: clue, [`${base}/public/phase`]: 'guessing' }));
    }
    await assert.rejects(get(ref(anonymousHostDb, `${base}/private/round`)));
    await assert.rejects(set(ref(anonymousHostDb, `${base}/public/phase`), 'guessing'));
    await assert.rejects(update(ref(anonymousHostDb), { [`${base}/public/round`]: clue, [`${base}/public/phase`]: 'guessing' }));
    await denied(h.database.ref(`${base}/hostUid`).set(h.auth.currentUser.uid));
    await denied(h.database.ref(`${base}/private/round`).set(setup));
    await denied(h.database.ref(`${base}/public/phase`).set('closed'));
    await denied(h.database.ref(`${base}/public/phase`).set('guessing'));
    await denied(h.database.ref(`${base}/public/round`).set(clue));
    await denied(h.database.ref().update({ [`${base}/public/round`]: { ...clue, extra: true }, [`${base}/public/phase`]: 'guessing' }));
    await denied(h.database.ref().update({ [`${base}/public/round`]: { ...clue, heading: 1 }, [`${base}/public/phase`]: 'guessing' }));
    await h.service.start('fixture');
    await denied(outsider.database.ref(`${base}/private/guesses/r1/${outsider.uid}`).set({ lat: 0, lng: 0 }));
    await denied(a.database.ref(`${base}/private/guesses/r1/${outsider.uid}`).set({ lat: 0, lng: 0 }));
    for (const target of [`${base}/public/round`, `${base}/public/round/heading`, `${base}/public/phase`]) {
        await denied(h.database.ref(target).set(null));
    }
    await denied(h.database.ref(`${base}/public/round`).set(clue));
    await denied(h.database.ref(`${base}/public/phase`).set('reveal'));
    await a.service.submitGuess('fixture', 'r1', { lat: -90, lng: 180 });
    for (const client of [a, h]) {
        await denied(client.database.ref(`${base}/private/guesses/r1/${a.uid}`).set(null));
        await denied(client.database.ref(`${base}/private/guesses/r1/${a.uid}`).set({ lat: 0, lng: 0 }));
        await denied(client.database.ref(`${base}/private/guesses/r1/${a.uid}/lat`).set(1));
    }
    await h.service.close('fixture');
    await denied(h.database.ref(`${base}/public/phase`).set('guessing'));
    const payload = { roundId: 'r1', answer: setup.answer, results: { [a.uid]: { nickname: 'Guest', answered: true, points: 0, distance: 1 } } };
    for (const value of [payload, { ...payload, extra: true }, { ...payload, answer: { lat: 1, lng: 0 } },
        { ...payload, results: { [a.uid]: { nickname: 'Guest', answered: false, points: 0 } } },
        { ...payload, results: { invalid: payload.results[a.uid] } }]) {
        await denied(h.database.ref().update({ [`${base}/public/reveal`]: value, [`${base}/public/phase`]: 'reveal' }));
    }
    await denied(h.database.ref(`${base}/public/reveal`).set(payload));
    await h.service.reveal('fixture');
    for (const client of [a, h]) {
        for (const target of [base, `${base}/public`, `${base}/public/reveal`, `${base}/public/reveal/results/${a.uid}`]) {
            await denied(client.database.ref(target).set(null));
        }
        await denied(client.database.ref(`${base}/public/reveal/results/${a.uid}/points`).set(5000));
        await denied(client.database.ref(`${base}/public/phase`).set('closed'));
    }
    assert.ok((await presenter.service.getReveal('fixture')).answer);
    assert.equal(presenter.auth.currentUser, null);
    assert.ok((await presenter.database.ref(`${base}/public/reveal`).once('value')).val().answer);
});

test('close versus guess race follows an independent authoritative observer order', async () => {
    const h = await host();
    const a = await guest('Race');
    await h.service.start('fixture');
    const observed = [];
    let stop;
    let notify = () => {};
    await trusted(async database => {
        const { onValue } = toolRequire('firebase/database');
        try {
            await new Promise((resolve, reject) => { stop = onValue(ref(database, 'events/fixture'), snapshot => {
                observed.push(snapshot.val()); notify(); resolve();
            }, reject); });
            const results = await Promise.allSettled([
                a.service.submitGuess('fixture', 'r1', { lat: 1, lng: 2 }), h.service.close('fixture'),
            ]);
            assert.equal(results[1].status, 'fulfilled');
            const accepted = results[0].status === 'fulfilled';
            const final = await stored('events/fixture');
            assert.equal(Boolean(final.private.guesses?.r1?.[a.uid]), accepted);
            assert.equal(final.public.phase, 'closed');
            let timer;
            await Promise.race([new Promise(resolve => { notify = () => {
                if (observed.some(value => value.public.phase === 'closed' && Boolean(value.private.guesses?.r1?.[a.uid]) === accepted)) resolve();
            }; notify(); }), new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('Observer deadline')), 10000); })]).finally(() => clearTimeout(timer));
            if (accepted) {
                const guessIndex = observed.findIndex(value => value.private.guesses?.r1?.[a.uid]);
                const closedIndex = observed.findIndex(value => value.public.phase === 'closed');
                assert.ok(guessIndex >= 0 && closedIndex > guessIndex);
            }
        } finally { if (stop) stop(); }
    });
});

for (const method of ['start', 'close', 'reveal', 'submitGuess', 'setDeadline']) {
    for (const outcome of ['accepted', 'rejected']) {
        test(`real SDK8 ${method} queued write waits for server ${outcome} acknowledgement across adapters`, async () => {
            const queued = deferred();
            let arm = false;
            const intercept = (database, changes) => {
                if (arm) { arm = false; database.goOffline(); queued.resolve(); }
                return database.ref().update(changes);
            };
            const h = await host(method === 'submitGuess' ? undefined : intercept);
            const a = await guest('Queued', 'fixture', method === 'submitGuess' ? intercept : undefined);
            if (method !== 'start') await h.service.start('fixture');
            if (method === 'reveal') await h.service.close('fixture');
            const c = method === 'submitGuess' ? a : h;
            const targetDeadline = Date.now() + 60000;
            const call = service => method === 'submitGuess' ? service.submitGuess('fixture', 'r1', { lat: 1, lng: 2 }) : method === 'setDeadline' ? service.setDeadline('fixture', targetDeadline) : service[method]('fixture');
            arm = true;
            const first = call(c.service);
            const timeout = assert.rejects(first, error => error.code === 'unavailable');
            await queued.promise;
            await timeout; // Real 15-second clock and real Firebase optimistic cache.
            const optimisticPath = `events/fixture/${method === 'submitGuess' ? `private/guesses/r1/${a.uid}` : method === 'setDeadline' ? 'public/timing' : 'public/phase'}`;
            assert.notEqual((await c.database.ref(optimisticPath).once('value')).val(), null);
            assert.deepEqual((await c.database.ref(optimisticPath).get()).val(), (await c.database.ref(optimisticPath).once('value')).val());
            const next = createRoundClient(c.injected, c.identity);
            let settled = false;
            const retry = call(next).then(value => { settled = true; return { value }; }, error => { settled = true; return { error }; });
            let readSettled = false;
            const read = (method === 'submitGuess' ? next.getOwnGuess('fixture', 'r1') :
                method === 'reveal' ? next.getReveal('fixture') : method === 'setDeadline' ? next.getTiming('fixture') : next.getRound('fixture'))
                .then(value => { readSettled = true; return value; });
            await pause(100);
            assert.equal(readSettled, false, 'Public and own-guess reads also must reject optimistic pending state');
            assert.equal(settled, false, 'Fresh adapters must wait for the raw SDK write, including rejected optimistic state');
            if (outcome === 'rejected') {
                if (method === 'submitGuess') await h.service.close('fixture');
                else await trusted(db => set(ref(db, 'events/fixture/hostUid'), 'revoked-by-trusted-fixture'));
            }
            c.database.goOnline();
            const result = await retry;
            await read;
            if (outcome === 'accepted') {
                assert.equal(result.error, undefined);
                assert.equal(result.value.status, { start: 'already-started', close: 'already-closed', reveal: 'already-revealed', submitGuess: 'already-submitted', setDeadline: 'already-set' }[method]);
            } else {
                assert.ok(result.error);
                if (method === 'submitGuess') assert.equal(await stored(`events/fixture/private/guesses/r1/${a.uid}`), null);
                else if (method === 'setDeadline') assert.equal(await stored('events/fixture/public/timing'), null);
                else assert.equal(await stored('events/fixture/public/phase'), { start: 'lobby', close: 'guessing', reveal: 'closed' }[method]);
            }
        });
    }
}

test('empty lobby cannot start through either adapter or raw atomic writes', async () => {
    const h = await host();
    await assert.rejects(h.service.start('fixture'), error => error.code === 'no-participants');
    await denied(h.database.ref().update({ 'events/fixture/public/round': clue, 'events/fixture/public/phase': 'guessing' }));
    assert.equal(await stored('events/fixture/public/phase'), 'lobby');
});

test('concurrent commands and same-UID guesses recover exactly one accepted immutable value', async () => {
    const h = await host();
    const h2 = await host();
    const a = await guest('Double click');
    const starts = await Promise.all([h.service.start('fixture'), h2.service.start('fixture')]);
    assert.deepEqual(starts.map(value => value.status).sort(), ['already-started', 'started']);
    const first = { lat: 1, lng: 2 };
    const second = { lat: 3, lng: 4 };
    const guesses = await Promise.all([
        a.service.submitGuess('fixture', 'r1', first),
        createRoundClient(a.database, a.identity).submitGuess('fixture', 'r1', second),
    ]);
    assert.deepEqual(guesses.map(value => value.status).sort(), ['already-submitted', 'submitted']);
    assert.deepEqual(guesses[0].guess, guesses[1].guess);
    const closes = await Promise.all([h.service.close('fixture'), h2.service.close('fixture')]);
    assert.deepEqual(closes.map(value => value.status).sort(), ['already-closed', 'closed']);
    const reveals = await Promise.all([h.service.reveal('fixture'), h2.service.reveal('fixture')]);
    assert.deepEqual(reveals.map(value => value.status).sort(), ['already-revealed', 'revealed']);
    const revealed = await h.service.getReveal('fixture');
    assert.equal(Object.keys(revealed.results).length, 1);
    assert.equal(await stored('events/fixture/public/totals'), null);
});

test('all 50 occupied slots receive canonical no-answer results and a missing last result is denied', async () => {
    const h = await host();
    const entrants = await Promise.all(Array.from({ length: 50 }, (_, index) => guest(`Capacity ${index}`)));
    const participants = await stored('events/fixture/public/participants');
    assert.equal(Object.keys(participants).length, 50);
    assert.equal(Object.hasOwn(participants, hostUid), false);
    await h.service.start('fixture');
    await h.service.close('fixture');
    const omittedUid = Object.keys(participants).find(uid => participants[uid].slot === 's50');
    assert.ok(omittedUid);
    const incomplete = Object.fromEntries(Object.entries(participants).filter(([uid]) => uid !== omittedUid)
        .map(([uid, member]) => [uid, { nickname: member.nickname, answered: false, points: 0 }]));
    await denied(h.database.ref().update({
        'events/fixture/public/phase': 'reveal',
        'events/fixture/public/reveal': { roundId: 'r1', answer: setup.answer, results: incomplete },
    }));
    assert.equal(await stored('events/fixture/public/phase'), 'closed');
    assert.deepEqual(await h.service.reveal('fixture'), { status: 'revealed' });
    const revealed = await entrants[0].service.getReveal('fixture');
    assert.deepEqual(Object.keys(revealed.results).sort(), Object.keys(participants).sort());
    for (const [uid, member] of Object.entries(participants)) {
        assert.deepEqual(revealed.results[uid], { nickname: member.nickname, answered: false, points: 0 });
    }
    assert.equal(await stored('events/fixture/private/guesses'), null);
});

test('all 50 answered guests receive exact 5000-point zero-distance canonical results', async () => {
    const h = await host();
    const entrants = await Promise.all(Array.from({ length: 50 }, (_, index) => guest(`Answered ${index}`)));
    const participants = await stored('events/fixture/public/participants');
    assert.equal(Object.keys(participants).length, 50);
    await h.service.start('fixture');
    const submissions = await Promise.all(entrants.map(client =>
        client.service.submitGuess('fixture', 'r1', { ...setup.answer })));
    assert.equal(submissions.length, 50);
    submissions.forEach(value => assert.deepEqual(value, { status: 'submitted', guess: setup.answer }));
    await h.service.close('fixture');
    const guesses = await stored('events/fixture/private/guesses/r1');
    assert.deepEqual(Object.keys(guesses).sort(), Object.keys(participants).sort());
    await h.service.reveal('fixture');
    const revealed = await entrants[0].service.getReveal('fixture');
    assert.deepEqual(Object.keys(revealed.results).sort(), Object.keys(participants).sort());
    for (const [uid, member] of Object.entries(participants)) {
        assert.deepEqual(revealed.results[uid], {
            nickname: member.nickname, answered: true, points: 5000, distance: 0,
        });
    }
    assert.equal(Object.hasOwn(revealed.results, hostUid), false);
    assert.deepEqual(await h.service.reveal('fixture'), { status: 'already-revealed' });
    assert.deepEqual(await h.service.getReveal('fixture'), revealed);
});

test('unauthenticated public reader reveals results without requesting or creating any identity', async () => {
    const h = await host();
    const a = await guest('Public result');
    const presenter = rawClient();
    let identityRequests = 0;
    const service = createRoundClient(presenter.database, { ensureUser() {
        identityRequests += 1;
        throw new Error('Public projection must not request authentication');
    } });
    assert.equal(presenter.auth.currentUser, null);
    assert.equal(await service.getRound('fixture'), null);
    assert.equal(await service.getReveal('fixture'), null);
    for (const target of ['events/fixture', 'events/fixture/private/round', `events/fixture/private/guesses/r1/${a.uid}`]) {
        await denied(presenter.database.ref(target).once('value'));
    }
    await h.service.start('fixture');
    assert.deepEqual(await service.getRound('fixture'), clue);
    assert.equal(await service.getReveal('fixture'), null);
    await a.service.submitGuess('fixture', 'r1', { ...setup.answer });
    await h.service.close('fixture');
    assert.equal(await service.getReveal('fixture'), null);
    await h.service.reveal('fixture');
    assert.deepEqual(await service.getReveal('fixture'), {
        roundId: 'r1', answer: setup.answer,
        results: { [a.uid]: { nickname: 'Public result', answered: true, points: 5000, distance: 0 } },
    });
    assert.equal(identityRequests, 0);
    assert.equal(presenter.auth.currentUser, null);
    await denied(presenter.database.ref('events/fixture/public/phase').set('closed'));
});


test('host absolute deadlines are monotonic, concurrent retry-safe and publicly readable without identity', async () => {
    const h = await host();
    const a = await guest('Timed');
    const presenter = rawClient();
    assert.equal(await presenter.service.getTiming('fixture'), null);
    const time = await presenter.service.getServerTime('fixture');
    assert.ok(Number.isSafeInteger(time.nowMs));
    assert.ok(Number.isFinite(time.offsetMs));
    assert.equal(presenter.auth.currentUser, null);
    await h.service.start('fixture');
    const target = time.nowMs + 60000;
    assert.deepEqual(await h.service.setDeadline('fixture', target), {
        status: 'set', timing: { roundId: 'r1', deadlineMs: target },
    });
    await denied(a.service.setDeadline('fixture', target + 10000));
    await denied(presenter.database.ref('events/fixture/public/timing').set({ roundId: 'r1', deadlineMs: target + 10000 }));
    const second = await host();
    const both = await Promise.all([
        second.service.setDeadline('fixture', target + 10000),
        h.service.setDeadline('fixture', target + 20000),
    ]);
    assert.ok(both.every(value => ['set', 'already-set'].includes(value.status)));
    const expected = { roundId: 'r1', deadlineMs: target + 20000 };
    assert.deepEqual(await presenter.service.getTiming('fixture'), expected);
    assert.deepEqual(await createRoundClient(h.database, h.identity).setDeadline('fixture', target), { status: 'already-set', timing: expected });
    assert.deepEqual(await second.service.setDeadline('fixture', target + 10000), { status: 'already-set', timing: expected });
    assert.equal(presenter.auth.currentUser, null);
});

test('server clock expires guesses while preserving phase and lets host deliberately extend after expiry', async () => {
    const h = await host();
    const early = await guest('Early');
    const late = await guest('Late');
    await h.service.start('fixture');
    const { nowMs } = await h.service.getServerTime('fixture');
    const deadlineMs = nowMs + 1500;
    await h.service.setDeadline('fixture', deadlineMs);
    await early.service.submitGuess('fixture', 'r1', { lat: 1, lng: 2 });
    await pause(Math.max(0, deadlineMs - Date.now()) + 75);
    await denied(late.database.ref(`events/fixture/private/guesses/r1/${late.uid}`).set({ lat: 3, lng: 4 }));
    assert.equal(await late.service.getOwnGuess('fixture', 'r1'), null);
    assert.equal(await stored('events/fixture/public/phase'), 'guessing');
    assert.equal(await stored('events/fixture/public/reveal'), null);
    // No clock value or client-supplied timestamp can override the Rules now check.
    await denied(late.database.ref(`events/fixture/private/guesses/r1/${late.uid}`).set({ lat: 3, lng: 4, submittedAt: deadlineMs - 1 }));
    const next = (await h.service.getServerTime('fixture')).nowMs + 60000;
    await h.service.setDeadline('fixture', next);
    await late.service.submitGuess('fixture', 'r1', { lat: 3, lng: 4 });
    await h.service.close('fixture');
    await denied(h.database.ref('events/fixture/public/timing').set({ roundId: 'r1', deadlineMs: next + 1000 }));
    await h.service.reveal('fixture');
    assert.equal((await late.service.getReveal('fixture')).results[late.uid].answered, true);
});

test('timing rules reject malformed, deleted, shortened, wrong-provider and phase-racing writes', async () => {
    const h = await host();
    await guest('Timing guards');
    const path = 'events/fixture/public/timing';
    let target = Date.now() + 60000;
    await denied(h.database.ref(path).set({ roundId: 'r1', deadlineMs: target }));
    await h.service.start('fixture');
    for (const timing of [
        { roundId: 'r2', deadlineMs: target }, { roundId: 'r1', deadlineMs: target, extra: true },
        { roundId: 'r1', deadlineMs: target + 0.5 }, { roundId: 'r1', deadlineMs: Date.now() },
        { roundId: 'r1', deadlineMs: Date.now() + 7260000 }, { roundId: 'r1' }, { deadlineMs: target },
    ]) await denied(h.database.ref(path).set(timing));
    for (const [uid, provider] of [[hostUid, 'anonymous'], ['wrong-password-host', 'password']]) {
        const db = env.authenticatedContext(uid, { firebase: { sign_in_provider: provider } }).database();
        await denied(set(ref(db, path), { roundId: 'r1', deadlineMs: target }));
    }
    await h.service.setDeadline('fixture', target);
    for (const leaf of [path, `${path}/roundId`, `${path}/deadlineMs`]) await denied(h.database.ref(leaf).set(null));
    await denied(h.database.ref(path).set({ roundId: 'r1', deadlineMs: target - 1000 }));
    await denied(h.database.ref().update({ [path]: { roundId: 'r1', deadlineMs: target + 10000 }, 'events/fixture/public/phase': 'closed' }));
    assert.equal(await stored('events/fixture/public/phase'), 'guessing');
    assert.deepEqual(await stored(path), { roundId: 'r1', deadlineMs: target });
    await h.service.close('fixture');
    await denied(h.database.ref(path).set({ roundId: 'r1', deadlineMs: target + 10000 }));
    await h.service.reveal('fixture');
    await denied(h.database.ref(path).set(null));
});
