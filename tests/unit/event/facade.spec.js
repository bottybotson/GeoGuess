import { createVersionedLobbyClient, createVersionedSessionClient, createPresenterClient } from '@/event/facade';
import { getFormatVersion, legacyClient } from '@/event/version';

const base = 'events/party/public';
const snap = value => ({ val: () => value });
const state = (phase = 'lobby', roundId = 'r01', revision = 0, lastRevealedRoundId) =>
    ({ phase, roundId, revision, ...(lastRevealedRoundId ? { lastRevealedRoundId } : {}) });
const flush = async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve(); };
function fixture(initial = {}) {
    const data = { [`${base}/formatVersion`]: 2, [`${base}/roundCount`]: 2, [`${base}/state`]: state(), ...initial };
    const listeners = [];
    const once = jest.fn(path => Promise.resolve(snap(Object.prototype.hasOwnProperty.call(data, path) ? data[path] : null)));
    const off = jest.fn();
    const update = jest.fn(changes => { Object.assign(data, changes); return Promise.resolve(); });
    const database = { ref: jest.fn(path => ({
        once: () => once(path), update,
        on: (event, handler, cancel) => { listeners.push({ path, handler, cancel }); },
        off: (event, handler) => off(path, handler),
    })) };
    const emit = (path, value) => listeners.filter(listener => listener.path === path).forEach(listener => listener.handler(snap(value)));
    const identity = { ensureGuest: jest.fn().mockResolvedValue({ uid: 'guest' }), ensureUser: jest.fn().mockResolvedValue({ uid: 'host' }) };
    return { data, listeners, once, off, update, database, emit, identity };
}

test.each([undefined, 1, '2', 3, false, {}, []])('unknown/malformed version %p fails before identity, membership or private access', async version => {
    const f = fixture({ [`${base}/formatVersion`]: version });
    const lobby = createVersionedLobbyClient(f.database, f.identity);
    await expect(lobby.join('party', 'Guest')).rejects.toMatchObject({ code: 'unsupported-format' });
    expect(f.identity.ensureGuest).not.toHaveBeenCalled();
    expect(f.once.mock.calls).toEqual([[`${base}/formatVersion`]]);
    expect(f.update).not.toHaveBeenCalled();
});

test.each([null, 2])('dispatch reads only version leaf for supported %p', async version => {
    const f = fixture({ [`${base}/formatVersion`]: version });
    await expect(getFormatVersion(f.database, 'party')).resolves.toBe(version === null ? 1 : 2);
    expect(f.once.mock.calls).toEqual([[`${base}/formatVersion`]]);
    expect(f.identity.ensureGuest).not.toHaveBeenCalled();
});

test('v2 initial admission makes exactly reciprocal stable claims and no v1 phase read', async () => {
    const f = fixture();
    await expect(createVersionedLobbyClient(f.database, f.identity).join('party', ' Guest ')).resolves.toEqual({
        status: 'joined', participant: { id: 'guest', nickname: 'Guest' },
    });
    expect(f.update).toHaveBeenCalledWith({ [`${base}/participants/guest`]: { slot: 's01', nickname: 'Guest' }, [`${base}/slots/s01`]: 'guest' });
    expect(f.once.mock.calls.some(([path]) => path === `${base}/phase`)).toBe(false);
});

test.each([
    state('ready', 'r02', 4, 'r01'), state('guessing', 'r02', 5, 'r01'), state('closed', 'r02', 6, 'r01'),
    state('reveal', 'r02', 7, 'r02'), state('complete', 'r02', 8, 'r02'),
])('v2 rejoin retains membership at %p and newcomer cannot claim', async current => {
    const f = fixture({ [`${base}/state`]: current, [`${base}/participants/guest`]: { nickname: 'Original', slot: 's50' } });
    const lobby = createVersionedLobbyClient(f.database, f.identity);
    await expect(lobby.join('party', null)).resolves.toMatchObject({ status: 'rejoined', participant: { nickname: 'Original' } });
    f.data[`${base}/participants/guest`] = null;
    await expect(lobby.join('party', 'New')).resolves.toEqual({ status: 'started' });
    expect(f.update).not.toHaveBeenCalled();
});

