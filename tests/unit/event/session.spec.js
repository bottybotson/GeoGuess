import { createSessionClient } from '../../../src/event/session';

const first = { id: 'r01', panoramaId: 'first-exact', heading: 20, pitch: -5, answer: { lat: 0, lng: 0 }, difficulty: 2000, nextRoundId: 'r02' };
const second = { ...first, id: 'r02', panoramaId: 'second-exact', previousRoundId: 'r01' };
delete second.nextRoundId;
const clue = setup => ({ id: setup.id, panoramaId: setup.panoramaId, heading: setup.heading, pitch: setup.pitch });
const expected = (roundId, revision) => ({ roundId, revision });
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let index = 0; index < 30; index += 1) await Promise.resolve(); };
function fixture(initial = {}) {
    const values = { '.info/serverTimeOffset': 0, 'public/formatVersion': 2, 'public/roundCount': 2,
        'public/state': { phase: 'lobby', roundId: 'r01', revision: 0 },
        'private/rounds/r01': first, 'private/rounds/r02': second,
        'public/participants': { guest: { slot: 's01', nickname: 'Guest' }, missed: { slot: 's02', nickname: 'Missed' } }, ...initial };
    const reads = [];
    const update = jest.fn(async changes => {
        Object.entries(changes).forEach(([path, value]) => { values[path.replace('events/event/', '')] = value; });
    });
    const database = { ref: jest.fn(path => path === undefined ? { update } : { once: jest.fn(async () => {
        const key = path.replace('events/event/', ''); reads.push(key);
        return { val: () => values[key] ?? null };
    }) }) };
    const identity = { ensureUser: jest.fn(async () => ({ uid: 'guest' })) };
    return { values, reads, update, database, identity, client: createSessionClient(database, identity) };
}
async function firstReveal(f) {
    await f.client.start('event', expected('r01', 0));
    await f.client.submitGuess('event', 'r01', { lat: 0, lng: 0 });
    // The mock stores independent leaf reads, like Firebase snapshots.
    f.values['private/guesses/r01'] = { guest: f.values['private/guesses/r01/guest'] };
    await f.client.close('event', expected('r01', 1));
    await f.client.reveal('event', expected('r01', 2));
}

test('two rounds preserve reveal discussion, ready state, cumulative standings and missed answers through refresh', async () => {
    const f = fixture();
    await firstReveal(f);
    const reveal1 = await f.client.getReveal('event', 'r01');
    expect(reveal1.results).toEqual({ guest: { nickname: 'Guest', answered: true, points: 5000, totalPoints: 5000, distance: 0 },
        missed: { nickname: 'Missed', answered: false, points: 0, totalPoints: 0 } });
    const refreshed = createSessionClient(f.database, f.identity);
    expect(await refreshed.getState('event')).toEqual({ phase: 'reveal', roundId: 'r01', revision: 3, lastRevealedRoundId: 'r01' });
    expect(await refreshed.getClue('event', 'r02')).toBeNull();
    expect(await refreshed.next('event', expected('r01', 3))).toEqual({ status: 'advanced' });
    expect(await refreshed.getState('event')).toEqual({ phase: 'ready', roundId: 'r02', revision: 4, lastRevealedRoundId: 'r01' });
    expect(await refreshed.getClue('event', 'r02')).toBeNull();
    await refreshed.start('event', expected('r02', 4));
    expect(await refreshed.getClue('event', 'r02')).toEqual(clue(second));
    await refreshed.close('event', expected('r02', 5));
    await refreshed.reveal('event', expected('r02', 6));
    expect((await refreshed.getReveal('event', 'r02')).results).toEqual({
        guest: { nickname: 'Guest', answered: false, points: 0, totalPoints: 5000 },
        missed: { nickname: 'Missed', answered: false, points: 0, totalPoints: 0 },
    });
    expect(await refreshed.complete('event', expected('r02', 7))).toEqual({ status: 'completed' });
    expect(await refreshed.getState('event')).toEqual({ phase: 'complete', roundId: 'r02', revision: 8, lastRevealedRoundId: 'r02' });
    expect(await refreshed.getReveal('event', 'r01')).toEqual(reveal1);
    expect(f.update.mock.calls.every(([changes]) => Object.keys(changes).every(path => !path.includes('totalPoints')))).toBe(true);
});

