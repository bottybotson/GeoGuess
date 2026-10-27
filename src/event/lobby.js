import { MAX_GUESTS } from './admission';

const PHASES = new Set(['lobby', 'guessing', 'reveal', 'complete']);
const SLOTS = Array.from({ length: MAX_GUESTS }, (_, index) => `s${String(index + 1).padStart(2, '0')}`);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isUid = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const isNickname = value => typeof value === 'string' && value === value.trim() &&
    Array.from(value).length >= 1 && Array.from(value).length <= 20;
const isParticipant = value => isRecord(value) && hasOwn(value, 'nickname') &&
    isNickname(value.nickname) && hasOwn(value, 'slot') && SLOTS.includes(value.slot);
const failure = code => Object.assign(new Error(code), { code });

// Firebase 8 once()/get() can expose an unacknowledged local update. Keep raw
// claims until the server settles them, across clients using the same SDK
// database() singleton. A join timeout must not discard this acknowledgement.
const pendingClaims = new WeakMap();

function trackClaim(database, eventId, promise) {
    let events = pendingClaims.get(database);
    if (!events) {
        events = new Map();
        pendingClaims.set(database, events);
    }
    let claims = events.get(eventId);
    if (!claims) {
        claims = new Set();
        events.set(eventId, claims);
    }
    claims.add(promise);
    const release = () => {
        claims.delete(promise);
        if (claims.size === 0) events.delete(eventId);
        if (events.size === 0) pendingClaims.delete(database);
    };
    promise.then(release, release);
    return promise;
}

function validateEventId(eventId) {
    if (typeof eventId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(eventId)) {
        throw failure('invalid-event-id');
    }
}

function availableSlot(value) {
    if (value === null) return SLOTS[0];
    if (!isRecord(value)) throw failure('unavailable');
    const owners = new Set();
    for (const slot of Object.keys(value)) {
        if (!SLOTS.includes(slot) || !isUid(value[slot]) || owners.has(value[slot])) {
            throw failure('unavailable');
        }
        owners.add(value[slot]);
    }
    return SLOTS.find(slot => !hasOwn(value, slot));
}

function projection(values) {
    const title = typeof values.title === 'string' ? values.title : 'Birthday GeoGuess';
    const phase = PHASES.has(values.phase) ? values.phase : 'unavailable';
    const roster = values.participants;
    const unavailable = () => ({ title, phase: 'unavailable', participants: [] });
    if (roster === null) return { title, phase, participants: [] };
    if (!isRecord(roster) || Object.keys(roster).length > MAX_GUESTS) return unavailable();
    const slots = new Set();
    const participants = [];
    for (const id of Object.keys(roster).sort()) {
        const participant = roster[id];
        if (!isUid(id) || !isParticipant(participant) || slots.has(participant.slot)) return unavailable();
        slots.add(participant.slot);
        participants.push({ id, nickname: participant.nickname });
    }
    return { title, phase, participants };
}

