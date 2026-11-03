'use strict';
const { createHash } = require('node:crypto');
const { fail, exact, record, uidValid, requestValid, withinBudget } = require('./policy.cjs');
const { loadValidator } = require('./validator.cjs');
const canonical = value => JSON.stringify(value, function (key, item) {
  return record(item) ? Object.fromEntries(Object.keys(item).sort().map(name => [name, item[name]])) : item;
});
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
const destinationId = (projectId, uid, requestId) => `game_${digest(['geoguess-event-creation-v1', projectId, uid, requestId])}`;
function freshSeed(source, uid, target, validate) {
  if (!record(source) || source.hostUid !== uid) throw fail('source-unavailable');
  if (!record(source.public) || !record(source.private)) throw fail('invalid-source');
  const pub = source.public, priv = source.private;
  let fresh;
  if (pub.formatVersion === undefined || pub.formatVersion === null) {
    if (Object.hasOwn(priv, 'rounds')) throw fail('invalid-source');
    fresh = { hostUid: uid, public: { title: pub.title, phase: 'lobby' }, private: { round: priv.round } };
  } else if (pub.formatVersion === 2) {
    if (Object.hasOwn(priv, 'round')) throw fail('invalid-source');
    fresh = { hostUid: uid, public: { title: pub.title, formatVersion: 2, roundCount: pub.roundCount,
      state: { phase: 'lobby', roundId: 'r01', revision: 0 } }, private: { rounds: priv.rounds } };
  } else throw fail('unsupported-source');
  try { return validate({ ...target, event: fresh }, target).event; }
  catch { throw fail('invalid-source'); }
}
function receipt(status, eventId) {
  return { status, eventId, links: { host: `/event/${eventId}/host`, join: `/event/${eventId}/join`, presenter: `/event/${eventId}/present` } };
}
function createCreationService({ auth, store, target, validate = loadValidator().validate, budgetMs = 30000 }) {
  target = Object.freeze({ projectId: target.projectId, databaseUrl: target.databaseUrl });
  const execute = async (token, input, context) => {
    if (!requestValid(input)) throw fail('invalid-request');
    input = { ...input };
    let decoded, user;
    try { decoded = await auth.verifyIdToken(token, true); }
    catch { throw fail('unauthenticated'); }
    context.active();
    if (!decoded || !uidValid(decoded.uid) || decoded.sub !== decoded.uid || decoded.aud !== target.projectId ||
        decoded.iss !== `https://securetoken.google.com/${target.projectId}` || decoded.firebase?.tenant !== undefined) throw fail('unauthenticated');
    if (decoded.firebase?.sign_in_provider !== 'password') throw fail('password-host-required');
    try { user = await auth.getUser(decoded.uid); }
    catch { throw fail('unauthenticated'); }
    context.active();
    if (!user || user.uid !== decoded.uid || user.disabled !== false || !Array.isArray(user.providerData) ||
        !user.providerData.some(provider => provider?.providerId === 'password')) throw fail('password-host-required');
    const uid = decoded.uid;
    const eventId = destinationId(target.projectId, uid, input.requestId);
    const selected = { ...target, eventId };
    const hostUid = await store.readHost(input.sourceEventId);
    context.active();
    if (hostUid !== uid) throw fail('source-unavailable');
    const source = await store.readSource(input.sourceEventId);
    context.active();
    const candidate = freshSeed(source, uid, selected, validate);
    const proposed = { uid, sourceEventId: input.sourceEventId, eventId, seed: candidate, seedDigest: digest(candidate) };
    context.writing();
    const reserved = await store.reserve(uid, input.requestId, proposed, context);
    context.active();
    // Stored requests are private, but still validate their binding and schema
    // before allowing them to drive a privileged write or a recovery response.
    if (!exact(reserved, ['uid', 'sourceEventId', 'eventId', 'seed', 'seedDigest']) || reserved.uid !== uid || reserved.eventId !== eventId) throw fail('request-conflict');
    if (reserved.sourceEventId !== input.sourceEventId) throw fail('request-conflict');
    let seed;
    try { seed = validate({ ...selected, event: reserved.seed }, selected).event; }
    catch { throw fail('request-conflict'); }
    if (seed.hostUid !== uid || reserved.seedDigest !== digest(seed)) throw fail('request-conflict');
    const matches = event => {
      try { return digest(freshSeed(event, uid, selected, validate)) === reserved.seedDigest; }
      catch { return false; }
    };
    const existing = await store.readEvent(eventId);
    context.active();
    if (existing !== null) {
      if (!matches(existing)) throw fail('destination-conflict');
      return receipt('already-created', eventId);
    }
    if (digest(candidate) !== reserved.seedDigest) throw fail('stale-source');
    context.writing();
    const committed = await store.create(eventId, seed, context);
    context.active();
    if (committed === true) return receipt('created', eventId);
    const winner = await store.readEvent(eventId);
    context.active();
    if (!matches(winner)) throw fail('destination-conflict');
    return receipt('already-created', eventId);
  };
  return {
    create(token, input, context) {
      return context ? execute(token, input, context) : withinBudget(control => execute(token, input, control), budgetMs);
    },
  };
}
module.exports = { createCreationService, freshSeed, destinationId, digest, receipt };
