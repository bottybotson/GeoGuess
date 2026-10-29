import { createRoundClient } from '../../../src/event/round';
import { getScore } from '../../../src/utils/game/score';
import distance from '@turf/distance';

const setup = { id: 'r1', panoramaId: 'fixture-only', heading: 20, pitch: 0, answer: { lat: 0, lng: 0 }, difficulty: 2000 };
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture(initial = {}) {
    const values = { '.info/serverTimeOffset': 0, 'public/timing': null, 'private/round': setup, 'public/phase': 'lobby', 'public/round': null, 'public/reveal': null,
        'public/participants': { guest: { slot: 's01', nickname: 'Guest' } }, ...initial };
    const database = { ref: jest.fn(path => path === undefined ? { update: jest.fn(async changes => {
        Object.entries(changes).forEach(([key, value]) => { values[key.replace('events/event/', '')] = value; });
    }) } : { once: jest.fn(async () => ({ val: () => values[path.replace('events/event/', '')] ?? null })) }) };
    const identity = { ensureUser: jest.fn(async () => ({ uid: 'guest' })) };
    return { values, database, identity, client: createRoundClient(database, identity) };
}

test('rejects invalid identifiers before identity and validates exact coordinates', async () => {
    const f = fixture();
    await expect(f.client.start('../bad')).rejects.toMatchObject({ code: 'invalid-event-id' });
    await expect(f.client.getOwnGuess('event', 'r2')).rejects.toMatchObject({ code: 'invalid-round-id' });
    expect(f.identity.ensureUser).not.toHaveBeenCalled();
    for (const guess of [{ lat: NaN, lng: 0 }, { lat: 91, lng: 0 }, { lat: 0, lng: -181 }, { lat: 0, lng: 0, points: 5000 }]) {
        await expect(f.client.submitGuess('event', 'r1', guess)).rejects.toMatchObject({ code: 'invalid-guess' });
    }
});

test('projects the exact seeded clue and repeated commands do not regress phases', async () => {
    const f = fixture();
    expect(await f.client.start('event')).toEqual({ status: 'started' });
    expect(await f.client.getRound('event')).toEqual({ id: 'r1', panoramaId: 'fixture-only', heading: 20, pitch: 0 });
    expect(await f.client.close('event')).toEqual({ status: 'closed' });
    expect(await f.client.start('event')).toEqual({ status: 'already-started' });
    expect(await f.client.close('event')).toEqual({ status: 'already-closed' });
    expect(f.values['public/phase']).toBe('closed');
});

test('scores every participant once and leaves no-answer distance absent', async () => {
    const f = fixture({ 'public/phase': 'closed', 'public/participants': {
        guest: { slot: 's01', nickname: 'Guest' }, missing: { slot: 's02', nickname: 'Missing' },
    }, 'private/guesses/r1': { guest: { lat: 10, lng: 20 } } });
    expect(await f.client.reveal('event')).toEqual({ status: 'revealed' });
    const meters = Math.floor(distance([0, 0], [20, 10], { units: 'meters' }));
    const reveal = await f.client.getReveal('event');
    expect(reveal.results).toEqual({
        guest: { nickname: 'Guest', answered: true, points: getScore(meters, 2000, 0, 'normal'), distance: meters },
        missing: { nickname: 'Missing', answered: false, points: 0 },
    });
    expect(await f.client.reveal('event')).toEqual({ status: 'already-revealed' });
    expect(await f.client.getReveal('event')).toEqual(reveal);
});

test('retry returns the original immutable guess', async () => {
    const f = fixture({ 'private/guesses/r1/guest': { lat: 1, lng: 2 } });
    expect(await f.client.submitGuess('event', 'r1', { lat: 50, lng: 60 })).toEqual({ status: 'already-submitted', guess: { lat: 1, lng: 2 } });
});

test('starting requires at least one admitted guest', async () => {
    const f = fixture({ 'public/participants': null });
    await expect(f.client.start('event')).rejects.toMatchObject({ code: 'no-participants' });
    expect(f.values['public/phase']).toBe('lobby');
});

test('public reads never request identity while every private read and command still does', async () => {
    const f = fixture();
    const missingIdentity = new Error('Presenter identity must not be requested');
    f.identity.ensureUser.mockRejectedValue(missingIdentity);
    expect(await f.client.getRound('event')).toBeNull();
    expect(await f.client.getReveal('event')).toBeNull();
    await expect(f.client.getRound('../bad')).rejects.toMatchObject({ code: 'invalid-event-id' });
    expect(f.identity.ensureUser).not.toHaveBeenCalled();
    for (const operation of [
        () => f.client.getOwnGuess('event', 'r1'), () => f.client.getHostSetup('event'),
        () => f.client.start('event'), () => f.client.close('event'), () => f.client.reveal('event'),
        () => f.client.submitGuess('event', 'r1', { lat: 0, lng: 0 }),
    ]) await expect(operation()).rejects.toBe(missingIdentity);
    expect(f.identity.ensureUser).toHaveBeenCalledTimes(6);
});