test('v1 dispatch preserves legacy join behavior', async () => {
    const f = fixture({ [`${base}/formatVersion`]: null, [`${base}/phase`]: 'lobby' });
    await expect(createVersionedLobbyClient(f.database, f.identity).join('party', 'Name')).resolves.toMatchObject({ status: 'joined' });
    expect(f.once.mock.calls).toContainEqual([`${base}/phase`]);
    expect(f.once.mock.calls).not.toContainEqual([`${base}/state`]);
});

test('presenter has no mutators, identity, ancestor or private reads; projection derives atomic v2 state', () => {
    const f = fixture();
    const presenter = createPresenterClient(f.database);
    expect(Object.keys(presenter.lobby).sort()).toEqual(['getFormatVersion', 'subscribe']);
    expect(Object.keys(presenter.session).sort()).toEqual(['getClue', 'getReveal', 'getServerTime', 'getState', 'getTiming', 'subscribeState', 'subscribeTiming']);
    expect(Object.keys(presenter.round).sort()).toEqual(['getReveal', 'getServerTime', 'getTiming', 'subscribeTiming']);
    const changed = jest.fn();
    const stop = presenter.lobby.subscribe('party', changed);
    f.emit(`${base}/formatVersion`, 2);
    f.emit(`${base}/title`, 'Birthday');
    f.emit(`${base}/state`, state('ready', 'r02', 4, 'r01'));
    f.emit(`${base}/roundCount`, 2);
    f.emit(`${base}/participants`, { guest: { nickname: 'Guest', slot: 's01' } });
    expect(changed).toHaveBeenLastCalledWith({ title: 'Birthday', formatVersion: 2, phase: 'ready', roundId: 'r02', revision: 4,
        lastRevealedRoundId: 'r01', roundCount: 2, participants: [{ id: 'guest', nickname: 'Guest' }] });
    expect(f.database.ref.mock.calls.every(([path]) => path.startsWith(`${base}/`))).toBe(true);
    expect(f.identity.ensureGuest).not.toHaveBeenCalled();
    stop();
    const count = changed.mock.calls.length;
    f.emit(`${base}/state`, state('guessing', 'r02', 5, 'r01'));
    expect(changed).toHaveBeenCalledTimes(count);
    expect(f.off).toHaveBeenCalledTimes(5);
});

test('version rebinding and disposal suppress stale callbacks from prior protocol and event', () => {
    const f = fixture();
    const changed = jest.fn();
    const error = jest.fn();
    const lobby = createVersionedLobbyClient(f.database, f.identity);
    const stop = lobby.subscribe('party', changed, error);
    f.emit(`${base}/formatVersion`, null);
    f.emit(`${base}/title`, 'Old'); f.emit(`${base}/phase`, 'lobby'); f.emit(`${base}/participants`, null);
    expect(changed).toHaveBeenLastCalledWith({ title: 'Old', phase: 'lobby', participants: [] });
    f.emit(`${base}/formatVersion`, 2);
    const calls = changed.mock.calls.length;
    f.emit(`${base}/phase`, 'complete');
    expect(changed).toHaveBeenCalledTimes(calls);
    f.emit(`${base}/title`, 'New'); f.emit(`${base}/state`, state()); f.emit(`${base}/roundCount`, 2); f.emit(`${base}/participants`, null);
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'New', formatVersion: 2, revision: 0 }));
    stop();
    const count = changed.mock.calls.length;
    f.emit(`${base}/formatVersion`, null); f.emit(`${base}/phase`, 'complete');
    expect(changed).toHaveBeenCalledTimes(count);
    expect(error).not.toHaveBeenCalled();
});

test('unknown version terminates and releases old public subscriptions exactly once', () => {
    const f = fixture();
    const changed = jest.fn(); const error = jest.fn();
    createPresenterClient(f.database).lobby.subscribe('party', changed, error);
    f.emit(`${base}/formatVersion`, 2);
    f.emit(`${base}/formatVersion`, '2');
    f.emit(`${base}/formatVersion`, 2);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ code: 'unsupported-format' }));
    expect(f.off).toHaveBeenCalledTimes(5);
    expect(changed).not.toHaveBeenCalled();
});

