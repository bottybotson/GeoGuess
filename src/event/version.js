const failure = code => Object.assign(new Error(code), { code });
export const validateEventId = eventId => {
    if (typeof eventId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(eventId)) throw failure('invalid-event-id');
};
export function formatVersion(value) {
    if (value === null) return 1;
    if (value === 2) return 2;
    throw failure('unsupported-format');
}
export async function getFormatVersion(database, eventId) {
    validateEventId(eventId);
    let timer;
    try {
        return await Promise.race([
            Promise.resolve().then(() => database.ref(`events/${eventId}/public/formatVersion`).once('value')).then(snapshot => formatVersion(snapshot.val())),
            new Promise((resolve, reject) => { timer = setTimeout(() => reject(failure('unavailable')), 15000); }),
        ]);
    } finally { clearTimeout(timer); }
}
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function validSessionState(value, count) {
    if (!Number.isInteger(count) || count < 1 || count > 20 || !record(value) || typeof value.phase !== 'string' ||
        typeof value.roundId !== 'string' || !/^r(0[1-9]|1[0-9]|20)$/.test(value.roundId)) return false;
    const index = Number(value.roundId.slice(1));
    const revisions = { lobby: 0, ready: 4 * index - 4, guessing: 4 * index - 3, closed: 4 * index - 2, reveal: 4 * index - 1, complete: 4 * index };
    if (index > count || !Object.prototype.hasOwnProperty.call(revisions, value.phase) || value.revision !== revisions[value.phase] ||
        (value.phase === 'lobby' && index !== 1) || (value.phase === 'ready' && index === 1) || (value.phase === 'complete' && index !== count)) return false;
    const last = ['reveal', 'complete'].includes(value.phase) ? value.roundId : index > 1 ? `r${String(index - 1).padStart(2, '0')}` : null;
    const expected = ['phase', 'roundId', 'revision', ...(last === null ? [] : ['lastRevealedRoundId'])];
    return Object.keys(value).length === expected.length && expected.every(key => Object.prototype.hasOwnProperty.call(value, key)) &&
        (last === null || value.lastRevealedRoundId === last);
}

/** Observe only the immutable public version leaf. Rebinding invalidates callbacks before releasing old listeners. */
export function subscribeVersioned(database, eventId, bind, onError = () => {}) {
    validateEventId(eventId);
    let live = true;
    let generation = 0;
    let release;
    let current;
    const reference = database.ref(`events/${eventId}/public/formatVersion`);
    const stopInner = () => { generation += 1; if (release) release(); release = null; };
    const stop = () => {
        if (!live) return;
        live = false;
        stopInner();
        reference.off('value', change);
    };
    const fail = error => { if (live) { stop(); if (typeof onError === 'function') onError(error); } };
    const change = snapshot => {
        if (!live) return;
        try {
            const version = formatVersion(snapshot.val());
            if (current === version) return;
            current = version;
            stopInner();
            const epoch = generation;
            const valid = () => live && epoch === generation;
            const bound = bind(version, valid, error => { if (valid()) fail(error); });
            if (valid()) release = bound;
            else if (bound) bound();
        } catch (error) { fail(error); }
    };
    try { reference.on('value', change, fail); } catch (error) { fail(error); }
    finally { if (!live) reference.off('value', change); }
    return stop;
}

/** Legacy calls never infer a v2 round/revision. */
export function legacyClient(database, client) {
    return Object.fromEntries(Object.keys(client).map(name => [name, name === 'subscribeTiming' ?
        (eventId, onChange, onError) => subscribeVersioned(database, eventId, (version, valid, fail) => {
            if (version !== 1) throw failure('unsupported-format');
            return client[name](eventId, value => { if (valid()) onChange(value); }, fail);
        }, onError) :
        async (eventId, ...args) => {
            if (await getFormatVersion(database, eventId) !== 1) throw failure('unsupported-format');
            return client[name](eventId, ...args);
        }]));
}
