'use strict';
const target = { projectId: 'demo-geoguess-admission', databaseUrl: 'https://demo-geoguess-admission.firebaseio.com' };
const input = { sourceEventId: 'source', requestId: 'a'.repeat(32) };
const clone = value => structuredClone(value);
function seed(count = 0, uid = 'host') {
  const round = { id: 'r1', panoramaId: 'fictional-panorama', heading: 37, pitch: -4, answer: { lat: 10, lng: 20 }, difficulty: 2000 };
  const event = { hostUid: uid, public: { title: 'Synthetic game', phase: 'lobby' }, private: { round } };
  if (count) {
    const rid = n => `r${String(n).padStart(2, '0')}`;
    event.public = { title: event.public.title, formatVersion: 2, roundCount: count, state: { phase: 'lobby', roundId: 'r01', revision: 0 } };
    event.private = { rounds: Object.fromEntries(Array.from({ length: count }, (_, i) => [rid(i + 1), {
      ...round, id: rid(i + 1), ...(i ? { previousRoundId: rid(i) } : {}), ...(i + 1 < count ? { nextRoundId: rid(i + 2) } : {}),
    }])) };
  }
  return event;
}
function fixture(count = 0) {
  const events = new Map([['source', seed(count)]]), ledger = new Map(), calls = [];
  const decoded = { uid: 'host', sub: 'host', aud: target.projectId, iss: `https://securetoken.google.com/${target.projectId}`, firebase: { sign_in_provider: 'password' } };
  const user = { uid: 'host', disabled: false, providerData: [{ providerId: 'password' }] };
  const auth = {
    async verifyIdToken(token, revoke) { calls.push(['verify', token, revoke]); return clone(decoded); },
    async getUser(uid) { calls.push(['user', uid]); return clone(user); },
  };
  const store = {
    async readHost(id) { calls.push(['host', id]); return events.get(id)?.hostUid ?? null; },
    async readSource(id) { calls.push(['source', id]); return clone(events.get(id) ?? null); },
    async readEvent(id) { calls.push(['event', id]); return clone(events.get(id) ?? null); },
    async reserve(uid, key, value) {
      calls.push(['reserve', uid, key]);
      const path = `${uid}/${key}`;
      if (!ledger.has(path)) ledger.set(path, clone(value));
      return clone(ledger.get(path));
    },
    async create(id, value) {
      calls.push(['create', id]);
      if (events.has(id)) return false;
      events.set(id, clone(value)); return true;
    },
  };
  return { events, ledger, calls, decoded, user, auth, store, target };
}
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
module.exports = { target, input, clone, seed, fixture, deferred };
