import distance from '@turf/distance';
import { getScore } from '../utils/game/score';
import { MAX_WINDOW_MS, validDeadline, validTiming } from './timing';

const failure = code => Object.assign(new Error(code), { code });
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, expected) => record(value) && Object.keys(value).length === expected.length &&
    expected.every(key => Object.prototype.hasOwnProperty.call(value, key));
const uidValid = uid => typeof uid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(uid);
const coordinate = value => keys(value, ['lat', 'lng']) && Number.isFinite(value.lat) &&
    value.lat >= -90 && value.lat <= 90 && Number.isFinite(value.lng) && value.lng >= -180 && value.lng <= 180;
const clueValid = value => keys(value, ['id', 'panoramaId', 'heading', 'pitch']) && value.id === 'r1' &&
    typeof value.panoramaId === 'string' && value.panoramaId.length > 0 && value.panoramaId.length <= 512 &&
    Number.isFinite(value.heading) && value.heading >= 0 && value.heading < 360 &&
    Number.isFinite(value.pitch) && value.pitch >= -90 && value.pitch <= 90;
const setupValid = value => keys(value, ['id', 'panoramaId', 'heading', 'pitch', 'answer', 'difficulty']) &&
    clueValid(clueOf(value)) && coordinate(value.answer) && Number.isFinite(value.difficulty) && value.difficulty > 0;
const clueOf = value => ({ id: value.id, panoramaId: value.panoramaId, heading: value.heading, pitch: value.pitch });
const nicknameValid = name => typeof name === 'string' && name === name.trim() &&
    Array.from(name).length >= 1 && Array.from(name).length <= 20;
const resultValid = value => record(value) && nicknameValid(value.nickname) &&
    typeof value.answered === 'boolean' && Number.isInteger(value.points) && value.points >= 0 && value.points <= 5000 &&
    (value.answered ? keys(value, ['nickname', 'answered', 'points', 'distance']) &&
        Number.isInteger(value.distance) && value.distance >= 0 :
        keys(value, ['nickname', 'answered', 'points']) && value.points === 0);
const revealValid = value => keys(value, ['roundId', 'answer', 'results']) && value.roundId === 'r1' &&
    coordinate(value.answer) && record(value.results) && Object.keys(value.results).length <= 50 &&
    Object.keys(value.results).every(uid => uidValid(uid) && resultValid(value.results[uid]));

// Raw SDK acknowledgements outlive a command's deadline and are shared across
// every adapter using this database/event. Both once() AND get() can return
// pending local writes: neither is an acknowledgement barrier on Firebase 8.
const pendingWrites = new WeakMap();
function pending(database, eventId) {
    const events = pendingWrites.get(database);
    return events && events.get(eventId);
}
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
const permissionDenied = error => /^(database\/)?permission-denied$/.test(
    typeof error.code === 'string' ? error.code.toLowerCase().replace(/_/g, '-') : '');

