'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createAdminStore } = require('./store.cjs');
const { withinBudget } = require('./policy.cjs');
const { deferred, seed, clone } = require('./test-fixtures.cjs');
const active = { active() {} };
const tick = () => new Promise(resolve => setImmediate(resolve));
function database() {
  const data = new Map(), calls = [], gates = new Map();
  return { data, calls, gates,
    ref(path) {
      assert.equal(/^(?:events\/[^/]+(?:\/hostUid)?|eventCreationRequests\/[^/]+\/[^/]+)$/.test(path), true, 'no root/other-path transactions or reads');
      return {
        async once(kind) { calls.push(['read', path, kind]); const value = clone(data.get(path) ?? null); return { val: () => value }; },
        transaction(callback, complete, local) {
          calls.push(['transaction', path, complete, local]);
          assert.equal(complete, undefined); assert.equal(local, false);
          const before = clone(data.get(path) ?? null), proposed = callback(before);
          if (before !== null) assert.equal(proposed, undefined, 'every existing value must abort');
          if (proposed !== undefined) data.set(path, clone(proposed)); // SDK optimistic local visibility
          const settle = gates.get(path)?.promise ?? Promise.resolve();
          return settle.then(() => ({ committed: proposed !== undefined, snapshot: { val: () => clone(data.get(path) ?? null) } }), error => {
            before === null ? data.delete(path) : data.set(path, before); throw error;
          });
        },
      };
    },
    goOffline() { throw new Error('shared connection must stay online'); },
  };
}
test('Admin adapter transactions are create-only, detached and never write the source or database root', async () => {
  const db = database(), store = createAdminStore(db), event = seed();
  assert.equal(await store.create('new', event, active), true); event.private.round.heading = 99;
  assert.equal(db.data.get('events/new').private.round.heading, 37);
  for (const value of [false, 0, '', {}, seed()]) {
    db.data.set('events/occupied', value);
    assert.equal(await store.create('occupied', event, active), false); assert.deepEqual(db.data.get('events/occupied'), value);
  }
  const reserved = { uid: 'host', sourceEventId: 'source', eventId: 'new', seed: seed(), seedDigest: 'digest' };
  assert.deepEqual(await store.reserve('host', 'key', reserved, active), reserved);
  assert.deepEqual(await store.reserve('host', 'key', { ...reserved, seedDigest: 'changed' }, active), reserved);
  assert.equal(db.calls.some(([, path]) => path === 'events/source'), false);
});

test('same-database adapters block optimistic reservation reads until acknowledgement, including overlapping reads', async () => {
  const db = database(), a = createAdminStore(db), b = createAdminStore(db), gate = deferred();
  db.gates.set('eventCreationRequests/host/key', gate);
  const reservation = a.reserve('host', 'key', { seed: seed() }, active);
  await tick(); assert.equal(db.data.has('eventCreationRequests/host/key'), true);
  let confirmed = false;
  const retry = b.reserve('host', 'key', { seed: 'must not win' }, active).then(result => { confirmed = true; return result; });
  await tick(); assert.equal(confirmed, false);
  assert.equal(db.calls.filter(([type]) => type === 'transaction').length, 1);
  gate.resolve();
  assert.deepEqual(await reservation, { seed: seed() }); assert.deepEqual(await retry, { seed: seed() });
});

test('rejected optimistic reservation cannot become proof or start a destination write', async () => {
  const db = database(), store = createAdminStore(db), gate = deferred();
  db.gates.set('eventCreationRequests/host/key', gate);
  const pending = store.reserve('host', 'key', { seed: seed() }, active);
  const rejection = assert.rejects(pending, { code: 'creation-unconfirmed' });
  await tick(); gate.reject(new Error('private provider details')); await rejection;
  assert.equal(db.data.has('eventCreationRequests/host/key'), false);
  assert.equal(db.calls.some(([, path]) => path.startsWith('events/')), false);
});

test('timeout keeps acknowledgement barrier alive, while another path proceeds and same-key recovery converges', async () => {
  const db = database(), store = createAdminStore(db), gate = deferred();
  db.gates.set('events/late', gate);
  const request = withinBudget(context => { context.writing(); return store.create('late', seed(), context); }, 10);
  await assert.rejects(request, { code: 'creation-unconfirmed' });
  let observed = false;
  const read = createAdminStore(db).readEvent('late').then(value => { observed = true; return value; });
  assert.equal(await store.create('other', seed(), active), true);
  await tick(); assert.equal(observed, false);
  gate.resolve(); assert.deepEqual(await read, seed());
  assert.equal(await store.create('late', seed(), active), false);
});

test('expired waiter cannot dispatch a write after a conflicting transaction later settles', async () => {
  const db = database(), store = createAdminStore(db), gate = deferred(); db.gates.set('events/one', gate);
  const first = store.create('one', seed(), active); await tick();
  await assert.rejects(withinBudget(context => { context.writing(); return store.create('one', seed(), context); }, 10), { code: 'creation-unconfirmed' });
  gate.resolve(); await first; await tick();
  assert.equal(db.calls.filter(([type]) => type === 'transaction').length, 1);
});
