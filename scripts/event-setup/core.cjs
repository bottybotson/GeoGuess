'use strict';
const fail = code => Object.assign(new Error(code), { code });
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, names) => plain(value) && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const placeholder = value => typeof value === 'string' && /[<>]|^(?:YOUR_|CHANGE_?ME|REPLACE_)/i.test(value);
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) && !placeholder(value);
const number = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const roundAt = index => `r${String(index).padStart(2, '0')}`;
function databaseUrl(value) {
    if (typeof value !== 'string') throw fail('invalid-target');
    let url;
    try { url = new URL(value); } catch { throw fail('invalid-target'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/' ||
        !/^[a-z0-9-]+\.(firebaseio\.com|(?:[a-z0-9-]+\.)?firebasedatabase\.app)$/.test(url.hostname)) throw fail('invalid-target');
    return url.origin;
}
function cloneJson(value) {
    // CLI inputs are JSON. structuredClone preserves invalid numeric values so
    // validation can reject them instead of JSON serialization normalizing NaN.
    try { return structuredClone(value); } catch { throw fail('invalid-input'); }
}
function validTitle(title) {
    return typeof title === 'string' && title === title.trim() &&
        Array.from(title).length >= 1 && Array.from(title).length <= 120 && !placeholder(title);
}
function validV1(event) {
    if (!exact(event.public, ['title', 'phase']) || event.public.phase !== 'lobby' ||
        !validTitle(event.public.title) || !exact(event.private, ['round'])) throw fail('invalid-event');
    const round = event.private.round;
    if (!exact(round, ['id', 'panoramaId', 'heading', 'pitch', 'answer', 'difficulty']) || round.id !== 'r1' ||
        typeof round.panoramaId !== 'string' || !round.panoramaId.trim() || round.panoramaId !== round.panoramaId.trim() || round.panoramaId.length > 512 ||
        placeholder(round.panoramaId) || !number(round.heading, 0, 359.99999999999994) || !number(round.pitch, -90, 90) ||
        !exact(round.answer, ['lat', 'lng']) || !number(round.answer.lat, -90, 90) || !number(round.answer.lng, -180, 180) ||
        !Number.isFinite(round.difficulty) || round.difficulty <= 0) throw fail('invalid-round');
}
function validV2(event) {
    const pub = event.public;
    if (!exact(pub, ['title', 'formatVersion', 'roundCount', 'state']) || pub.formatVersion !== 2 || !validTitle(pub.title) ||
        !Number.isInteger(pub.roundCount) || pub.roundCount < 1 || pub.roundCount > 20 ||
        !exact(pub.state, ['phase', 'roundId', 'revision']) || pub.state.phase !== 'lobby' ||
        pub.state.roundId !== 'r01' || pub.state.revision !== 0 || !exact(event.private, ['rounds'])) throw fail('invalid-event');
    const rounds = event.private.rounds;
    if (!plain(rounds) || Object.keys(rounds).length !== pub.roundCount) throw fail('invalid-rounds');
    for (let index = 1; index <= pub.roundCount; index++) {
        const id = roundAt(index);
        if (!Object.hasOwn(rounds, id)) throw fail('invalid-rounds');
        const round = rounds[id];
        const names = ['id', 'panoramaId', 'heading', 'pitch', 'answer', 'difficulty',
            ...(index > 1 ? ['previousRoundId'] : []), ...(index < pub.roundCount ? ['nextRoundId'] : [])];
        if (!exact(round, names) || round.id !== id ||
            typeof round.panoramaId !== 'string' || !round.panoramaId.trim() || round.panoramaId !== round.panoramaId.trim() ||
            round.panoramaId.length > 512 || placeholder(round.panoramaId) ||
            !number(round.heading, 0, 359.99999999999994) || !number(round.pitch, -90, 90) ||
            !exact(round.answer, ['lat', 'lng']) || !number(round.answer.lat, -90, 90) || !number(round.answer.lng, -180, 180) ||
            !Number.isFinite(round.difficulty) || round.difficulty <= 0 ||
            (index > 1 && round.previousRoundId !== roundAt(index - 1)) ||
            (index < pub.roundCount && round.nextRoundId !== roundAt(index + 1))) throw fail('invalid-round');
    }
}
function validate(input, target) {
    input = cloneJson(input);
    target = cloneJson(target);
    if (!exact(input, ['projectId', 'databaseUrl', 'eventId', 'event']) || !exact(target, ['projectId', 'databaseUrl', 'eventId'])) throw fail('invalid-input');
    if (typeof input.projectId !== 'string' || !/^[a-z][a-z0-9-]{4,62}$/.test(input.projectId) ||
        typeof input.eventId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(input.eventId) || placeholder(input.eventId)) throw fail('invalid-target');
    const url = databaseUrl(input.databaseUrl);
    if (target.projectId !== input.projectId || target.eventId !== input.eventId || databaseUrl(target.databaseUrl) !== url) throw fail('target-mismatch');
    const event = input.event;
    if (!exact(event, ['hostUid', 'public', 'private']) || !id(event.hostUid)) throw fail('invalid-event');
    // Version is selected by the presence of the immutable marker. Reject any
    // mixed or unknown schema through each version's exact field checks.
    if (plain(event.public) && Object.hasOwn(event.public, 'formatVersion')) validV2(event);
    else validV1(event);
    // Retain v1's JSON output normalization (including -0), using only the
    // detached, fully validated seed after asynchronous lookup.
    return { projectId: input.projectId, databaseUrl: url, eventId: input.eventId, event: JSON.parse(JSON.stringify(event)) };
}
async function provision(input, target, { apply = false, adapter } = {}) {
    const validated = validate(input, target);
    if (apply !== true) return { status: 'valid-dry-run', identityVerified: false, panoramaVerified: false, written: false };
    if (!adapter || typeof adapter.getUser !== 'function' || typeof adapter.createIfAbsent !== 'function') throw fail('adapter-required');
    const expected = { projectId: validated.projectId, databaseUrl: validated.databaseUrl, eventId: validated.eventId };
    if (!adapter.target || Object.keys(expected).some(key => adapter.target[key] !== expected[key])) throw fail('target-mismatch');
    let user;
    try { user = await adapter.getUser(validated.event.hostUid); } catch { throw fail('host-lookup-failed'); }
    if (!user || user.uid !== validated.event.hostUid || user.disabled !== false || !Array.isArray(user.providerData) ||
        !user.providerData.some(provider => provider && provider.providerId === 'password')) throw fail('invalid-host');
    let created;
    try { created = await adapter.createIfAbsent(validated.eventId, validated.event); }
    catch (error) { throw fail(error && error.code === 'create-unconfirmed' ? 'create-unconfirmed' : 'create-failed'); }
    if (created !== true) throw fail('event-exists');
    return { status: adapter.kind === 'live' ? 'created-live-event' : 'created-emulator-event', identityVerified: true, panoramaVerified: false, written: true };
}
module.exports = { validate, provision, fail };
