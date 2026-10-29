import distance from '@turf/distance';
import { getScore } from '../utils/game/score';
import { MAX_WINDOW_MS, validDeadline } from './timing';

const failure = code => Object.assign(new Error(code), { code });
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, expected) => record(value) && Object.keys(value).length === expected.length && expected.every(key => own(value, key));
const uidValid = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const roundValid = value => typeof value === 'string' && /^r(0[1-9]|1[0-9]|20)$/.test(value);
const indexOf = id => Number(id.slice(1));
const roundAt = index => `r${String(index).padStart(2, '0')}`;
const coordinate = value => keys(value, ['lat', 'lng']) && Number.isFinite(value.lat) && value.lat >= -90 && value.lat <= 90 &&
    Number.isFinite(value.lng) && value.lng >= -180 && value.lng <= 180;
const nicknameValid = value => typeof value === 'string' && value === value.trim() && Array.from(value).length >= 1 && Array.from(value).length <= 20;
const clueOf = value => ({ id: value.id, panoramaId: value.panoramaId, heading: value.heading, pitch: value.pitch });
const clueValid = (value, id) => keys(value, ['id', 'panoramaId', 'heading', 'pitch']) && value.id === id &&
    typeof value.panoramaId === 'string' && value.panoramaId.length > 0 && value.panoramaId.length <= 512 &&
    Number.isFinite(value.heading) && value.heading >= 0 && value.heading < 360 &&
    Number.isFinite(value.pitch) && value.pitch >= -90 && value.pitch <= 90;
const timingValid = (value, id) => keys(value, ['roundId', 'deadlineMs']) && value.roundId === id && validDeadline(value.deadlineMs);
const resultValid = value => record(value) && nicknameValid(value.nickname) && typeof value.answered === 'boolean' &&
    Number.isInteger(value.points) && value.points >= 0 && value.points <= 5000 &&
    Number.isInteger(value.totalPoints) && value.totalPoints >= value.points && value.totalPoints <= 100000 &&
    (value.answered ? keys(value, ['nickname', 'answered', 'points', 'totalPoints', 'distance']) && Number.isSafeInteger(value.distance) && value.distance >= 0 :
        keys(value, ['nickname', 'answered', 'points', 'totalPoints']) && value.points === 0);
const revealValid = (value, id) => keys(value, ['roundId', 'answer', 'results']) && value.roundId === id && coordinate(value.answer) &&
    record(value.results) && Object.keys(value.results).length >= 1 && Object.keys(value.results).length <= 50 &&
    Object.keys(value.results).every(uid => uidValid(uid) && resultValid(value.results[uid]) &&
        value.results[uid].totalPoints <= 5000 * indexOf(id) && (id !== 'r01' || value.results[uid].totalPoints === value.results[uid].points));
const expectedValid = value => keys(value, ['roundId', 'revision']) && roundValid(value.roundId) && Number.isSafeInteger(value.revision) && value.revision >= 0;
const permissionDenied = error => /^(database\/)?permission-denied$/.test(
    typeof error.code === 'string' ? error.code.toLowerCase().replace(/_/g, '-') : '');

function stateValid(value, count) {
    if (!record(value) || !roundValid(value.roundId) || indexOf(value.roundId) > count) return false;
    const index = indexOf(value.roundId);
    const revisions = { lobby: 0, ready: 4 * index - 4, guessing: 4 * index - 3, closed: 4 * index - 2, reveal: 4 * index - 1, complete: 4 * index };
    if (!own(revisions, value.phase) || value.revision !== revisions[value.phase] ||
        (value.phase === 'lobby' && index !== 1) || (value.phase === 'ready' && index === 1) ||
        (value.phase === 'complete' && index !== count)) return false;
    const last = ['reveal', 'complete'].includes(value.phase) ? value.roundId : index > 1 ? roundAt(index - 1) : null;
    return last === null ? keys(value, ['phase', 'roundId', 'revision']) :
        keys(value, ['phase', 'roundId', 'revision', 'lastRevealedRoundId']) && value.lastRevealedRoundId === last;
}

function setupValid(value, id, count) {
    const index = indexOf(id);
    return keys(value, ['id', 'panoramaId', 'heading', 'pitch', 'answer', 'difficulty',
        ...(index > 1 ? ['previousRoundId'] : []), ...(index < count ? ['nextRoundId'] : [])]) &&
        clueValid(clueOf(value), id) && coordinate(value.answer) && Number.isFinite(value.difficulty) && value.difficulty > 0 &&
        (index === 1 || value.previousRoundId === roundAt(index - 1)) && (index === count || value.nextRoundId === roundAt(index + 1));
}