test('session subscription validates one atomic state and rejects malformed revision without identity', () => {
    const f = fixture(); const changed = jest.fn(); const error = jest.fn();
    createPresenterClient(f.database).session.subscribeState('party', changed, error);
    f.emit(`${base}/formatVersion`, 2); f.emit(`${base}/roundCount`, 2); f.emit(`${base}/state`, state());
    expect(changed).toHaveBeenLastCalledWith({ ...state(), roundCount: 2 });
    f.emit(`${base}/state`, state('ready', 'r02', 500, 'r01'));
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ code: 'unavailable' }));
    f.emit(`${base}/state`, state());
    expect(changed).toHaveBeenCalledTimes(1);
    expect(f.off).toHaveBeenCalledTimes(3);
});

test('session public reads require no identity and host commands retain caller expected state', async () => {
    const f = fixture({ [`${base}/state`]: state('guessing', 'r02', 5, 'r01') });
    const session = createVersionedSessionClient(f.database, f.identity);
    await expect(session.getState('party')).resolves.toEqual(state('guessing', 'r02', 5, 'r01'));
    expect(f.identity.ensureUser).not.toHaveBeenCalled();
    await expect(session.close('party')).rejects.toMatchObject({ code: 'invalid-expected-state' });
    await expect(session.close('party', { roundId: 'r01', revision: 1 })).rejects.toMatchObject({ code: 'stale-state' });
    expect(f.once.mock.calls.some(([path]) => path.includes('/private/'))).toBe(false);
    expect(f.update).not.toHaveBeenCalled();
});

test('legacy guard retains v1 calls and denies all v2/unknown commands without auth or write', async () => {
    const f = fixture({ [`${base}/formatVersion`]: null });
    const raw = { start: jest.fn().mockResolvedValue({ status: 'started' }), submitGuess: jest.fn() };
    const legacy = legacyClient(f.database, raw);
    await expect(legacy.start('party')).resolves.toEqual({ status: 'started' });
    f.data[`${base}/formatVersion`] = 2;
    await expect(legacy.start('party')).rejects.toMatchObject({ code: 'unsupported-format' });
    await expect(legacy.submitGuess('party', 'r1', {})).rejects.toMatchObject({ code: 'unsupported-format' });
    expect(raw.start).toHaveBeenCalledTimes(1); expect(raw.submitGuess).not.toHaveBeenCalled();
});

test('version-read timeout and invalid event reject without acquiring identity', async () => {
    jest.useFakeTimers();
    try {
        const f = fixture(); f.once.mockReturnValue(new Promise(() => {}));
        const lobby = createVersionedLobbyClient(f.database, f.identity);
        await expect(lobby.join('bad/path', 'Name')).rejects.toMatchObject({ code: 'invalid-event-id' });
        const request = lobby.join('party', 'Name');
        const rejected = expect(request).rejects.toMatchObject({ code: 'unavailable' });
        await flush(); jest.advanceTimersByTime(15000); await rejected;
        expect(f.identity.ensureGuest).not.toHaveBeenCalled();
    } finally { jest.useRealTimers(); }
});

test('partial state-subscription registration releases installed observers on ref failure', () => {
    const f = fixture(); const error = jest.fn();
    const original = f.database.ref.getMockImplementation();
    f.database.ref.mockImplementation(path => {
        if (path === `${base}/roundCount`) throw new Error('reference unavailable');
        return original(path);
    });
    createPresenterClient(f.database).session.subscribeState('party', jest.fn(), error);
    f.emit(`${base}/formatVersion`, 2);
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: 'reference unavailable' }));
    expect(f.off.mock.calls.map(([path]) => path).sort()).toEqual([`${base}/formatVersion`, `${base}/state`].sort());
});

