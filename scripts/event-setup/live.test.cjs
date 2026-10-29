'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { provision } = require('./core.cjs');
const { LIVE_PROJECT, LIVE_DATABASE, assertLiveTarget, readServiceAccount, adminAdapter, createLiveAdapter } = require('./live.cjs');
const target = { projectId: LIVE_PROJECT, databaseUrl: LIVE_DATABASE, eventId: 'synthetic-live-adapter-test' };
const confirmation = { projectId: LIVE_PROJECT, databaseUrl: LIVE_DATABASE };
const input = () => ({ ...target, event: { hostUid: 'host-a', public: { title: 'Synthetic operator test', phase: 'lobby' }, private: { round: { id: 'r1', panoramaId: 'fictional-pano', heading: 10, pitch: 0, answer: { lat: 10, lng: 20 }, difficulty: 2000 } } } });
const account = () => ({ type: 'service_account', project_id: LIVE_PROJECT, client_email: `synthetic-test@${LIVE_PROJECT}.iam.gserviceaccount.com`, private_key: '-----BEGIN PRIVATE KEY-----\nsynthetic-test-only-not-a-real-key\n-----END PRIVATE KEY-----\n', token_uri: 'https://untrusted.invalid/token' });
function keyfile(run) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'geoguess-operator-key-'));
    const filename = path.join(directory, 'synthetic-key.json');
    fs.writeFileSync(filename, JSON.stringify(account()), { mode: 0o600 });
    try { return run(filename); }
    finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

test('live target, exact confirmations and environment guards precede SDK or credential access', () => {
    const loadSdk = () => assert.fail('No SDK initialization before guards');
    const invalid = [
        [{ ...target, projectId: 'other-project' }, confirmation, {}],
        [{ ...target, databaseUrl: 'https://other.firebaseio.com' }, confirmation, {}],
        [target, {}, {}], [target, { ...confirmation, databaseUrl: `${LIVE_DATABASE}/` }, {}],
        [target, confirmation, { FIREBASE_AUTH_EMULATOR_HOST: '' }],
        [target, confirmation, { FIREBASE_DATABASE_EMULATOR_HOST: '127.0.0.1:9009' }],
        [target, confirmation, { GOOGLE_CLOUD_PROJECT: 'another-project' }],
    ];
    for (const [selected, confirmed, environment] of invalid) {
        assert.throws(() => createLiveAdapter(selected, confirmed, { environment, loadSdk }), { code: 'live-target-required' });
    }
    assert.doesNotThrow(() => assertLiveTarget(target, confirmation, {}));
    assert.throws(() => createLiveAdapter(target, confirmation, { environment: {}, loadSdk }), { code: 'credential-required' });
});

test('service account project/email/permissions are bound before initialization and arbitrary token endpoints discarded', () => keyfile(filename => {
    const env = { GOOGLE_APPLICATION_CREDENTIALS: filename };
    assert.deepEqual(Object.keys(readServiceAccount(env, target)).sort(), ['clientEmail', 'privateKey', 'projectId']);
    for (const change of [value => value.project_id = 'another-project', value => value.client_email = 'other@another-project.iam.gserviceaccount.com', value => value.type = 'authorized_user']) {
        const value = account(); change(value); fs.writeFileSync(filename, JSON.stringify(value));
        assert.throws(() => readServiceAccount(env, target), error => error.code === 'credential-required' && !error.message.includes(filename));
    }
    fs.writeFileSync(filename, JSON.stringify(account())); fs.chmodSync(filename, 0o644);
    assert.throws(() => readServiceAccount(env, target), { code: 'credential-required' });
}));

test('factory initializes only the bound named app, redacts SDK failures and closes isolated services', async () => {
    let close;
    keyfile(filename => {
        const calls = [];
        const app = {};
        const runtime = createLiveAdapter(target, confirmation, {
            environment: { GOOGLE_APPLICATION_CREDENTIALS: filename },
            loadSdk: () => ({
                app: { cert(value) { calls.push(value); return 'credential'; }, initializeApp(options, name) { calls.push(options); assert.match(name, /^event-setup-/); return app; }, async deleteApp(value) { assert.equal(value, app); calls.push('delete'); } },
                auth: { getAuth(value) { assert.equal(value, app); return {}; } },
                database: { getDatabase(value) { assert.equal(value, app); return { goOffline() { calls.push('offline'); } }; } },
            }),
        });
        assert.deepEqual(calls[1], { projectId: LIVE_PROJECT, databaseURL: LIVE_DATABASE, credential: 'credential' });
        assert.equal(Object.hasOwn(calls[0], 'token_uri'), false);
        close = runtime.close().then(() => assert.deepEqual(calls.slice(-2), ['offline', 'delete']));
        assert.throws(() => createLiveAdapter(target, confirmation, { environment: { GOOGLE_APPLICATION_CREDENTIALS: filename }, loadSdk() { throw new Error('private-key-sensitive-details'); } }), error => error.code === 'admin-unavailable' && !error.message.includes('private-key'));
    });
    await close;
});