// SDK8 once()/get() may expose pending local writes. Only the raw write promise
// acknowledges acceptance. Its barrier survives budgets and adapter recreation.
const pendingWrites = new WeakMap();
const pending = (database, eventId) => pendingWrites.get(database)?.get(eventId);
function track(database, eventId, promise) {
    let events = pendingWrites.get(database);
    if (!events) { events = new Map(); pendingWrites.set(database, events); }
    let writes = events.get(eventId);
    if (!writes) { writes = new Set(); events.set(eventId, writes); }
    writes.add(promise);
    const release = () => {
        writes.delete(promise);
        if (!writes.size) events.delete(eventId);
        if (!events.size) pendingWrites.delete(database);
    };
    promise.then(release, release);
    return promise;
}

/** Bounded version-2 protocol only; callers must explicitly dispatch versions. */
export function createSessionClient(database, identity) {
    function run(eventId, roundId, operation, publicRead = false) {
        if (typeof eventId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(eventId)) return Promise.reject(failure('invalid-event-id'));
        if (roundId !== null && !roundValid(roundId)) return Promise.reject(failure('invalid-round-id'));
        let expired = false;
        let timer;
        const deadline = Date.now() + 15000;
        const active = () => { if (expired || Date.now() >= deadline) throw failure('unavailable'); };
        const base = `events/${eventId}`;
        const read = async path => {
            for (;;) {
                active();
                const writes = pending(database, eventId);
                if (writes?.size) { await Promise.allSettled(Array.from(writes)); continue; }
                const snapshot = await database.ref(`${base}/${path}`).once('value');
                active();
                if (pending(database, eventId)?.size) continue;
                return snapshot.val();
            }
        };
        const checked = async (path, valid) => {
            const value = await read(path);
            if (value !== null && !valid(value)) throw failure('unavailable');
            return value;
        };
        const write = async changes => {
            active();
            await track(database, eventId, database.ref().update(Object.fromEntries(
                Object.entries(changes).map(([path, value]) => [`${base}/${path}`, value])
            )));
            active();
        };
        const task = Promise.resolve().then(async () => {
            let uid;
            if (!publicRead) {
                const user = await identity.ensureUser();
                active();
                if (!user || !uidValid(user.uid)) throw failure('invalid-identity');
                uid = user.uid;
            }
            if (await read('public/formatVersion') !== 2) throw failure('unsupported-format');
            const count = await read('public/roundCount');
            if (!Number.isInteger(count) || count < 1 || count > 20) throw failure('unavailable');
            if (roundId !== null && indexOf(roundId) > count) throw failure('invalid-round-id');
            const state = await checked('public/state', value => stateValid(value, count));
            if (!state) throw failure('unavailable');
            const serverTime = async () => {
                const snapshot = await database.ref('.info/serverTimeOffset').once('value');
                active();
                const offsetMs = snapshot.val();
                const nowMs = Date.now() + offsetMs;
                if (!Number.isFinite(offsetMs) || !validDeadline(nowMs)) throw failure('unavailable');
                return { nowMs, offsetMs };
            };
            return operation({ read, checked, write, uid, count, state, serverTime });
        });
        const timeout = new Promise((resolve, reject) => {
            timer = setTimeout(() => { expired = true; reject(failure('unavailable')); }, 15000);
        });
        return Promise.race([task, timeout]).finally(() => clearTimeout(timer));
    }
    const hostSetup = async (context, id) => {
        const setup = await context.checked(`private/rounds/${id}`, value => setupValid(value, id, context.count));
        if (!setup) throw failure('unavailable');
        return setup;
    };
    const participants = async context => {
        const members = await context.read('public/participants');
        if (members === null) throw failure('no-participants');
        const slots = new Set();
        if (!record(members) || !Object.keys(members).length || Object.keys(members).length > 50 || Object.keys(members).some(uid => {
            const member = members[uid];
            if (!uidValid(uid) || !keys(member, ['slot', 'nickname']) || !/^s(0[1-9]|[1-4][0-9]|50)$/.test(member.slot) ||
                !nicknameValid(member.nickname) || slots.has(member.slot)) return true;
            slots.add(member.slot);
            return false;
        })) throw failure('unavailable');
        return members;
    };
    const artifact = (context, id, type) => context.checked(`public/rounds/${id}/${type}`, value =>
        type === 'clue' ? clueValid(value, id) : revealValid(value, id));
    const sameExpected = (state, expected) => state.roundId === expected.roundId && state.revision === expected.revision;
    const expectedRevision = (command, id) => 4 * indexOf(id) - ({ start: 4, close: 3, reveal: 2, next: 1, complete: 1 }[command]);
    const statuses = { start: 'started', close: 'closed', reveal: 'revealed', next: 'advanced', complete: 'completed' };

    function command(eventId, expected, name) {
        if (!expectedValid(expected)) return Promise.reject(failure('invalid-expected-state'));
        expected = { ...expected };
        return run(eventId, expected.roundId, async context => {
            const id = expected.roundId;
            if (expected.revision !== expectedRevision(name, id)) throw failure('stale-state');
            const confirmed = async () => {
                if (name === 'start') return await artifact(context, id, 'clue') !== null;
                if (name === 'reveal') return await artifact(context, id, 'reveal') !== null;
                if (name === 'close') return (sameExpected(context.state, { roundId: id, revision: expected.revision + 1 }) && context.state.phase === 'closed') ||
                    await artifact(context, id, 'reveal') !== null;
                if (name === 'complete') return context.state.phase === 'complete' && sameExpected(context.state, { roundId: id, revision: expected.revision + 1 });
                if (indexOf(id) >= context.count) return false;
                const successor = roundAt(indexOf(id) + 1);
                return (context.state.phase === 'ready' && sameExpected(context.state, { roundId: successor, revision: expected.revision + 1 })) ||
                    await artifact(context, successor, 'clue') !== null;
            };
            if (!sameExpected(context.state, expected)) {
                if (await confirmed()) return { status: `already-${statuses[name]}` };
                throw failure('stale-state');
            }
            const phases = { start: ['lobby', 'ready'], close: ['guessing'], reveal: ['closed'], next: ['reveal'], complete: ['reveal'] };
            if (!phases[name].includes(context.state.phase)) throw failure('invalid-phase');
            if ((name === 'next' && indexOf(id) >= context.count) || (name === 'complete' && indexOf(id) !== context.count)) throw failure('invalid-phase');
            // Expected state is checked before private configuration/guesses/scoring.
            const setup = await hostSetup(context, id);
            const state = { ...context.state, revision: expected.revision + 1 };
            const changes = { 'public/state': state };
            if (name === 'start') {
                await participants(context);
                state.phase = 'guessing';
                changes[`public/rounds/${id}/clue`] = clueOf(setup);
            } else if (name === 'close') state.phase = 'closed';
            else if (name === 'next') { state.phase = 'ready'; state.roundId = setup.nextRoundId; }
            else if (name === 'complete') state.phase = 'complete';
            else {
                const members = await participants(context);
                const guesses = await context.read(`private/guesses/${id}`) || {};
                if (!record(guesses) || Object.keys(guesses).some(uid => !own(members, uid))) throw failure('unavailable');
                const previous = setup.previousRoundId ? await artifact(context, setup.previousRoundId, 'reveal') : null;
                if (setup.previousRoundId && (!previous || Object.keys(previous.results).length !== Object.keys(members).length ||
                    Object.keys(members).some(uid => !own(previous.results, uid) || previous.results[uid].nickname !== members[uid].nickname))) throw failure('unavailable');
                const results = {};
                for (const uid of Object.keys(members).sort()) {
                    const result = { nickname: members[uid].nickname, answered: false, points: 0, totalPoints: previous ? previous.results[uid].totalPoints : 0 };
                    if (own(guesses, uid)) {
                        const guess = guesses[uid];
                        if (!coordinate(guess)) throw failure('unavailable');
                        result.answered = true;
                        result.distance = Math.floor(distance([setup.answer.lng, setup.answer.lat], [guess.lng, guess.lat], { units: 'meters' }));
                        result.points = getScore(result.distance, setup.difficulty, 0, 'normal');
                        result.totalPoints += result.points;
                    }
                    if (!resultValid(result)) throw failure('unavailable');
                    // SDK8 requires ordinary objects. Define UID keys without invoking __proto__.
                    Object.defineProperty(results, uid, { value: result, enumerable: true });
                }
                changes[`public/rounds/${id}/reveal`] = { roundId: id, answer: setup.answer, results };
                state.phase = 'reveal';
                state.lastRevealedRoundId = id;
            }
            try {
                await context.write(changes);
                return { status: statuses[name] };
            } catch (error) {
                if (permissionDenied(error)) {
                    context.state = await context.checked('public/state', value => stateValid(value, context.count));
                    if (context.state && await confirmed()) return { status: `already-${statuses[name]}` };
                }
                throw error;
            }
        });
    }

    function setDeadline(eventId, expected, deadlineMs) {
        if (!expectedValid(expected)) return Promise.reject(failure('invalid-expected-state'));
        if (!validDeadline(deadlineMs)) return Promise.reject(failure('invalid-deadline'));
        expected = { ...expected };
        return run(eventId, expected.roundId, async context => {
            if (!sameExpected(context.state, expected)) throw failure('stale-state');
            if (context.state.phase !== 'guessing') throw failure('invalid-phase');
            await hostSetup(context, expected.roundId);
            const path = `public/rounds/${expected.roundId}/timing`;
            const confirmed = async () => {
                const state = await context.checked('public/state', value => stateValid(value, context.count));
                if (!state || !sameExpected(state, expected) || state.phase !== 'guessing') throw failure('stale-state');
                const value = await context.checked(path, timing => timingValid(timing, expected.roundId));
                return value && value.deadlineMs >= deadlineMs ? value : null;
            };
            const existing = await confirmed();
            if (existing) return { status: 'already-set', timing: existing };
            const { nowMs } = await context.serverTime();
            if (deadlineMs <= nowMs || deadlineMs > nowMs + MAX_WINDOW_MS) throw failure('invalid-deadline');
            const timing = { roundId: expected.roundId, deadlineMs };
            try {
                await context.write({ [path]: timing });
                return { status: 'set', timing };
            } catch (error) {
                if (permissionDenied(error)) {
                    const accepted = await confirmed();
                    if (accepted) return { status: 'already-set', timing: accepted };
                }
                throw error;
            }
        });
    }

    function submitGuess(eventId, roundId, guess) {
        if (!roundValid(roundId)) return Promise.reject(failure('invalid-round-id'));
        if (!coordinate(guess)) return Promise.reject(failure('invalid-guess'));
        guess = { lat: guess.lat, lng: guess.lng };
        return run(eventId, roundId, async context => {
            const path = `private/guesses/${roundId}/${context.uid}`;
            const existing = await context.checked(path, coordinate);
            if (existing) return { status: 'already-submitted', guess: existing };
            if (context.state.roundId !== roundId) throw failure('stale-state');
            if (context.state.phase !== 'guessing') throw failure('invalid-phase');
            const timing = await context.checked(`public/rounds/${roundId}/timing`, value => timingValid(value, roundId));
            if (timing && (await context.serverTime()).nowMs >= timing.deadlineMs) throw failure('deadline-expired');
            const submitted = { lat: guess.lat, lng: guess.lng };
            try {
                await context.write({ [path]: submitted });
                return { status: 'submitted', guess: submitted };
            } catch (error) {
                if (permissionDenied(error)) {
                    const accepted = await context.checked(path, coordinate);
                    if (accepted) return { status: 'already-submitted', guess: accepted };
                }
                throw error;
            }
        });
    }
    const roundRead = (eventId, id, operation, publicRead = false) => roundValid(id) ? run(eventId, id, operation, publicRead) :
        Promise.reject(failure('invalid-round-id'));
    return {
        start: (eventId, expected) => command(eventId, expected, 'start'),
        close: (eventId, expected) => command(eventId, expected, 'close'),
        reveal: (eventId, expected) => command(eventId, expected, 'reveal'),
        next: (eventId, expected) => command(eventId, expected, 'next'),
        complete: (eventId, expected) => command(eventId, expected, 'complete'),
        setDeadline, submitGuess,
        getState: eventId => run(eventId, null, context => context.state, true),
        getClue: (eventId, id) => roundRead(eventId, id, context => artifact(context, id, 'clue'), true),
        getReveal: (eventId, id) => roundRead(eventId, id, context => artifact(context, id, 'reveal'), true),
        getTiming: (eventId, id) => roundRead(eventId, id, context => context.checked(`public/rounds/${id}/timing`, value => timingValid(value, id)), true),
        getServerTime: eventId => run(eventId, null, context => context.serverTime(), true),
        getOwnGuess: (eventId, id) => roundRead(eventId, id, context => context.checked(`private/guesses/${id}/${context.uid}`, coordinate)),
        getHostSetup: (eventId, id) => roundRead(eventId, id, context => hostSetup(context, id)),
    };
}