test('exact old retries use original immutable artifacts and cannot retarget the successor', async () => {
    const f = fixture();
    await firstReveal(f);
    await f.client.next('event', expected('r01', 3));
    await f.client.start('event', expected('r02', 4));
    const calls = f.update.mock.calls.length;
    for (const [name, revision, status] of [['start', 0, 'already-started'], ['close', 1, 'already-closed'], ['reveal', 2, 'already-revealed'], ['next', 3, 'already-advanced']]) {
        expect(await f.client[name]('event', expected('r01', revision))).toEqual({ status });
        await expect(f.client[name]('event', expected('r01', revision + 100))).rejects.toMatchObject({ code: 'stale-state' });
    }
    await expect(f.client.close('event', expected('r01', 5))).rejects.toMatchObject({ code: 'stale-state' });
    await expect(f.client.setDeadline('event', expected('r01', 1), Date.now() + 60000)).rejects.toMatchObject({ code: 'stale-state' });
    expect(f.update).toHaveBeenCalledTimes(calls);
    expect(f.values['public/state']).toMatchObject({ phase: 'guessing', roundId: 'r02', revision: 5 });
});

test('stale commands fail before private reads or scoring and cannot infer unpublished transitions', async () => {
    const f = fixture();
    await expect(f.client.reveal('event', expected('r01', 2))).rejects.toMatchObject({ code: 'stale-state' });
    await expect(f.client.next('event', expected('r01', 3))).rejects.toMatchObject({ code: 'stale-state' });
    expect(f.reads.some(path => path.startsWith('private/'))).toBe(false);
    expect(f.update).not.toHaveBeenCalled();
});

test('public leaf readers and clock never request identity or ancestor/private paths', async () => {
    const f = fixture();
    f.identity.ensureUser.mockRejectedValue(new Error('identity unavailable'));
    expect(await f.client.getState('event')).toMatchObject({ phase: 'lobby' });
    for (const method of ['getClue', 'getReveal', 'getTiming']) expect(await f.client[method]('event', 'r01')).toBeNull();
    expect(await f.client.getServerTime('event')).toEqual({ offsetMs: 0, nowMs: expect.any(Number) });
    expect(f.identity.ensureUser).not.toHaveBeenCalled();
    expect(f.reads.every(path => path.startsWith('public/') || path === '.info/serverTimeOffset')).toBe(true);
    for (const method of ['getOwnGuess', 'getHostSetup']) await expect(f.client[method]('event', 'r01')).rejects.toThrow('identity unavailable');
    await expect(f.client.start('event', expected('r01', 0))).rejects.toThrow('identity unavailable');
});

test.each([null, 1, 3, '2', {}])('unsupported format fails closed before state/private reads (%p)', async version => {
    const f = fixture({ 'public/formatVersion': version });
    await expect(f.client.getState('event')).rejects.toMatchObject({ code: 'unsupported-format' });
    await expect(f.client.start('event', expected('r01', 0))).rejects.toMatchObject({ code: 'unsupported-format' });
    expect(f.reads).toEqual(['public/formatVersion', 'public/formatVersion']);
    expect(f.update).not.toHaveBeenCalled();
});

test.each([
    { phase: 'guessing', roundId: 'r01', revision: 99 }, { phase: 'ready', roundId: 'r01', revision: 0 },
    { phase: 'lobby', roundId: 'r02', revision: 0 }, { phase: 'reveal', roundId: 'r01', revision: 3 },
    { phase: 'closed', roundId: 'r02', revision: 6, lastRevealedRoundId: 'r02' },
    { phase: 'complete', roundId: 'r01', revision: 4, lastRevealedRoundId: 'r01' },
    { phase: '__proto__', roundId: 'r01', revision: 0 }, { phase: 'lobby', roundId: 'r01', revision: 0, extra: true },
    { phase: 'lobby', roundId: 'r21', revision: 0 }, { phase: 'lobby', roundId: 'r01', revision: 0, lastRevealedRoundId: null },
])('malicious state fails closed: %p', async state => {
    const f = fixture({ 'public/state': state });
    await expect(f.client.getState('event')).rejects.toMatchObject({ code: 'unavailable' });
    await expect(f.client.start('event', expected('r01', 0))).rejects.toMatchObject({ code: 'unavailable' });
    expect(f.update).not.toHaveBeenCalled();
});

