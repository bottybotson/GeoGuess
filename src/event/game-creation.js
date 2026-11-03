const EVENT_ID = /^[A-Za-z0-9_-]{1,80}$/;
const REQUEST_ID = /^[a-f0-9]{32}$/;
const LINK_NAMES = ['host', 'join', 'presenter'];
const validEventId = value => typeof value === 'string' && EVENT_ID.test(value);
const validRequestId = value => typeof value === 'string' && REQUEST_ID.test(value);

const messages = {
    'invalid-request': 'The creation request was invalid. Reload this host page and try again.',
    'method-not-allowed': 'The creation service is unavailable for this request.',
    'payload-too-large': 'The creation request could not be sent. Reload this host page and try again.',
    'unsupported-media-type': 'The creation service could not accept this request.',
    unauthenticated: 'Sign in again with the host account, then check creation again.',
    'password-host-required': 'Use the host password account to create a new game.',
    'origin-forbidden': 'This host page cannot use the creation service.',
    'source-unavailable': 'This game is unavailable to the current host account.',
    'invalid-source': 'This game’s setup is not valid for a new game. The current game is unchanged.',
    'unsupported-source': 'This game uses a setup format that cannot be copied. The current game is unchanged.',
    'stale-source': 'The game setup changed while creation was pending. Reload the host page before trying again.',
    'request-conflict': 'This creation attempt belongs to a different game. Start a new attempt from this host page.',
    'destination-conflict': 'The new game could not be confirmed. Check creation again to recover the same attempt.',
    'service-unavailable': 'The creation service is temporarily unavailable. Check creation again to reuse this attempt.',
    'creation-unconfirmed': 'Creation is not confirmed yet. Check creation again to reuse this same attempt.',
    'response-invalid': 'The creation service returned an unexpected response. Check creation again to reuse this attempt.',
    'secure-random-unavailable': 'This browser could not create a secure retry key. Update the browser and try again.',
};

export class GameCreationError extends Error {
    constructor(code) {
        super(Object.prototype.hasOwnProperty.call(messages, code) ? messages[code] : messages['response-invalid']);
        this.name = 'GameCreationError';
        this.code = Object.prototype.hasOwnProperty.call(messages, code) ? code : 'response-invalid';
    }
}

function exactKeys(value, keys) {
    return value && typeof value === 'object' && !Array.isArray(value) &&
        Object.keys(value).sort().join(',') === keys.slice().sort().join(',');
}

function validResponse(response, sourceEventId) {
    if (!response || typeof response.json !== 'function') throw new GameCreationError('response-invalid');
    return response.json().then(body => {
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new GameCreationError('response-invalid');
        if (!response.ok) {
            const code = exactKeys(body, ['error']) && typeof body.error === 'string' ? body.error : 'response-invalid';
            throw new GameCreationError(code);
        }
        if (!exactKeys(body, ['status', 'eventId', 'links']) || !validEventId(body.eventId) ||
            body.eventId === sourceEventId || !exactKeys(body.links, LINK_NAMES)) {
            throw new GameCreationError('response-invalid');
        }
        const expected = {
            host: `/event/${body.eventId}/host`,
            join: `/event/${body.eventId}/join`,
            presenter: `/event/${body.eventId}/present`,
        };
        if (LINK_NAMES.some(name => body.links[name] !== expected[name])) throw new GameCreationError('response-invalid');
        if ((response.status === 201 && body.status !== 'created') ||
            (response.status === 200 && body.status !== 'already-created') ||
            (response.status !== 200 && response.status !== 201)) throw new GameCreationError('response-invalid');
        return { status: body.status, eventId: body.eventId, links: expected };
    }).catch(error => {
        if (error instanceof GameCreationError) throw error;
        throw new GameCreationError('response-invalid');
    });
}

export async function createGameFromHost({ sourceEventId, requestId, token, fetchImpl = fetch }) {
    if (!validEventId(sourceEventId) || !validRequestId(requestId) || typeof token !== 'string' || !token) {
        throw new GameCreationError('invalid-request');
    }
    let response;
    try {
        response = await fetchImpl('/api/event-creations', {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ sourceEventId, requestId }),
            credentials: 'omit',
            cache: 'no-store',
        });
    } catch (error) {
        throw new GameCreationError('creation-unconfirmed');
    }
    return validResponse(response, sourceEventId);
}

export function newRequestId(cryptoProvider = window.crypto) {
    if (!cryptoProvider || typeof cryptoProvider.getRandomValues !== 'function') throw new GameCreationError('secure-random-unavailable');
    const bytes = new Uint8Array(16);
    try { cryptoProvider.getRandomValues(bytes); } catch (error) { throw new GameCreationError('secure-random-unavailable'); }
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

const storageKey = (uid, sourceEventId) => `geoguess:event-creation:${encodeURIComponent(uid)}:${encodeURIComponent(sourceEventId)}`;

export function readPendingCreation(storage, uid, sourceEventId) {
    if (!storage || typeof uid !== 'string' || !uid || !validEventId(sourceEventId)) return null;
    try {
        const value = JSON.parse(storage.getItem(storageKey(uid, sourceEventId)) || 'null');
        if (!exactKeys(value, ['hostUid', 'sourceEventId', 'requestId']) || value.hostUid !== uid ||
            value.sourceEventId !== sourceEventId || !validRequestId(value.requestId)) return null;
        return value;
    } catch (error) { return null; }
}

export function writePendingCreation(storage, attempt) {
    if (!storage || !attempt || typeof attempt.hostUid !== 'string' || !attempt.hostUid || !validEventId(attempt.sourceEventId) ||
        !validRequestId(attempt.requestId)) throw new GameCreationError('response-invalid');
    storage.setItem(storageKey(attempt.hostUid, attempt.sourceEventId), JSON.stringify({
        hostUid: attempt.hostUid, sourceEventId: attempt.sourceEventId, requestId: attempt.requestId,
    }));
}

export function clearPendingCreation(storage, attempt) {
    if (!storage || !attempt) return;
    try { storage.removeItem(storageKey(attempt.hostUid, attempt.sourceEventId)); } catch (error) { /* storage can be disabled after success */ }
}

export function absoluteCreationLinks(links, origin = window.location.origin) {
    return Object.fromEntries(LINK_NAMES.map(name => [name, new URL(links[name], origin).href]));
}
