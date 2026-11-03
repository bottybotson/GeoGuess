'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { target, seed, clone } = require('./test-fixtures.cjs');
// All guards precede SDK loading, credentials, network calls and fixture writes.
assert.equal(process.env.GCLOUD_PROJECT, 'demo-geoguess-admission');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9099');
assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST, '127.0.0.1:9009');
assert.equal(target.projectId, 'demo-geoguess-admission');
assert.equal(target.databaseUrl, 'https://demo-geoguess-admission.firebaseio.com');
for (const name of ['GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CLOUD_PROJECT']) assert.equal(process.env[name], undefined);
for (const name of ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[name];
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getDatabase } = require('firebase-admin/database');
const { createAdminStore } = require('./store.cjs');
const { createCreationService } = require('./creation.cjs');
const toolRequire = createRequire('/workspace/.geoguess-emulator-tools/package.json');
const { initializeTestEnvironment } = toolRequire('@firebase/rules-unit-testing');
const appRequire = createRequire(path.resolve(__dirname, '../../package.json'));
const loaded = new Map();
function sourceModule(filename) {
  if (loaded.has(filename)) return loaded.get(filename).exports;
  const module = { exports: {} }; loaded.set(filename, module);
  const { code } = appRequire('@babel/core').transformSync(fs.readFileSync(filename, 'utf8'), {
    filename, babelrc: false, configFile: false, plugins: [appRequire.resolve('@babel/plugin-transform-modules-commonjs')],
  });
  const local = id => id.startsWith('.') ? sourceModule(path.resolve(path.dirname(filename), `${id}.js`)) : appRequire(id);
  new Function('require', 'module', 'exports', code)(local, module, module.exports); return module.exports;
}
const { createSessionClient } = sourceModule(path.resolve(__dirname, '../../src/event/session.js'));
const { createRoundClient } = sourceModule(path.resolve(__dirname, '../../src/event/round.js'));
async function signup(anonymous = false) {
  const response = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...(anonymous ? {} : { email: `fixture-${randomBytes(8).toString('hex')}@example.test`, password: randomBytes(24).toString('hex') }), returnSecureToken: true }),
  });
  assert.equal(response.ok, true); return response.json();
}
function tokenWith(token, fields) {
  // Auth emulator tokens are intentionally unsigned; production verification
  // is never switched to this test harness. Exercise the real Admin verifier.
  const [header, payload] = token.split('.');
  return `${header}.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), ...fields })).toString('base64url')}.`;
}
test('actual Auth/RTDB emulator endpoint proof', { timeout: 90000 }, async t => {
  // CLI's default namespace can differ from the explicit .firebaseio.com
  // namespace. Install the real combined Rules for this exact demo namespace;
  // otherwise its freshly auto-created database has emulator open defaults.
  const rulesEnvironment = await initializeTestEnvironment({ projectId: target.projectId,
    database: { host: '127.0.0.1', port: 9009, rules: fs.readFileSync(path.resolve(__dirname, '../../tests/integration/event-runtime/rules.json'), 'utf8') } });
  const app = initializeApp({ projectId: target.projectId, databaseURL: target.databaseUrl,
    credential: { getAccessToken: async () => ({ access_token: 'owner', expires_in: 3600 }) } }, `event-creation-${randomBytes(6).toString('hex')}`);
  const auth = getAuth(app), db = getDatabase(app), users = [], events = new Set(), ledgers = new Set();
  const store = createAdminStore(db), service = () => createCreationService({ auth, store, target });
  const write = async (id, event) => { events.add(id); await db.ref(`events/${id}`).set(event); };
  const account = await signup(); users.push(account.localId); ledgers.add(account.localId);
  try {
    for (const count of [0, 1, 2, 20]) await t.test(`password token + concurrent v${count ? 2 : 1} ${count || 1} rounds + runtime read + preserved progress`, async () => {
      const sourceEventId = `source_${randomBytes(8).toString('hex')}`, requestId = randomBytes(16).toString('hex');
      const source = seed(count, account.localId);
      if (count) source.public.state = { phase: 'complete', roundId: `r${String(count).padStart(2, '0')}`, revision: 90 };
      else source.public.phase = 'complete';
      source.public.totals = { guest: 25 }; source.guesses = { guest: { secret: 42 } }; source.participants = { guest: { name: 'Fixture' } };
      await write(sourceEventId, source); const before = (await db.ref(`events/${sourceEventId}`).once('value')).val();
      const input = { sourceEventId, requestId };
      const results = await Promise.all(Array.from({ length: 5 }, () => service().create(account.idToken, input)));
      assert.equal(results.filter(r => r.status === 'created').length, 1); assert.equal(new Set(results.map(r => r.eventId)).size, 1);
      const id = results[0].eventId; events.add(id);
      assert.deepEqual((await db.ref(`events/${id}`).once('value')).val(), seed(count, account.localId));
      assert.deepEqual((await db.ref(`events/${sourceEventId}`).once('value')).val(), before);
      const runtime = count ? createSessionClient(db, { ensureUser: async () => ({ uid: account.localId }) }) : createRoundClient(db, { ensureUser: async () => ({ uid: account.localId }) });
      if (count) {
        assert.deepEqual(await runtime.getState(id), seed(count, account.localId).public.state);
        for (const [roundId, setup] of Object.entries(seed(count, account.localId).private.rounds)) assert.deepEqual(await runtime.getHostSetup(id, roundId), setup);
      } else assert.deepEqual(await runtime.getHostSetup(id), seed(0, account.localId).private.round);
      const progressPath = count ? 'public/state' : 'public/phase';
      await db.ref(`events/${id}/${progressPath}`).set(count ? { phase: 'complete', roundId: 'r01', revision: 8 } : 'complete');
      await db.ref(`events/${id}/guesses`).set({ preserved: { lat: 42, lng: 20 } });
      const progressed = (await db.ref(`events/${id}`).once('value')).val();
      assert.equal((await service().create(account.idToken, input)).status, 'already-created');
      assert.deepEqual((await db.ref(`events/${id}`).once('value')).val(), progressed);
      const second = await service().create(account.idToken, { sourceEventId, requestId: randomBytes(16).toString('hex') });
      events.add(second.eventId); assert.notEqual(second.eventId, id);
    });
    await t.test('real Admin rejects anonymous/foreign/expired/revoked/disabled identities and enforces source ownership', async () => {
      const anonymous = await signup(true); users.push(anonymous.localId);
      const other = await signup(); users.push(other.localId);
      const sourceEventId = `auth_${randomBytes(8).toString('hex')}`; await write(sourceEventId, seed(0, account.localId));
      const input = { sourceEventId, requestId: randomBytes(16).toString('hex') };
      await assert.rejects(service().create(anonymous.idToken, input), { code: 'password-host-required' });
      await assert.rejects(service().create(other.idToken, input), { code: 'source-unavailable' });
      await assert.rejects(service().create(other.idToken, { ...input, sourceEventId: 'missing' }), { code: 'source-unavailable' });
      await assert.rejects(service().create(tokenWith(account.idToken, { aud: 'demo-foreign' }), input), { code: 'unauthenticated' });
      await assert.rejects(service().create(tokenWith(account.idToken, { exp: 1 }), input), { code: 'unauthenticated' });
      await auth.revokeRefreshTokens(other.localId);
      await assert.rejects(service().create(tokenWith(other.idToken, { auth_time: 1 }), input), { code: 'unauthenticated' });
      await auth.updateUser(other.localId, { disabled: true });
      await assert.rejects(service().create(other.idToken, input), { code: 'unauthenticated' });
    });
    await t.test('actual combined client Rules deny ledger reads/writes to password, anonymous and unauthenticated clients', async () => {
      const anonymous = await signup(true); users.push(anonymous.localId);
      const path = `eventCreationRequests/${account.localId}/${'b'.repeat(32)}`;
      await db.ref(path).set({ privateFixture: true });
      for (const token of [account.idToken, anonymous.idToken, null]) {
        const url = `http://127.0.0.1:9009/${path}.json?ns=${target.projectId}${token ? `&auth=${encodeURIComponent(token)}` : ''}`;
        for (const method of ['GET', 'PUT']) {
          const result = await fetch(url, { method, ...(method === 'PUT' ? { body: JSON.stringify({ forged: true }), headers: { 'Content-Type': 'application/json' } } : {}) });
          assert.equal([401, 403].includes(result.status), true, `ledger ${method} denial status: ${result.status}`);
        }
      }
      assert.deepEqual((await db.ref(path).once('value')).val(), { privateFixture: true });
    });
    await t.test('lost acknowledgement after real reservation/event commit recovers one immutable ID', async () => {
      for (const point of ['reserve', 'create']) {
        const sourceEventId = `crash_${randomBytes(8).toString('hex')}`; await write(sourceEventId, seed(2, account.localId));
        const input = { sourceEventId, requestId: randomBytes(16).toString('hex') };
        const failing = { ...store, [point]: async (...args) => { await store[point](...args); throw Object.assign(new Error(), { code: 'creation-unconfirmed' }); } };
        await assert.rejects(createCreationService({ auth, store: failing, target }).create(account.idToken, input), { code: 'creation-unconfirmed' });
        const reservation = (await db.ref(`eventCreationRequests/${account.localId}/${input.requestId}`).once('value')).val();
        events.add(reservation.eventId);
        assert.equal((await db.ref(`events/${reservation.eventId}`).once('value')).exists(), point === 'create');
        const before = clone(reservation);
        const recovered = await service().create(account.idToken, input); assert.equal(recovered.eventId, reservation.eventId);
        assert.deepEqual((await db.ref(`eventCreationRequests/${account.localId}/${input.requestId}`).once('value')).val(), before);
      }
    });
  } finally {
    for (const id of events) await db.ref(`events/${id}`).remove();
    for (const uid of ledgers) await db.ref(`eventCreationRequests/${uid}`).remove();
    for (const uid of users) await auth.deleteUser(uid);
    db.goOffline(); await deleteApp(app); await rulesEnvironment.cleanup(); // Whole fixture process cleanup only.
  }
});