test('identifiers, exact expected tokens, count and input guesses are bounded before writes', async () => {
    const f = fixture();
    await expect(f.client.getState('../event')).rejects.toMatchObject({ code: 'invalid-event-id' });
    for (const id of ['r1', 'r00', 'r21', null, undefined, '../r01']) {
        await expect(f.client.getClue('event', id)).rejects.toMatchObject({ code: 'invalid-round-id' });
    }
    for (const value of [undefined, { roundId: 'r01' }, { roundId: 'r01', revision: 0, phase: 'lobby' }, { roundId: 'r01', revision: -1 }]) {
        await expect(f.client.start('event', value)).rejects.toMatchObject({ code: 'invalid-expected-state' });
    }
    for (const value of [{ lat: NaN, lng: 0 }, { lat: 91, lng: 0 }, { lat: 0, lng: 181 }, { lat: 0, lng: 0, points: 5000 }]) {
        await expect(f.client.submitGuess('event', 'r01', value)).rejects.toMatchObject({ code: 'invalid-guess' });
    }
    expect(f.identity.ensureUser).not.toHaveBeenCalled();
    await expect(f.client.getClue('event', 'r03')).rejects.toMatchObject({ code: 'invalid-round-id' });
    for (const count of [0, 21, 1.5, '2']) {
        f.values['public/roundCount'] = count;
        await expect(f.client.getState('event')).rejects.toMatchObject({ code: 'unavailable' });
    }
    expect(f.update).not.toHaveBeenCalled();
});

test('setup links and duplicate slots fail closed and a missing participant cannot start', async () => {
    const f = fixture({ 'private/rounds/r01': { ...first, nextRoundId: 'r03' } });
    await expect(f.client.start('event', expected('r01', 0))).rejects.toMatchObject({ code: 'unavailable' });
    f.values['private/rounds/r01'] = first;
    f.values['public/participants'] = { guest: { slot: 's01', nickname: 'Guest' }, other: { slot: 's01', nickname: 'Other' } };
    await expect(f.client.start('event', expected('r01', 0))).rejects.toMatchObject({ code: 'unavailable' });
    f.values['public/participants'] = null;
    await expect(f.client.start('event', expected('r01', 0))).rejects.toMatchObject({ code: 'no-participants' });
    expect(f.update).not.toHaveBeenCalled();
});

test('immutable first guess retries survive closed/next round while unsubmitted stale guesses fail', async () => {
    const f = fixture();
    await firstReveal(f);
    await f.client.next('event', expected('r01', 3));
    expect(await f.client.submitGuess('event', 'r01', { lat: 50, lng: 60 })).toEqual({ status: 'already-submitted', guess: { lat: 0, lng: 0 } });
    f.identity.ensureUser.mockResolvedValue({ uid: 'missed' });
    await expect(f.client.submitGuess('event', 'r01', { lat: 0, lng: 0 })).rejects.toMatchObject({ code: 'stale-state' });
    await expect(f.client.submitGuess('event', 'r02', { lat: 0, lng: 0 })).rejects.toMatchObject({ code: 'invalid-phase' });
});

test('later reveal requires complete canonical previous results and preserves its artifact', async () => {
    const f = fixture();
    await firstReveal(f);
    const original = JSON.parse(JSON.stringify(f.values['public/rounds/r01/reveal']));
    await f.client.next('event', expected('r01', 3));
    await f.client.start('event', expected('r02', 4));
    await f.client.close('event', expected('r02', 5));
    f.values['public/rounds/r01/reveal'] = JSON.parse(JSON.stringify(original));
    delete f.values['public/rounds/r01/reveal'].results.missed;
    await expect(f.client.reveal('event', expected('r02', 6))).rejects.toMatchObject({ code: 'unavailable' });
    expect(f.values['public/rounds/r02/reveal']).toBeUndefined();
    f.values['public/rounds/r01/reveal'] = original;
    f.values['private/guesses/r02'] = { intruder: { lat: 0, lng: 0 } };
    await expect(f.client.reveal('event', expected('r02', 6))).rejects.toMatchObject({ code: 'unavailable' });
    f.values['private/guesses/r02'] = { guest: { lat: 0, lng: 0, points: 5000 } };
    await expect(f.client.reveal('event', expected('r02', 6))).rejects.toMatchObject({ code: 'unavailable' });
    expect(f.values['public/rounds/r01/reveal']).toEqual(original);
});

