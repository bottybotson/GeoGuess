#!/usr/bin/env node
'use strict';

// Intentionally separate from the app and its Firebase 8 dependency graph.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { test, before, after, beforeEach } = require('node:test');
// NODE_PATH alone is insufficient: the checkout's Firebase 8 wins nearest-node_modules
// resolution. Load every Firebase dependency from the isolated, pinned tool root.
const toolRequire = createRequire('/workspace/.geoguess-emulator-tools/package.json');
assert.equal(toolRequire('firebase/package.json').version, '11.10.0');
assert.equal(toolRequire('@firebase/rules-unit-testing/package.json').version, '4.0.1');
const { initializeTestEnvironment, assertFails, assertSucceeds } = toolRequire('@firebase/rules-unit-testing');
const { ref, get, set, update, onValue } = toolRequire('firebase/database');
const { setLogLevel } = toolRequire('firebase/app');

const PROJECT = 'demo-geoguess-admission';
const HOST = '127.0.0.1';
const PORT = 9009;
// Fail closed before initializing any Firebase app: never use a production endpoint.
assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST, `${HOST}:${PORT}`,
    `Run through the local database emulator with FIREBASE_DATABASE_EMULATOR_HOST=${HOST}:${PORT}`);
assert.equal(process.env.GCLOUD_PROJECT, PROJECT, 'The test requires the explicit demo project');
// Firebase's Node WebSocket transport forwards HTTP_PROXY even for loopback
// (it does not consult NO_PROXY). Only this fail-closed, local test child clears
// HTTP proxy settings; the CLI still uses its normal proxy for verified downloads.
delete process.env.HTTP_PROXY;
delete process.env.http_proxy;
setLogLevel('silent');
let env;
let serial = 0;
const clients = new Map();
const base = 'events/fixture';
const pub = `${base}/public`;
const slot = number => `s${String(number).padStart(2, '0')}`;
const bounded = async (promise, label, milliseconds = 10000) => {
    let timer;
    try {
        return await Promise.race([
            promise,
            new Promise((resolve, reject) => {
                timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), milliseconds);
            })
        ]);
    } finally {
        clearTimeout(timer);
    }
};
const db = uid => {
    if (!clients.has(uid)) clients.set(uid, env.authenticatedContext(uid).database());
    return clients.get(uid);
};
const anonymous = () => env.unauthenticatedContext().database();
const fixture = () => ({
    hostUid: 'organizer',
    public: { title: 'Local proof', phase: 'lobby' },
    private: { setup: 'private-fixture', answers: { r1: 42 }, guesses: { guest: 7 } }
});
// rules-unit-testing 4 returns Promise<void> from withSecurityRulesDisabled;
// explicitly capture callback results instead of assuming they are forwarded.
const trusted = async callback => {
    let result;
    await env.withSecurityRulesDisabled(async context => {
        result = await callback(context.database());
    });
    return result;
};
const readAll = async () => {
    const state = await trusted(database => get(ref(database, base)).then(snapshot => snapshot.val()));
    assert.ok(state && typeof state === 'object' && !Array.isArray(state), 'Trusted read must return the fixture object');
    assert.equal(state.hostUid, 'organizer', 'Trusted fixture host must remain intact');
    assert.ok(state.public && typeof state.public === 'object', 'Trusted read must include public state');
    return state;
};
const claim = (database, uid, seat, nickname = 'Guest', extras = {}) => update(ref(database), {
    [`${pub}/participants/${uid}`]: { slot: seat, nickname, ...extras },
    [`${pub}/slots/${seat}`]: uid
});

// This is a disposable test protocol, NOT an application adapter. Existing membership
// is read-only; SDK retries that rewrite it are deliberately forbidden by the rules.
async function attemptAdmission(database, uid, nickname, preference = 0, beforeFirstClaim) {
    for (let attempt = 0; attempt <= 50; attempt++) {
        const existing = await get(ref(database, `${pub}/participants/${uid}`));
        if (existing.exists()) return { status: 'rejoined', membership: existing.val() };
        const phase = await get(ref(database, `${pub}/phase`));
        if (phase.val() !== 'lobby') return { status: 'started' };
        const occupied = (await get(ref(database, `${pub}/slots`))).val() || {};
        const free = Array.from({ length: 50 }, (_, index) => slot(index + 1))
            .filter(seat => !Object.hasOwn(occupied, seat));
        if (!free.length) return { status: 'full' };
        const seat = free[(preference + attempt) % free.length];
        if (attempt === 0 && beforeFirstClaim) await beforeFirstClaim();
        try {
            await claim(database, uid, seat, nickname);
            return { status: 'joined', membership: { slot: seat, nickname } };
        } catch (error) {
            if (error.code !== 'PERMISSION_DENIED') throw error;
        }
    }
    throw new Error('Admission failed to converge after all possible slot conflicts');
}

