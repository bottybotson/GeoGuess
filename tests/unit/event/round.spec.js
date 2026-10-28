import { createRoundClient } from '../../../src/event/round';
import { getScore } from '../../../src/utils/game/score';
import distance from '@turf/distance';

const setup = { id: 'r1', panoramaId: 'fixture-only', heading: 20, pitch: 0, answer: { lat: 0, lng: 0 }, difficulty: 2000 };
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture(initial = {}) {
    const values = { 'private/round': setup, 'public/phase': 'lobby', 'public/round': null, 'public/reveal': null,
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