/** Firebase 8 compat dependencies are injected; this module has no provider side effects. */
export function createLobbyClient(database, identity) {
    const inFlight = new Map();

    function join(eventId, nickname) {
        try {
            validateEventId(eventId);
        } catch (error) {
            return Promise.reject(error);
        }
        if (inFlight.has(eventId)) return inFlight.get(eventId);

        const deadline = Date.now() + 15000;
        let expired = false;
        let timer;
        const assertActive = () => {
            if (expired || Date.now() >= deadline) throw failure('unavailable');
        };
        const read = async path => {
            // This also waits for other UIDs' claims: their optimistic slots
            // could otherwise cause a false full result after a timeout.
            for (;;) {
                assertActive();
                const events = pendingClaims.get(database);
                const claims = events && events.get(eventId);
                if (claims && claims.size > 0) {
                    await Promise.allSettled(Array.from(claims));
                    continue;
                }
                const snapshot = await database.ref(path).once('value');
                assertActive();
                const currentEvents = pendingClaims.get(database);
                const currentClaims = currentEvents && currentEvents.get(eventId);
                // A different client can send a claim while once() is waiting.
                // Discard that potentially optimistic snapshot and read again.
                if (currentClaims && currentClaims.size > 0) continue;
                return snapshot.val();
            }
        };
        const base = `events/${eventId}/public`;
        const operation = async () => {
            assertActive();
            const user = await identity.ensureGuest();
            assertActive();
            if (!user || !isUid(user.uid)) throw failure('invalid-identity');
            const uid = user.uid;
            const memberPath = `${base}/participants/${uid}`;
            const existingMember = async () => {
                const member = await read(memberPath);
                if (member === null) return null;
                if (!isParticipant(member)) throw failure('unavailable');
                return { status: 'rejoined', participant: { id: uid, nickname: member.nickname } };
            };
            for (let claims = 0; claims <= 51; claims += 1) {
                const existing = await existingMember();
                if (existing) return existing;
                if (await read(`${base}/phase`) !== 'lobby') return { status: 'started' };
                const name = typeof nickname === 'string' ? nickname.trim() : nickname;
                if (!isNickname(name)) throw failure('invalid-nickname');
                const slot = availableSlot(await read(`${base}/slots`));
                if (!slot) {
                    // Another tab may have claimed our membership since the first read.
                    const admitted = await existingMember();
                    if (admitted) return admitted;
                    return { status: 'full' };
                }
                if (claims >= 51) throw failure('unavailable');
                assertActive();
                try {
                    const claim = database.ref().update({
                        [`${base}/participants/${uid}`]: { slot, nickname: name },
                        [`${base}/slots/${slot}`]: uid,
                    });
                    await trackClaim(database, eventId, claim);
                    assertActive();
                    return { status: 'joined', participant: { id: uid, nickname: name } };
                } catch (error) {
                    assertActive();
                    const code = typeof error.code === 'string' ? error.code.toLowerCase().replace(/_/g, '-') : '';
                    if (code !== 'permission-denied' && code !== 'database/permission-denied') throw error;
                }
            }
        };
        const timeout = new Promise((resolve, reject) => {
            timer = setTimeout(() => {
                expired = true;
                reject(failure('unavailable'));
            }, 15000);
        });
        // Deferring also coalesces synchronous/reentrant identity calls.
        const result = Promise.race([Promise.resolve().then(operation), timeout]).finally(() => {
            clearTimeout(timer);
            inFlight.delete(eventId);
        });
        inFlight.set(eventId, result);
        // Expiry cannot cancel an already sent SDK write or authentication. A
        // later join using the same database instance waits for acknowledgement
        // before recovering a late commit or observing a rolled-back denial.
        return result;
    }

    function subscribe(eventId, onChange, onError) {
        validateEventId(eventId);
        const values = Object.create(null);
        const ready = new Set();
        const listeners = [];
        let disposed = false;
        let errored = false;
        const dispose = () => {
            if (disposed) return;
            disposed = true;
            listeners.forEach(listener => listener.ref.off('value', listener.handler));
        };
        const fail = error => {
            if (disposed || errored) return;
            errored = true;
            dispose();
            if (typeof onError === 'function') onError(error);
        };
        for (const leaf of ['title', 'phase', 'participants']) {
            if (disposed) break;
            let listener;
            try {
                const ref = database.ref(`events/${eventId}/public/${leaf}`);
                const handler = snapshot => {
                    if (disposed) return;
                    values[leaf] = snapshot.val();
                    ready.add(leaf);
                    if (ready.size === 3) onChange(projection(values));
                };
                listener = { ref, handler };
                listeners.push(listener);
                ref.on('value', handler, fail);
            } catch (error) {
                fail(error);
            } finally {
                // A synchronous cancel callback may run before on() finishes
                // installing its listener; detach once more after registration.
                if (disposed && listener) listener.ref.off('value', listener.handler);
            }
        }
        return dispose;
    }

    return { join, subscribe };
}