before(async () => {
    env = await initializeTestEnvironment({
        projectId: PROJECT,
        database: { host: HOST, port: PORT, rules: fs.readFileSync(path.join(__dirname, 'rules.json'), 'utf8') }
    });
});
beforeEach(async () => {
    await env.clearDatabase();
    await trusted(database => set(ref(database, base), fixture()));
});
after(async () => { if (env) await env.cleanup(); });

test('merged post-write state admits a reciprocal pair, immutable thereafter', async () => {
    const guest = db('guest');
    await assertSucceeds(claim(guest, 'guest', 's01', 'Original'));
    const before = await readAll();
    await assertFails(claim(guest, 'guest', 's01', 'Replacement'));
    await assertFails(claim(guest, 'guest', 's01', 'Original'));
    assert.deepEqual(await attemptAdmission(guest, 'guest', 'Replacement'), {
        status: 'rejoined', membership: { slot: 's01', nickname: 'Original' }
    });
    assert.deepEqual(await readAll(), before);
});

test('51 independent authenticated clients race for exactly 50 reciprocal seats', async () => {
    const entrants = Array.from({ length: 51 }, (_, index) => ({
        uid: `race_${index}`, database: db(`race_${index}`), index
    }));
    // Force all 51 to observe the empty lobby and prepare the same first claim.
    let waiting = 0;
    let release;
    const barrier = new Promise(resolve => { release = resolve; });
    const beforeFirstClaim = () => {
        if (++waiting === entrants.length) release();
        return barrier;
    };
    const outcomes = await Promise.all(entrants.map(({ uid, database, index }) =>
        attemptAdmission(database, uid, `Guest ${index}`, 0, beforeFirstClaim)));
    assert.equal(outcomes.filter(outcome => outcome.status === 'joined').length, 50);
    assert.equal(outcomes.filter(outcome => outcome.status === 'full').length, 1);
    const state = await readAll();
    assert.equal(Object.keys(state.public.participants).length, 50);
    assert.equal(Object.keys(state.public.slots).length, 50);
    assert.equal(new Set(Object.values(state.public.slots)).size, 50);
    for (const [uid, membership] of Object.entries(state.public.participants)) {
        assert.equal(state.public.slots[membership.slot], uid);
    }
    assert.equal(Object.hasOwn(state.public.participants, 'organizer'), false);
    assert.equal(Object.hasOwn(state.public.participants, 'presenter'), false);
    const before = await readAll();
    await assertFails(claim(db('guest_51'), 'guest_51', 's01'));
    assert.equal((await attemptAdmission(db('guest_51'), 'guest_51', 'Late')).status, 'full');
    const winner = entrants[outcomes.findIndex(outcome => outcome.status === 'joined')];
    assert.equal((await attemptAdmission(winner.database, winner.uid, 'Overwrite')).status, 'rejoined');
    await set(ref(db('organizer'), `${pub}/phase`), 'guessing');
    assert.equal((await attemptAdmission(winner.database, winner.uid, 'Overwrite')).status, 'rejoined');
    const after = await readAll();
    assert.deepEqual(after.public.participants, before.public.participants);
    assert.deepEqual(after.public.slots, before.public.slots);
});