test('synchronous cancellation followed by provider registration is detached again', () => {
    const active = new Set(); const failure = new Error('cancelled'); const error = jest.fn();
    const database = { ref: path => ({
        on: (event, handler, cancel) => {
            if (path.endsWith('/formatVersion')) handler(snap(2));
            else cancel(failure);
            active.add(handler);
        },
        off: (event, handler) => active.delete(handler),
    }) };
    createPresenterClient(database).session.subscribeState('party', jest.fn(), error);
    expect(error).toHaveBeenCalledWith(failure);
    expect(active.size).toBe(0);
});

test('array phase fails closed in both v2 lobby and state subscriptions', () => {
    const f = fixture(); const lobbyChanged = jest.fn(); const stateError = jest.fn();
    const presenter = createPresenterClient(f.database);
    const stopLobby = presenter.lobby.subscribe('party', lobbyChanged);
    const stopState = presenter.session.subscribeState('party', jest.fn(), stateError);
    f.emit(`${base}/formatVersion`, 2);
    f.emit(`${base}/title`, 'Birthday'); f.emit(`${base}/roundCount`, 2); f.emit(`${base}/participants`, null);
    f.emit(`${base}/state`, { phase: ['lobby'], roundId: 'r01', revision: 0 });
    expect(lobbyChanged).toHaveBeenLastCalledWith({ title: 'Birthday', phase: 'unavailable', participants: [] });
    expect(stateError).toHaveBeenCalledWith(expect.objectContaining({ code: 'unavailable' }));
    stopLobby(); stopState();
});

test('presenter legacy public round rejects v2 and never exposes private or mutating methods', async () => {
    const f = fixture(); const presenter = createPresenterClient(f.database);
    await expect(presenter.round.getReveal('party')).rejects.toMatchObject({ code: 'unsupported-format' });
    expect(f.once.mock.calls).toEqual([[`${base}/formatVersion`]]);
    expect(f.identity.ensureUser).not.toHaveBeenCalled();
});

test('versioned timing is public, explicitly scoped, and drops stale callbacks on disposal or version change', async () => {
    const f = fixture(); const changes = jest.fn(); const errors = jest.fn();
    const emit = (path, value) => { f.data[path] = value; f.emit(path, value); };
    const stop = createPresenterClient(f.database).session.subscribeTiming('party', 'r02', changes, errors);
    emit(`${base}/formatVersion`, 2);
    emit('.info/connected', true); emit('.info/serverTimeOffset', 10);
    emit(`${base}/rounds/r02/timing`, { roundId: 'r02', deadlineMs: 12345 });
    await flush();
    expect(changes).toHaveBeenLastCalledWith({ timing: { roundId: 'r02', deadlineMs: 12345 }, connected: true, offsetMs: 10 });
    expect(f.identity.ensureUser).not.toHaveBeenCalled();
    expect(f.once.mock.calls.some(([path]) => path.includes('/private/'))).toBe(false);
    expect(f.once.mock.calls.some(([path]) => path.includes('/r01/'))).toBe(false);
    emit(`${base}/formatVersion`, null);
    expect(errors).toHaveBeenCalledWith(expect.objectContaining({ code: 'unsupported-format' }));
    const count = changes.mock.calls.length;
    emit('.info/connected', false); emit(`${base}/rounds/r02/timing`, null);
    await flush(); stop();
    expect(changes).toHaveBeenCalledTimes(count);
    expect(f.off).toHaveBeenCalledTimes(4);
});

test('synchronous timing cancellation detaches registrations completed after cancellation', () => {
    const active = new Set(); const errors = jest.fn();
    const database = { ref: path => ({
        on: (event, handler, cancel) => {
            if (path.endsWith('/formatVersion')) handler(snap(2));
            else cancel(new Error('provider failure'));
            active.add(handler);
        },
        off: (event, handler) => active.delete(handler),
    }) };
    createPresenterClient(database).session.subscribeTiming('party', 'r01', jest.fn(), errors);
    expect(errors).toHaveBeenCalledWith(expect.objectContaining({ code: 'unavailable' }));
    expect(active.size).toBe(0);
});