test('only the configured final round can complete and next never starts a clue', async () => {
    const f = fixture();
    await firstReveal(f);
    await expect(f.client.complete('event', expected('r01', 3))).rejects.toMatchObject({ code: 'invalid-phase' });
    await f.client.next('event', expected('r01', 3));
    await f.client.start('event', expected('r02', 4));
    await f.client.close('event', expected('r02', 5));
    await f.client.reveal('event', expected('r02', 6));
    await expect(f.client.next('event', expected('r02', 7))).rejects.toMatchObject({ code: 'invalid-phase' });
    await f.client.complete('event', expected('r02', 7));
    const calls = f.update.mock.calls.length;
    expect(await f.client.complete('event', expected('r02', 7))).toEqual({ status: 'already-completed' });
    await expect(f.client.complete('event', expected('r02', 3))).rejects.toMatchObject({ code: 'stale-state' });
    expect(f.update).toHaveBeenCalledTimes(calls);
});

test('deadlines remain optional, use absolute monotonic targets and reject stale rounds and expiry', async () => {
    const f = fixture();
    await f.client.start('event', expected('r01', 0));
    expect(await f.client.getTiming('event', 'r01')).toBeNull();
    const target = Date.now() + 60000;
    expect(await f.client.setDeadline('event', expected('r01', 1), target)).toEqual({ status: 'set', timing: { roundId: 'r01', deadlineMs: target } });
    const fresh = createSessionClient(f.database, f.identity);
    expect(await fresh.setDeadline('event', expected('r01', 1), target - 1000)).toEqual({ status: 'already-set', timing: { roundId: 'r01', deadlineMs: target } });
    f.values['public/rounds/r01/timing'] = { roundId: 'r01', deadlineMs: Date.now() - 1000 };
    await expect(f.client.submitGuess('event', 'r01', { lat: 0, lng: 0 })).rejects.toMatchObject({ code: 'deadline-expired' });
    expect(await f.client.setDeadline('event', expected('r01', 1), target + 30000)).toMatchObject({ status: 'set' });
    await f.client.close('event', expected('r01', 1));
    await expect(fresh.setDeadline('event', expected('r01', 1), target)).rejects.toMatchObject({ code: 'stale-state' });
    for (const value of [0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        await expect(fresh.setDeadline('event', expected('r01', 1), value)).rejects.toMatchObject({ code: 'invalid-deadline' });
    }
});

test('one-round event omits both setup links and reaches complete at revision four', async () => {
    const setup = { ...first }; delete setup.nextRoundId;
    const f = fixture({ 'public/roundCount': 1, 'private/rounds/r01': setup });
    await firstReveal(f);
    await f.client.complete('event', expected('r01', 3));
    expect(await f.client.getState('event')).toEqual({ phase: 'complete', roundId: 'r01', revision: 4, lastRevealedRoundId: 'r01' });
});

test('round twenty recurrence uses exactly the prior immutable totals including zero unanswered', async () => {
    const setup = { ...second, id: 'r20', previousRoundId: 'r19' };
    const f = fixture({ 'public/roundCount': 20, 'private/rounds/r20': setup,
        'public/state': { phase: 'closed', roundId: 'r20', revision: 78, lastRevealedRoundId: 'r19' },
        'public/rounds/r19/reveal': { roundId: 'r19', answer: { lat: 0, lng: 0 }, results: {
            guest: { nickname: 'Guest', answered: true, points: 5000, totalPoints: 95000, distance: 0 },
            missed: { nickname: 'Missed', answered: false, points: 0, totalPoints: 1234 },
        } }, 'private/guesses/r20': { guest: { lat: 0, lng: 0 } } });
    await f.client.reveal('event', expected('r20', 78));
    const result = (await f.client.getReveal('event', 'r20')).results;
    expect(result.guest.totalPoints).toBe(100000);
    expect(result.missed).toEqual({ nickname: 'Missed', answered: false, points: 0, totalPoints: 1234 });
    await f.client.complete('event', expected('r20', 79));
    expect((await f.client.getState('event')).revision).toBe(80);
    expect(f.reads.filter(path => /^public\/rounds\/r\d+\/reveal$/.test(path))).toEqual(['public/rounds/r19/reveal', 'public/rounds/r20/reveal']);
});

test.each([true, false])('shared raw acknowledgement barrier survives timeout, new adapters and deadline reads (accepted=%s)', async accepted => {
    jest.useFakeTimers();
    const f = fixture();
    const raw = deferred(); const queued = deferred();
    const target = Date.now() + 60000;
    try {
        await f.client.start('event', expected('r01', 0));
        f.update.mockImplementationOnce(changes => {
            Object.entries(changes).forEach(([path, value]) => { f.values[path.replace('events/event/', '')] = value; });
            queued.resolve();
            return raw.promise;
        });
        const write = f.client.setDeadline('event', expected('r01', 1), target);
        const timeout = expect(write).rejects.toMatchObject({ code: 'unavailable' });
        await queued.promise;
        await jest.advanceTimersByTimeAsync(15000);
        await timeout;
        const presenterIdentity = { ensureUser: jest.fn() };
        const fresh = createSessionClient(f.database, presenterIdentity);
        let settled = false;
        const read = Promise.all([fresh.getState('event'), fresh.getTiming('event', 'r01'), fresh.getClue('event', 'r01')])
            .then(result => { settled = true; return result; });
        await flush();
        expect(settled).toBe(false);
        expect(presenterIdentity.ensureUser).not.toHaveBeenCalled();
        if (accepted) raw.resolve();
        else {
            f.values['public/rounds/r01/timing'] = null;
            raw.reject(Object.assign(new Error('rejected'), { code: 'PERMISSION_DENIED' }));
        }
        expect(await read).toEqual([{ phase: 'guessing', roundId: 'r01', revision: 1 },
            accepted ? { roundId: 'r01', deadlineMs: target } : null, clue(first)]);
    } finally { jest.useRealTimers(); }
});

test('waiting for a previous ACK consumes the same 15 second command budget and never writes later', async () => {
    jest.useFakeTimers();
    const f = fixture(); const raw = deferred(); const queued = deferred();
    f.update.mockImplementationOnce(changes => {
        Object.entries(changes).forEach(([path, value]) => { f.values[path.replace('events/event/', '')] = value; });
        queued.resolve(); return raw.promise;
    });
    try {
        const start = f.client.start('event', expected('r01', 0));
        const startTimeout = expect(start).rejects.toMatchObject({ code: 'unavailable' });
        await queued.promise;
        const close = createSessionClient(f.database, f.identity).close('event', expected('r01', 1));
        const closeTimeout = expect(close).rejects.toMatchObject({ code: 'unavailable' });
        await jest.advanceTimersByTimeAsync(15000);
        await Promise.all([startTimeout, closeTimeout]);
        raw.resolve(); await flush();
        expect(f.update).toHaveBeenCalledTimes(1);
        expect(f.values['public/state'].phase).toBe('guessing');
    } finally { jest.useRealTimers(); }
});

test('permission-denied races confirm only a genuinely published original artifact', async () => {
    const f = fixture();
    f.update.mockImplementationOnce(async changes => {
        Object.entries(changes).forEach(([path, value]) => { f.values[path.replace('events/event/', '')] = value; });
        throw Object.assign(new Error('another host won'), { code: 'PERMISSION_DENIED' });
    });
    expect(await f.client.start('event', expected('r01', 0))).toEqual({ status: 'already-started' });
    const g = fixture();
    g.update.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'PERMISSION_DENIED' }));
    await expect(g.client.start('event', expected('r01', 0))).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
});

test('caller mutation while awaiting identity cannot change the command token or submitted guess', async () => {
    const f = fixture(); const restored = deferred();
    f.identity.ensureUser.mockReturnValueOnce(restored.promise);
    const token = expected('r01', 0);
    const start = f.client.start('event', token);
    token.roundId = 'r02'; token.revision = 4;
    restored.resolve({ uid: 'guest' }); await start;
    const restoreGuess = deferred();
    f.identity.ensureUser.mockReturnValueOnce(restoreGuess.promise);
    const coordinates = { lat: 1, lng: 2 };
    const submission = f.client.submitGuess('event', 'r01', coordinates);
    coordinates.lat = 90;
    restoreGuess.resolve({ uid: 'guest' });
    expect(await submission).toEqual({ status: 'submitted', guess: { lat: 1, lng: 2 } });
});