test('same UID competing joins and occupied-slot retry preserve one original name', async () => {
    const sameA = env.authenticatedContext('same').database();
    const sameB = env.authenticatedContext('same').database();
    const results = await Promise.allSettled([
        claim(sameA, 'same', 's01', 'First'), claim(sameB, 'same', 's02', 'Second')
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const state = await readAll();
    assert.equal(Object.keys(state.public.participants).length, 1);
    assert.equal(Object.keys(state.public.slots).length, 1);
    const original = state.public.participants.same;
    await assertFails(claim(db('other'), 'other', original.slot, 'Other'));
    assert.equal((await attemptAdmission(db('other'), 'other', 'Other')).status, 'joined');
    assert.deepEqual((await attemptAdmission(sameB, 'same', 'Changed')).membership, original);
});

test('every non-lobby phase denies new guests and permits read-only existing rejoin', async () => {
    await claim(db('existing'), 'existing', 's01', 'Original');
    for (const phase of ['guessing', 'reveal', 'complete']) {
        await set(ref(db('organizer'), `${pub}/phase`), phase);
        await assertFails(claim(db(`late_${phase}`), `late_${phase}`, 's02'));
        assert.deepEqual((await attemptAdmission(db('existing'), 'existing', null)).membership,
            { slot: 's01', nickname: 'Original' });
    }
});

test('host is provisioned, excluded, immutable; guest/presenter cannot control phase', async () => {
    await assertFails(claim(db('organizer'), 'organizer', 's01'));
    await assertFails(claim(anonymous(), 'unauthenticated', 's01'));
    for (const uid of ['guest', 'presenter', 'organizer']) {
        await assertFails(set(ref(db(uid), `${base}/hostUid`), uid));
        await assertFails(set(ref(db(uid), `${base}/hostUid`), null));
    }
    for (const uid of ['guest', 'presenter']) {
        await assertFails(set(ref(db(uid), `${pub}/phase`), 'guessing'));
    }
    await assertFails(set(ref(db('organizer'), `${pub}/phase`), null));
    await assertFails(set(ref(db('organizer'), `${pub}/phase`), 'arbitrary'));
    await assertSucceeds(set(ref(db('organizer'), `${pub}/phase`), 'guessing'));
    await assertFails(update(ref(db('self_provisioner')), {
        'events/unprovisioned/hostUid': 'self_provisioner',
        'events/unprovisioned/public/phase': 'lobby'
    }));
    await assertFails(update(ref(db('self_provisioner')), {
        'events/unprovisioned/public/participants/self_provisioner': { slot: 's01', nickname: 'Guest' },
        'events/unprovisioned/public/slots/s01': 'self_provisioner'
    }));
});

test('forged identities, orphan indexes, extra keys and multiple claims are denied atomically', async () => {
    const attacker = db('attacker');
    const unchanged = await readAll();
    await assertFails(claim(attacker, 'victim', 's01'));
    await assertFails(set(ref(attacker, `${pub}/participants/attacker`), { slot: 's01', nickname: 'Guest' }));
    await assertFails(set(ref(attacker, `${pub}/slots/s01`), 'attacker'));
    await assertFails(claim(attacker, 'attacker', 's01', 'Guest', { score: 999 }));
    await assertFails(update(ref(attacker), {
        [`${pub}/participants/attacker`]: { slot: 's01', nickname: 'Guest' },
        [`${pub}/slots/s01`]: 'victim'
    }));
    await assertFails(update(ref(attacker), {
        [`${pub}/participants/attacker`]: { slot: 's01', nickname: 'Guest' },
        [`${pub}/slots/s01`]: 'attacker', [`${pub}/slots/s02`]: 'attacker'
    }));
    for (const invalidSlot of ['s00', 's51', 's1', 's001', 'other']) {
        await assertFails(claim(attacker, 'attacker', invalidSlot));
    }
    await assertFails(update(ref(attacker), {
        [`${pub}/participants/attacker`]: { slot: 's01', nickname: 'Guest' },
        [`${pub}/slots/s01`]: 'attacker', [`${pub}/extra`]: true
    }));
    await assertFails(set(ref(attacker, pub), { phase: 'lobby', participants: { attacker: { slot: 's01', nickname: 'Guest' } } }));
    await assertFails(set(ref(attacker, base), { public: { phase: 'lobby' } }));
    assert.deepEqual(await readAll(), unchanged);
});

test('owner and other users cannot edit/delete either reciprocal record or ancestor', async () => {
    await claim(db('member'), 'member', 's01', 'Original');
    const unchanged = await readAll();
    for (const uid of ['member', 'attacker', 'organizer']) {
        const database = db(uid);
        for (const target of [
            `${pub}/participants/member`, `${pub}/participants/member/nickname`,
            `${pub}/participants/member/slot`, `${pub}/slots/s01`,
            `${pub}/participants`, `${pub}/slots`, pub, base, 'events'
        ]) await assertFails(set(ref(database, target), null));
        await assertFails(set(ref(database, `${pub}/participants/member/nickname`), 'Changed'));
        await assertFails(set(ref(database, `${pub}/participants/member/slot`), 's02'));
        await assertFails(set(ref(database, `${pub}/slots/s01`), uid));
        await assertFails(update(ref(database), {
            [`${pub}/participants/member`]: null, [`${pub}/slots/s01`]: null
        }));
    }
    assert.deepEqual(await readAll(), unchanged);
});

test('join racing host start follows authoritative accepted state order', async () => {
    const observed = [];
    let dispose;
    let notifyObserved = () => {};
    await trusted(async database => {
        try {
            await bounded(new Promise((resolve, reject) => {
                dispose = onValue(ref(database, base), snapshot => {
                    observed.push(snapshot.val()); notifyObserved(); resolve();
                }, reject);
            }), 'initial authoritative race observation');
            const results = await Promise.allSettled([
                claim(db('racer'), 'racer', 's01', 'Racer'),
                set(ref(db('organizer'), `${pub}/phase`), 'guessing')
            ]);
            assert.equal(results[1].status, 'fulfilled');
            const final = await readAll();
            const accepted = results[0].status === 'fulfilled';
            assert.equal(Boolean(final.public.participants?.racer), accepted);
            assert.equal(final.public.phase, 'guessing');
            // Write ACKs and get() use other connections. Wait for this observer
            // itself to catch up before judging its ordered state history.
            await bounded(new Promise(resolve => {
                notifyObserved = () => {
                    if (observed.some(state => state.public.phase === final.public.phase &&
                        Boolean(state.public.participants?.racer) === accepted)) resolve();
                };
                notifyObserved();
            }), 'authoritative final race observation');
            if (accepted) {
                const joinedIndex = observed.findIndex(state => state.public.participants?.racer);
                const startedIndex = observed.findIndex(state => state.public.phase === 'guessing');
                assert.ok(joinedIndex >= 0 && startedIndex > joinedIndex,
                    'Accepted admission must be observed before start, never first appear after it');
            }
        } finally {
            if (dispose) dispose();
        }
    });
    await assertFails(claim(db('after_start'), 'after_start', 's02'));
});

test('presenter subscribes to explicit public fields, disposes without any database writes', async () => {
    await claim(db('member'), 'member', 's01', 'Guest');
    const presenter = anonymous();
    const before = await readAll();
    const received = new Map();
    const unsubscribers = [];
    for (const field of ['title', 'phase', 'participants']) {
        await bounded(new Promise((resolve, reject) => {
            unsubscribers.push(onValue(ref(presenter, `${pub}/${field}`), snapshot => {
                received.set(field, (received.get(field) || 0) + 1);
                assert.ok(snapshot.exists()); resolve();
            }, reject));
        }), `initial presenter ${field} observation`);
    }
    for (const database of [presenter, db('member')]) {
        for (const target of [base, pub, `${base}/hostUid`, `${base}/private`,
            `${base}/private/setup`, `${base}/private/answers`, `${base}/private/guesses`]) {
            await assertFails(get(ref(database, target)));
        }
    }
    for (const unsubscribe of unsubscribers) unsubscribe();
    assert.deepEqual(await readAll(), before);
    const counts = new Map(received);
    await set(ref(db('organizer'), `${pub}/phase`), 'guessing');
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.deepEqual(received, counts);
    const after = await readAll();
    before.public.phase = 'guessing';
    assert.deepEqual(after, before);
    await assertFails(set(ref(presenter, `${pub}/phase`), 'lobby'));
    await assertFails(set(ref(presenter, base), null));
});

test('nickname rules match 1–20 Unicode code points including emoji and trim boundaries', async () => {
    const accepted = [
        'A', 'a'.repeat(20), '😀'.repeat(20), 'a'.repeat(19) + '😀',
        'e\u0301'.repeat(10), '👩‍👩‍👧‍👦', 'A B', 'A\nB', 'A\u0000B',
        'A' + '\n'.repeat(18) + 'B', '\u{10ffff}'.repeat(20), '\u200bGuest\u200b'
    ];
    for (const nickname of accepted) {
        assert.ok([...nickname].length <= 20);
        const uid = `unicode_${serial++}`;
        await assertSucceeds(claim(db(uid), uid, slot(serial), nickname));
        assert.equal((await get(ref(db(uid), `${pub}/participants/${uid}/nickname`))).val(), nickname);
    }
    const rejected = ['', 'a'.repeat(21), '😀'.repeat(21), 'a'.repeat(20) + '😀',
        ' ', '\tGuest', 'Guest\n', '\u00a0Guest', 'Guest\u2003', '\ufeffGuest', 'Guest\u3000'];
    // Every ECMAScript trim code point is rejected at either boundary; internal
    // whitespace and zero-width space remain valid as the pure contract requires.
    const whitespace = [9, 10, 11, 12, 13, 0x20, 0xa0, 0x1680,
        0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007,
        0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff];
    for (const codePoint of whitespace) {
        const character = String.fromCodePoint(codePoint);
        assert.equal(character.trim(), '');
        rejected.push(character + 'Guest', 'Guest' + character);
    }
    for (const nickname of rejected) {
        const uid = `invalid_${serial++}`;
        await assertFails(claim(db(uid), uid, 's50', nickname));
    }
    for (const nickname of [null, 12, {}, ['Guest']]) {
        const uid = `type_${serial++}`;
        await assertFails(claim(db(uid), uid, 's50', nickname));
    }
});
