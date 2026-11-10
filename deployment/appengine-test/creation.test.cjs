'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createCreationService, freshSeed, destinationId, digest } = require('./creation.cjs');
const { loadValidator } = require('./validator.cjs');
const { input, clone, seed, fixture, deferred, target } = require('./test-fixtures.cjs');
const service = (f, options = {}) => createCreationService({ ...f, ...options });
const rejected = (task, code) => assert.rejects(task, { code });

for (const count of [0, 1, 2, 20]) test(`v${count ? 2 : 1} ${count || 1} rounds: played source creates exact fresh seed without source writes`, async () => {
  const f = fixture(count), source = f.events.get('source');
  Object.assign(source, { participants: { guest: { name: 'Private name' } }, slots: { s01: 'guest' }, guesses: { r1: { guest: { lat: 2 } } } });
  Object.assign(source.public, { phase: 'complete', clue: { panoramaId: 'secret' }, results: { r1: 'answer' }, totals: { guest: 50 }, lastRevealedRoundId: 'r1', state: { phase: 'complete', roundId: count ? 'r01' : 'r1', revision: 17, deadline: 123 } });
  const original = clone(source);
  const result = await service(f).create('token', input);
  assert.equal(result.status, 'created'); assert.match(result.eventId, /^game_[a-f0-9]{64}$/);
  assert.deepEqual(result.links, { host: `/event/${result.eventId}/host`, join: `/event/${result.eventId}/join`, presenter: `/event/${result.eventId}/present` });
  assert.deepEqual(f.events.get(result.eventId), seed(count));
  assert.deepEqual(source, original);
  assert.deepEqual(f.calls.slice(0, 4), [['verify', 'token', true], ['user', 'host'], ['host', 'source'], ['source', 'source']]);
  assert.equal(loadValidator().validate({ ...target, eventId: result.eventId, event: f.events.get(result.eventId) }, { ...target, eventId: result.eventId }).event.hostUid, 'host');
});

test('only absent/null version selects v1, and canonical validator rejects mixed/malformed private configuration', async () => {
  for (const change of [s => s.public.formatVersion = '2', s => s.public.formatVersion = 1,
    s => s.private.rounds = {}, s => s.private.round.answer.lat = NaN,
    s => s.private.round.extra = true, s => s.private.round.panoramaId = 'YOUR_PANORAMA',
    s => s.public.title = ' invalid ']) {
    const f = fixture(); change(f.events.get('source'));
    await assert.rejects(service(f).create('token', input), error => ['invalid-source', 'unsupported-source'].includes(error.code));
    assert.equal(f.ledger.size, 0); assert.equal(f.events.size, 1);
  }
  const f = fixture(); f.events.get('source').public.formatVersion = null;
  assert.equal((await service(f).create('token', input)).status, 'created');
  const mixed = fixture(2); mixed.events.get('source').private.round = seed().private.round;
  await rejected(service(mixed).create('token', input), 'invalid-source');
  for (const change of [s => s.private.rounds.r01.previousRoundId = null, s => delete s.private.rounds.r02.previousRoundId,
    s => s.private.rounds.r01.nextRoundId = 'r20', s => s.public.roundCount = 3]) {
    const f = fixture(2); change(f.events.get('source'));
    await rejected(service(f).create('token', input), 'invalid-source');
  }
});

test('authentication rejects verification failure, project/issuer/sub/tenant mismatch and password-provider confusion before any DB access', async () => {
  for (const change of [f => f.auth.verifyIdToken = async () => { throw new Error('secret token'); },
    f => f.decoded.aud = 'other-project', f => f.decoded.iss = 'https://securetoken.google.com/other',
    f => f.decoded.sub = 'other', f => f.decoded.firebase.tenant = 'tenant',
    f => f.decoded.firebase.sign_in_provider = 'anonymous', f => f.decoded.firebase.sign_in_provider = 'google.com',
    f => f.decoded.uid = 'bad/uid', f => f.user.disabled = true, f => f.user.uid = 'other',
    f => f.user.providerData = [{ providerId: 'google.com' }], f => f.auth.getUser = async () => { throw new Error('private account'); }]) {
    const f = fixture(); change(f);
    await assert.rejects(service(f).create('token', input), error => ['unauthenticated', 'password-host-required'].includes(error.code));
    assert.equal(f.calls.some(([name]) => ['host', 'source', 'reserve', 'create'].includes(name)), false);
  }
});

test('non-owned and absent sources are indistinguishable; no private read before ownership and coherent snapshot recheck', async () => {
  for (const source of [null, { hostUid: 'other', private: { answer: 'secret' } }]) {
    const f = fixture(); source ? f.events.set('source', source) : f.events.delete('source');
    await rejected(service(f).create('token', input), 'source-unavailable');
    assert.equal(f.calls.some(([name]) => name === 'source'), false);
  }
  for (const source of [null, seed(0, 'other')]) {
    const f = fixture(); f.store.readSource = async () => source;
    await rejected(service(f).create('token', input), 'source-unavailable');
    assert.equal(f.ledger.size, 0);
  }
});