/** One optionally timed round. Firebase 8 DB and restored identity are injected. */
export function createRoundClient(database, identity) {
    function run(eventId, roundId, operation, publicRead = false) {
        if (typeof eventId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(eventId)) {
            return Promise.reject(failure('invalid-event-id'));
        }
        if (roundId !== 'r1') return Promise.reject(failure('invalid-round-id'));
        let expired = false;
        let timer;
        const deadline = Date.now() + 15000;
        const active = () => { if (expired || Date.now() >= deadline) throw failure('unavailable'); };
        const base = `events/${eventId}`;
        const read = async path => {
            for (;;) {
                active();
                const writes = pending(database, eventId);
                if (writes && writes.size) { await Promise.allSettled(Array.from(writes)); continue; }
                const snapshot = await database.ref(`${base}/${path}`).once('value');
                active();
                const current = pending(database, eventId);
                if (current && current.size) continue;
                return snapshot.val();
            }
        };
        const write = async changes => {
            active();
            await track(database, eventId, database.ref().update(Object.fromEntries(
                Object.entries(changes).map(([path, value]) => [`${base}/${path}`, value])
            )));
            active();
        };
        const checked = async (path, valid) => {
            const value = await read(path);
            if (value !== null && !valid(value)) throw failure('unavailable');
            return value;
        };
        const task = Promise.resolve().then(async () => {
            let uid;
            if (!publicRead) {
                const user = await identity.ensureUser();
                active();
                if (!user || !uidValid(user.uid)) throw failure('invalid-identity');
                uid = user.uid;
            }
            active();
            const serverTime = async () => {
                const snapshot = await database.ref('.info/serverTimeOffset').once('value');
                active();
                const offsetMs = snapshot.val();
                const nowMs = Date.now() + offsetMs;
                if (!Number.isFinite(offsetMs) || !validDeadline(nowMs)) throw failure('unavailable');
                return { nowMs, offsetMs };
            };
            return operation({ read, write, checked, uid, serverTime });
        });
        const timeout = new Promise((resolve, reject) => {
            timer = setTimeout(() => { expired = true; reject(failure('unavailable')); }, 15000);
        });
        return Promise.race([task, timeout]).finally(() => clearTimeout(timer));
    }

    const hostSetup = async context => {
        const setup = await context.checked('private/round', setupValid);
        if (!setup) throw failure('unavailable');
        return setup;
    };
    function start(eventId) {
        return run(eventId, 'r1', async context => {
            const setup = await hostSetup(context);
            const confirmed = async () => {
                const phase = await context.read('public/phase');
                const round = await context.checked('public/round', clueValid);
                return ['guessing', 'closed', 'reveal'].includes(phase) &&
                    round && Object.keys(round).every(key => round[key] === setup[key]);
            };
            if (await confirmed()) return { status: 'already-started' };
            const participants = await context.read('public/participants');
            if (participants === null) throw failure('no-participants');
            if (!record(participants) || !Object.keys(participants).length) throw failure('unavailable');
            try {
                await context.write({ 'public/round': clueOf(setup), 'public/phase': 'guessing' });
                return { status: 'started' };
            } catch (error) {
                if (permissionDenied(error) && await confirmed()) return { status: 'already-started' };
                throw error;
            }
        });
    }
    function close(eventId) {
        return run(eventId, 'r1', async context => {
            await hostSetup(context);
            const confirmed = async () => ['closed', 'reveal'].includes(await context.read('public/phase'));
            if (await confirmed()) return { status: 'already-closed' };
            try {
                await context.write({ 'public/phase': 'closed' });
                return { status: 'closed' };
            } catch (error) {
                if (permissionDenied(error) && await confirmed()) return { status: 'already-closed' };
                throw error;
            }
        });
    }
    function reveal(eventId) {
        return run(eventId, 'r1', async context => {
            const setup = await hostSetup(context);
            const confirmed = async () => await context.read('public/phase') === 'reveal' &&
                await context.checked('public/reveal', revealValid) !== null;
            if (await confirmed()) return { status: 'already-revealed' };
            if (await context.read('public/phase') !== 'closed') throw failure('invalid-phase');
            const participants = await context.read('public/participants') || {};
            const guesses = await context.read('private/guesses/r1') || {};
            if (!record(participants) || !record(guesses) || Object.keys(participants).length > 50 ||
                Object.keys(guesses).some(uid => !Object.prototype.hasOwnProperty.call(participants, uid))) {
                throw failure('unavailable');
            }
            // SDK8 traverses values with value.hasOwnProperty(), so it requires
            // ordinary objects. Define own keys to avoid the __proto__ setter.
            const results = {};
            for (const uid of Object.keys(participants).sort()) {
                const member = participants[uid];
                if (!uidValid(uid) || !keys(member, ['slot', 'nickname']) || !/^s(0[1-9]|[1-4][0-9]|50)$/.test(member.slot) ||
                    !nicknameValid(member.nickname)) throw failure('unavailable');
                const result = { nickname: member.nickname, answered: false, points: 0 };
                if (Object.prototype.hasOwnProperty.call(guesses, uid)) {
                    const guess = guesses[uid];
                    if (!coordinate(guess)) throw failure('unavailable');
                    result.answered = true;
                    result.distance = Math.floor(distance([setup.answer.lng, setup.answer.lat], [guess.lng, guess.lat], { units: 'meters' }));
                    result.points = getScore(result.distance, setup.difficulty, 0, 'normal');
                }
                Object.defineProperty(results, uid, { value: result, enumerable: true });
            }
            // Firebase omits empty objects; this protocol requires an admitted
            // guest before publishing a results map.
            if (!Object.keys(results).length) throw failure('no-participants');
            try {
                await context.write({ 'public/reveal': { roundId: 'r1', answer: setup.answer, results }, 'public/phase': 'reveal' });
                return { status: 'revealed' };
            } catch (error) {
                if (permissionDenied(error) && await confirmed()) return { status: 'already-revealed' };
                throw error;
            }
        });
    }
    // Absolute requests are retry-safe: never recompute/add a duration here.
    function setDeadline(eventId, deadlineMs) {
        if (!validDeadline(deadlineMs)) return Promise.reject(failure('invalid-deadline'));
        return run(eventId, 'r1', async context => {
            await hostSetup(context);
            const confirmed = async () => {
                const timing = await context.checked('public/timing', validTiming);
                return timing && timing.deadlineMs >= deadlineMs ? timing : null;
            };
            const existing = await confirmed();
            if (existing) return { status: 'already-set', timing: existing };
            if (await context.read('public/phase') !== 'guessing') throw failure('invalid-phase');
            const { nowMs } = await context.serverTime();
            if (deadlineMs <= nowMs || deadlineMs > nowMs + MAX_WINDOW_MS) throw failure('invalid-deadline');
            const timing = { roundId: 'r1', deadlineMs };
            try {
                await context.write({ 'public/timing': timing });
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
        return run(eventId, roundId, async context => {
            if (!coordinate(guess)) throw failure('invalid-guess');
            const path = `private/guesses/r1/${context.uid}`;
            const existing = await context.checked(path, coordinate);
            if (existing) return { status: 'already-submitted', guess: existing };
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
    return {
        start, close, reveal, submitGuess, setDeadline,
        getTiming: eventId => run(eventId, 'r1', context => context.checked('public/timing', validTiming), true),
        getServerTime: eventId => run(eventId, 'r1', context => context.serverTime(), true),
        getRound: eventId => run(eventId, 'r1', context => context.checked('public/round', clueValid), true),
        getReveal: eventId => run(eventId, 'r1', context => context.checked('public/reveal', revealValid), true),
        getOwnGuess: (eventId, roundId) => run(eventId, roundId, context => context.checked(`private/guesses/r1/${context.uid}`, coordinate)),
        getHostSetup: eventId => run(eventId, 'r1', hostSetup),
    };
}
