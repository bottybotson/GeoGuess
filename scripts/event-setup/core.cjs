'use strict';
const fail = code => Object.assign(new Error(code), { code });
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, names) => plain(value) && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const placeholder = value => typeof value === 'string' && /[<>]|^(?:YOUR_|CHANGE_?ME|REPLACE_)/i.test(value);
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) && !placeholder(value);
const number = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
function databaseUrl(value) {
    if (typeof value !== 'string') throw fail('invalid-target');
    let url;
    try { url = new URL(value); } catch { throw fail('invalid-target'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/' ||
        !/^[a-z0-9-]+\.(firebaseio\.com|(?:[a-z0-9-]+\.)?firebasedatabase\.app)$/.test(url.hostname)) throw fail('invalid-target');
    return url.origin;
}
function validate(input, target) {
    if (!exact(input, ['projectId', 'databaseUrl', 'eventId', 'event']) || !exact(target, ['projectId', 'databaseUrl', 'eventId'])) throw fail('invalid-input');
    if (typeof input.projectId !== 'string' || !/^[a-z][a-z0-9-]{4,62}$/.test(input.projectId) ||
        typeof input.eventId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(input.eventId) || placeholder(input.eventId)) throw fail('invalid-target');
    const url = databaseUrl(input.databaseUrl);
    if (target.projectId !== input.projectId || target.eventId !== input.eventId || databaseUrl(target.databaseUrl) !== url) throw fail('target-mismatch');
    const event = input.event;
    if (!exact(event, ['hostUid', 'public', 'private']) || !id(event.hostUid) ||
        !exact(event.public, ['title', 'phase']) || event.public.phase !== 'lobby' ||
        typeof event.public.title !== 'string' || event.public.title !== event.public.title.trim() ||
        Array.from(event.public.title).length < 1 || Array.from(event.public.title).length > 120 ||
        placeholder(event.public.title) || !exact(event.private, ['round'])) throw fail('invalid-event');
    const round = event.private.round;
    if (!exact(round, ['id', 'panoramaId', 'heading', 'pitch', 'answer', 'difficulty']) || round.id !== 'r1' ||
        typeof round.panoramaId !== 'string' || !round.panoramaId.trim() || round.panoramaId !== round.panoramaId.trim() || round.panoramaId.length > 512 ||
        placeholder(round.panoramaId) || !number(round.heading, 0, 359.99999999999994) || !number(round.pitch, -90, 90) ||
        !exact(round.answer, ['lat', 'lng']) || !number(round.answer.lat, -90, 90) || !number(round.answer.lng, -180, 180) ||
        !Number.isFinite(round.difficulty) || round.difficulty <= 0) throw fail('invalid-round');
    // Copy before asynchronous work so a caller cannot replace the validated seed.
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
    try { created = await adapter.createIfAbsent(validated.eventId, validated.event); } catch { throw fail('create-failed'); }
    if (created !== true) throw fail('event-exists');
    return { status: 'created-emulator-event', identityVerified: true, panoramaVerified: false, written: true };
}
module.exports = { validate, provision, fail };