test('five concurrent same-key requests and restarts converge, distinct keys/accounts remain isolated', async () => {
  const f = fixture();
  const results = await Promise.all(Array.from({ length: 5 }, () => service(f).create('token', input)));
  assert.equal(results.filter(r => r.status === 'created').length, 1);
  assert.equal(new Set(results.map(r => r.eventId)).size, 1);
  assert.equal(f.events.size, 2); assert.equal(f.ledger.size, 1);
  const next = await service(f).create('token', { ...input, requestId: 'b'.repeat(32) });
  assert.notEqual(next.eventId, results[0].eventId);
  assert.notEqual(destinationId(target.projectId, 'other', input.requestId), next.eventId);
  assert.notEqual(destinationId('other-project', 'host', input.requestId), results[0].eventId);
  f.events.set('other', seed());
  await rejected(service(f).create('token', { ...input, sourceEventId: 'other' }), 'request-conflict');
});

test('destination progress is preserved on recovery, even if the owned source configuration later changes', async () => {
  const f = fixture(2); const result = await service(f).create('token', input);
  const event = f.events.get(result.eventId); event.public.state = { phase: 'complete', roundId: 'r02', revision: 9 };
  event.guesses = { r02: { guest: { lat: 42, lng: 20 } } }; const progressed = clone(event);
  f.events.get('source').private.rounds.r01.heading = 140;
  assert.equal((await service(f).create('token', input)).status, 'already-created');
  assert.deepEqual(event, progressed);
});

test('pending reservation rejects changed source, occupied target and corrupted ledger without overwrites', async () => {
  const f = fixture(); f.store.create = async () => { throw Object.assign(new Error(), { code: 'creation-unconfirmed' }); };
  await rejected(service(f).create('token', input), 'creation-unconfirmed');
  const reserved = clone([...f.ledger.values()][0]);
  f.events.get('source').private.round.heading++;
  await rejected(service(f).create('token', input), 'stale-source');
  assert.deepEqual([...f.ledger.values()][0], reserved);
  f.events.set(reserved.eventId, seed(0, 'other'));
  await rejected(service(f).create('token', input), 'destination-conflict');
  assert.deepEqual(f.events.get(reserved.eventId), seed(0, 'other'));
  f.events.delete(reserved.eventId);
  for (const change of [r => r.eventId = 'arbitrary', r => r.uid = 'other', r => r.seedDigest = 'bad', r => r.seed.hostUid = 'other', r => r.extra = true]) {
    const bad = clone(reserved); change(bad); f.ledger.set(`host/${input.requestId}`, bad);
    await rejected(service(f).create('token', input), 'request-conflict');
  }
});

test('reservation crash, lost event acknowledgement and create contention all recover the same immutable target', async () => {
  for (const point of ['reserve', 'create']) {
    const f = fixture(), original = f.store[point];
    f.store[point] = async (...args) => { await original(...args); throw Object.assign(new Error('lost acknowledgement'), { code: 'creation-unconfirmed' }); };
    await rejected(service(f).create('token', input), 'creation-unconfirmed');
    assert.equal(f.events.size, point === 'reserve' ? 1 : 2);
    f.store[point] = original;
    const result = await service(f).create('token', input);
    assert.equal(result.status, point === 'reserve' ? 'created' : 'already-created');
    assert.equal(result.eventId, [...f.ledger.values()][0].eventId);
    assert.equal(f.ledger.size, 1); assert.equal(f.events.size, 2);
  }
  const f = fixture(); f.store.create = async (id, value) => { f.events.set(id, clone(value)); return false; };
  assert.equal((await service(f).create('token', input)).status, 'already-created');
});

test('deadline before verification is unavailable; late reservation cannot create an event; unrelated requests continue', async () => {
  const f = fixture(), wait = deferred(); f.auth.verifyIdToken = () => wait.promise;
  await rejected(service(f, { budgetMs: 10 }).create('token', input), 'service-unavailable');
  wait.resolve(f.decoded); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.ledger.size, 0);
  const late = fixture(), ack = deferred(), original = late.store.reserve;
  late.store.reserve = async (...args) => { const result = await original(...args); await ack.promise; return result; };
  await rejected(service(late, { budgetMs: 10 }).create('token', input), 'creation-unconfirmed');
  const unrelated = fixture(); assert.equal((await service(unrelated).create('token', input)).status, 'created');
  ack.resolve(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(late.events.size, 1);
  late.store.reserve = original;
  assert.equal((await service(late).create('token', input)).status, 'created');
});

test('late destination acceptance converges without another event or source write', async () => {
  const f = fixture(), ack = deferred(), original = f.store.create;
  f.store.create = async (...args) => { await ack.promise; return original(...args); };
  await rejected(service(f, { budgetMs: 10 }).create('token', input), 'creation-unconfirmed');
  ack.resolve(); await new Promise(resolve => setImmediate(resolve));
  const result = await service(f).create('token', input);
  assert.equal(result.status, 'already-created'); assert.equal(f.events.size, 2);
});

test('digest ignores insertion order and fresh seed is detached from the source', () => {
  assert.equal(digest({ b: 1, a: { d: 3, c: 2 } }), digest({ a: { c: 2, d: 3 }, b: 1 }));
  const source = seed(), selected = { ...target, eventId: 'destination' };
  const fresh = freshSeed(source, 'host', selected, loadValidator().validate);
  fresh.private.round.heading = 99; assert.equal(source.private.round.heading, 37);
});
