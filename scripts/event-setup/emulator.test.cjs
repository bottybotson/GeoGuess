'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { provision } = require('./core.cjs');
const { emulatorAdapter, PROJECT, DATABASE } = require('./emulator.cjs');
assert.equal(process.env.GCLOUD_PROJECT, PROJECT);
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9099');
assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST, '127.0.0.1:9009');
test('real Auth lookup and ETag CAS create v1/v2 seeds without overwriting existing event', { timeout: 30000 }, async t => {
    for (const count of [0, 1, 2, 20]) await t.test(count ? `v2 ${count} rounds` : 'v1 single round', async () => {
        const eventId = `seed_test_${randomBytes(8).toString('hex')}`;
        const target = { projectId: PROJECT, databaseUrl: DATABASE, eventId };
        const dbUrl = `http://127.0.0.1:9009/events/${eventId}.json?ns=${PROJECT}`;
        let uid;
        try {
            // Test fixture only. The actual provisioner never creates accounts.
            const created = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${eventId}@example.test`, password: randomBytes(24).toString('hex'), returnSecureToken: true }),
            });
            assert.equal(created.ok, true, 'Could not create emulator fixture account');
            uid = (await created.json()).localId;
            assert.equal(typeof uid, 'string');
            const input = { ...target, event: { hostUid: uid, public: { title: 'Synthetic seed test', phase: 'lobby' }, private: { round: { id: 'r1', panoramaId: 'fictional-seed-panorama', heading: 37, pitch: -4, answer: { lat: 10, lng: 20 }, difficulty: 2000 } } } };
            if (count) {
                const { id, ...setup } = input.event.private.round;
                const rid = n => `r${String(n).padStart(2, '0')}`;
                input.event.public = { title: input.event.public.title, formatVersion: 2, roundCount: count, state: { phase: 'lobby', roundId: 'r01', revision: 0 } };
                input.event.private = { rounds: Object.fromEntries(Array.from({ length: count }, (_, i) => [rid(i + 1), {
                    ...setup, id: rid(i + 1), ...(i > 0 ? { previousRoundId: rid(i) } : {}), ...(i + 1 < count ? { nextRoundId: rid(i + 2) } : {}),
                }])) };
            }
            const adapter = emulatorAdapter(target);
            const user = await adapter.getUser(uid);
            assert.equal(user.uid === uid, true, 'Lookup must return actual requested UID');
            assert.equal(user.disabled, false);
            assert.equal(user.providerData.some(provider => provider.providerId === 'password'), true);
            const results = await Promise.allSettled(Array.from({ length: 5 }, () => provision(input, target, { apply: true, adapter })));
            assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
            assert.equal(results.filter(result => result.status === 'rejected' && result.reason.code === 'event-exists').length, 4);
            const read = () => fetch(dbUrl, { headers: { Authorization: 'Bearer owner' } }).then(response => response.json());
            const stored = await read();
            assert.deepEqual(stored, input.event);
            const changed = structuredClone(input); changed.event.public.title = 'Attempted replacement';
            await assert.rejects(provision(changed, target, { apply: true, adapter }), error => error.code === 'event-exists');
            assert.deepEqual(await read(), stored);
            const wrong = structuredClone(input); wrong.event.hostUid = 'nonexistent-emulator-account';
            await assert.rejects(provision(wrong, target, { apply: true, adapter }), error => error.code === 'host-lookup-failed');
        } finally {
            // Cleanup only the random fixture record/account, never a root reset.
            await fetch(dbUrl, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
            if (uid) await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:delete`, {
                method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ localId: uid }),
            });
        }
    });
});