test('Admin adapter transactions never replace existing data even when SDK reruns callback after a concurrent winner', async () => {
    let stored = null;
    const services = {
        auth: { getUser: async uid => ({ uid, disabled: false, providerData: [{ providerId: 'password' }] }) },
        database: { ref(location) {
            assert.equal(location, `events/${target.eventId}`);
            return { async transaction(update, ignored, applyLocally) {
                assert.equal(applyLocally, false);
                update(null); // Initial cached-null invocation is not an acknowledgement.
                await Promise.resolve();
                const next = update(stored);
                if (next === undefined) return { committed: false };
                stored = next;
                return { committed: true };
            } };
        } },
    };
    const adapter = adminAdapter(target, services, 'live');
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => provision(input(), target, { apply: true, adapter })));
    assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
    assert.equal(results.filter(value => value.status === 'rejected' && value.reason.code === 'event-exists').length, 4);
    assert.equal(results.find(value => value.status === 'fulfilled').value.status, 'created-live-event');
    assert.deepEqual(stored, input().event);
    const replacement = input(); replacement.event.public.title = 'Replacement refused';
    await assert.rejects(provision(replacement, target, { apply: true, adapter }), { code: 'event-exists' });
    assert.deepEqual(stored, input().event);
});

test('CLI dry-run never loads credentials, live apply requires confirmations, and failures redact paths', () => keyfile(filename => {
    const directory = path.dirname(filename);
    const seed = path.join(directory, 'seed.json'); fs.writeFileSync(seed, JSON.stringify(input()));
    const args = [path.join(__dirname, 'cli.cjs'), '--input', seed, '--project', LIVE_PROJECT, '--database-url', LIVE_DATABASE, '--event-id', target.eventId];
    const dry = spawnSync(process.execPath, args, { encoding: 'utf8', env: { GOOGLE_APPLICATION_CREDENTIALS: '/missing-sensitive-file' } });
    assert.equal(dry.status, 0); assert.equal(JSON.parse(dry.stdout).written, false);
    const missingConfirmation = spawnSync(process.execPath, [...args, '--apply-live'], { encoding: 'utf8', env: {} });
    assert.equal(missingConfirmation.status, 1); assert.equal(JSON.parse(missingConfirmation.stderr).code, 'live-target-required');
    const noCredential = spawnSync(process.execPath, [...args, '--apply-live', '--confirm-project', LIVE_PROJECT, '--confirm-database-url', LIVE_DATABASE], { encoding: 'utf8', env: { GOOGLE_APPLICATION_CREDENTIALS: '/missing-sensitive-file' } });
    assert.equal(noCredential.status, 1); assert.equal(JSON.parse(noCredential.stderr).code, 'credential-required');
    assert.equal(noCredential.stderr.includes('sensitive'), false);
    const mixed = spawnSync(process.execPath, [...args, '--apply-live', '--apply-emulator'], { encoding: 'utf8', env: {} });
    assert.equal(mixed.status, 1);
}));

test('lookup timeout prevents creation; transaction timeout stays uncertain even if server later accepts it', async () => {
    let writes = 0;
    const blockedHost = adminAdapter(target, {
        auth: { getUser: () => new Promise(() => {}) },
        database: { ref() { writes++; assert.fail('No DB operation after an unconfirmed host lookup'); } },
    }, 'live', 5);
    await assert.rejects(provision(input(), target, { apply: true, adapter: blockedHost }), { code: 'host-lookup-failed' });
    assert.equal(writes, 0);
    let finish, offline = 0, stored = null;
    const services = {
        auth: { getUser: async uid => ({ uid, disabled: false, providerData: [{ providerId: 'password' }] }) },
        database: {
            goOffline() { offline++; },
            ref() { return { transaction(update) {
                return new Promise(resolve => { finish = () => { stored = update(stored); resolve({ committed: true }); }; });
            } }; },
        },
    };
    const uncertain = adminAdapter(target, services, 'live', 5);
    await assert.rejects(provision(input(), target, { apply: true, adapter: uncertain }), error => error.code === 'create-unconfirmed' && error.message === 'create-unconfirmed');
    assert.equal(offline, 1);
    finish(); // Transport teardown is not proof that an already-sent server write was cancelled.
    await Promise.resolve();
    assert.deepEqual(stored, input().event);
    const checkAgain = adminAdapter(target, {
        auth: services.auth,
        database: { ref() { return { async transaction(update) { assert.equal(update(stored), undefined); return { committed: false }; } }; } },
    }, 'live');
    await assert.rejects(provision(input(), target, { apply: true, adapter: checkAgain }), { code: 'event-exists' });
    assert.deepEqual(stored, input().event);
});
