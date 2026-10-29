'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomBytes } = require('node:crypto');
const { PROJECT, DATABASE } = require('./emulator.cjs');

// Guards precede Admin SDK imports/initialization and any fixture requests.
assert.equal(process.env.GCLOUD_PROJECT, PROJECT);
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9099');
assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST, '127.0.0.1:9009');
for (const key of ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[key];
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getDatabase } = require('firebase-admin/database');
const { adminAdapter } = require('./live.cjs');
const { provision } = require('./core.cjs');

test('actual Admin Auth lookup and transaction preserve one winner and existing event', { timeout: 45000 }, async () => {
    const eventId = `admin_seed_${randomBytes(8).toString('hex')}`;
    const target = { projectId: PROJECT, databaseUrl: DATABASE, eventId };
    let app, database, auth, uid;
    try {
        const response = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: `${eventId}@example.test`, password: randomBytes(24).toString('hex'), returnSecureToken: true }),
        });
        assert.equal(response.ok, true, 'Could not create guarded fixture account');
        uid = (await response.json()).localId;
        app = initializeApp({ projectId: PROJECT, databaseURL: DATABASE, credential: { getAccessToken: async () => ({ access_token: 'owner', expires_in: 3600 }) } }, eventId);
        auth = getAuth(app); database = getDatabase(app);
        const adapter = adminAdapter(target, { auth, database }, 'emulator');
        const input = { ...target, event: { hostUid: uid, public: { title: 'Synthetic Admin seed', phase: 'lobby' }, private: { round: { id: 'r1', panoramaId: 'fictional-admin-panorama', heading: 37, pitch: -4, answer: { lat: 10, lng: 20 }, difficulty: 2000 } } } };
        const user = await adapter.getUser(uid);
        assert.equal(user.uid, uid); assert.equal(user.disabled, false);
        assert.equal(user.providerData.some(value => value.providerId === 'password'), true);
        const results = await Promise.allSettled(Array.from({ length: 5 }, () => provision(input, target, { apply: true, adapter })));
        assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
        assert.equal(results.filter(value => value.status === 'rejected' && value.reason.code === 'event-exists').length, 4);
        assert.deepEqual((await database.ref(`events/${eventId}`).once('value')).val(), input.event);
        const replacement = structuredClone(input); replacement.event.public.title = 'Must not replace';
        await assert.rejects(provision(replacement, target, { apply: true, adapter }), { code: 'event-exists' });
        assert.deepEqual((await database.ref(`events/${eventId}`).once('value')).val(), input.event);
        await auth.updateUser(uid, { disabled: true });
        await assert.rejects(provision(input, target, { apply: true, adapter }), { code: 'invalid-host' });
    } finally {
        if (database) await database.ref(`events/${eventId}`).remove();
        if (auth && uid) await auth.deleteUser(uid);
        if (database) database.goOffline();
        if (app) await deleteApp(app);
    }
});