test('fresh adapters and reads wait for the raw acknowledgement after a deadline', async () => {
    jest.useFakeTimers();
    const raw = deferred();
    const queued = deferred();
    const f = fixture();
    const originalRef = f.database.ref;
    f.database.ref = jest.fn(path => path === undefined ? { update(changes) {
        Object.entries(changes).forEach(([key, value]) => { f.values[key.replace('events/event/', '')] = value; });
        queued.resolve();
        return raw.promise;
    } } : originalRef(path));
    try {
        const first = f.client.submitGuess('event', 'r1', { lat: 1, lng: 2 });
        const rejected = expect(first).rejects.toMatchObject({ code: 'unavailable' });
        await queued.promise;
        await jest.advanceTimersByTimeAsync(15000);
        await rejected;
        const next = createRoundClient(f.database, f.identity);
        let settled = false;
        const read = next.getOwnGuess('event', 'r1').then(value => { settled = true; return value; });
        const presenterIdentity = { ensureUser: jest.fn() };
        const presenter = createRoundClient(f.database, presenterIdentity);
        let publicSettled = false;
        const publicReads = Promise.all([presenter.getRound('event'), presenter.getReveal('event')])
            .then(value => { publicSettled = true; return value; });
        await Promise.resolve(); await Promise.resolve();
        expect(settled).toBe(false);
        expect(publicSettled).toBe(false);
        expect(presenterIdentity.ensureUser).not.toHaveBeenCalled();
        raw.resolve();
        expect(await read).toEqual({ lat: 1, lng: 2 });
        expect(await publicReads).toEqual([null, null]);
    } finally { jest.useRealTimers(); }
});

test('malformed public/private values fail closed', async () => {
    const f = fixture({ 'public/round': { ...setup }, 'public/reveal': { answer: setup.answer }, 'private/round': { ...setup, difficulty: 0 } });
    await expect(f.client.getRound('event')).rejects.toMatchObject({ code: 'unavailable' });
    await expect(f.client.getReveal('event')).rejects.toMatchObject({ code: 'unavailable' });
    await expect(f.client.getHostSetup('event')).rejects.toMatchObject({ code: 'unavailable' });
});


test('timing reads and server offset are public without creating an identity', async () => {
    const f = fixture({ '.info/serverTimeOffset': 45000 });
    f.identity.ensureUser.mockRejectedValue(new Error('No presenter identity'));
    expect(await f.client.getTiming('event')).toBeNull();
    const before = Date.now();
    const time = await f.client.getServerTime('event');
    expect(time.offsetMs).toBe(45000);
    expect(time.nowMs).toBeGreaterThanOrEqual(before + 45000);
    expect(time.nowMs).toBeLessThanOrEqual(Date.now() + 45000);
    expect(f.identity.ensureUser).not.toHaveBeenCalled();
    f.values['.info/serverTimeOffset'] = NaN;
    await expect(f.client.getServerTime('event')).rejects.toMatchObject({ code: 'unavailable' });
});

test('absolute deadline initialization and stale retries never add time twice', async () => {
    const f = fixture({ 'public/phase': 'guessing' });
    const target = Date.now() + 60000;
    const timing = { roundId: 'r1', deadlineMs: target };
    expect(await f.client.setDeadline('event', target)).toEqual({ status: 'set', timing });
    const next = createRoundClient(f.database, f.identity);
    expect(await next.setDeadline('event', target)).toEqual({ status: 'already-set', timing });
    expect(await next.setDeadline('event', target - 1000)).toEqual({ status: 'already-set', timing });
    expect(await next.getTiming('event')).toEqual(timing);
    const extended = { roundId: 'r1', deadlineMs: target + 30000 };
    expect(await next.setDeadline('event', extended.deadlineMs)).toEqual({ status: 'set', timing: extended });
    expect(await f.client.setDeadline('event', target)).toEqual({ status: 'already-set', timing: extended });
    f.values['public/phase'] = 'closed';
    await expect(next.setDeadline('event', target + 60000)).rejects.toMatchObject({ code: 'invalid-phase' });
});

test('invalid deadline and malformed timing values fail closed', async () => {
    const f = fixture({ 'public/phase': 'guessing' });
    for (const target of [0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        await expect(f.client.setDeadline('event', target)).rejects.toMatchObject({ code: 'invalid-deadline' });
    }
    expect(f.identity.ensureUser).not.toHaveBeenCalled();
    for (const target of [Date.now() - 1000, Date.now() + 7200001 + 1000]) {
        await expect(f.client.setDeadline('event', target)).rejects.toMatchObject({ code: 'invalid-deadline' });
    }
    f.values['public/timing'] = { roundId: 'r2', deadlineMs: Date.now() + 1000 };
    await expect(f.client.getTiming('event')).rejects.toMatchObject({ code: 'unavailable' });
});

test.each([true, false])('uncertain timing write waits for raw acknowledgement (accepted=%s)', async accepted => {
    jest.useFakeTimers();
    const raw = deferred();
    const queued = deferred();
    const f = fixture({ 'public/phase': 'guessing' });
    const target = Date.now() + 60000;
    const originalRef = f.database.ref;
    f.database.ref = jest.fn(path => path === undefined ? { update(changes) {
        Object.entries(changes).forEach(([key, value]) => { f.values[key.replace('events/event/', '')] = value; });
        queued.resolve();
        return raw.promise;
    } } : originalRef(path));
    try {
        const first = f.client.setDeadline('event', target);
        const rejection = expect(first).rejects.toMatchObject({ code: 'unavailable' });
        await queued.promise;
        await jest.advanceTimersByTimeAsync(15000);
        await rejection;
        const fresh = createRoundClient(f.database, f.identity);
        let settled = false;
        const read = fresh.getTiming('event').then(value => { settled = true; return value; });
        await Promise.resolve(); await Promise.resolve();
        expect(settled).toBe(false);
        if (accepted) raw.resolve();
        else {
            f.values['public/timing'] = null;
            raw.reject(Object.assign(new Error('denied'), { code: 'PERMISSION_DENIED' }));
        }
        expect(await read).toEqual(accepted ? { roundId: 'r1', deadlineMs: target } : null);
    } finally { jest.useRealTimers(); }
});
