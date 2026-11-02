import { createSessionClient } from '../../../src/event/session';

const first = { id: 'r01', panoramaId: 'first-exact', heading: 20, pitch: -5, answer: { lat: 0, lng: 0 }, difficulty: 2000, nextRoundId: 'r02' };
const second = { ...first, id: 'r02', panoramaId: 'second-exact', previousRoundId: 'r01' };
delete second.nextRoundId;
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
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
function observedFixture(initial = {}, initialMeta = {}) {
    const f = fixture(initial);
    const originalRef = f.database.ref;
    const metadata = { '.info/connected': true, '.info/serverTimeOffset': 0, ...initialMeta };
    const callbacks = new Map();
    const refs = new Map();
    const valueAt = path => path.startsWith('.info/') ? metadata[path] : f.values[path.replace('events/event/', '')];
    f.emit = (path, value) => {
        if (path.startsWith('.info/')) metadata[path] = value;
        else f.values[path.replace('events/event/', '')] = value;
        (callbacks.get(path) || []).slice().forEach(callback => callback({ val: () => value }));
    };
    f.database.ref = jest.fn(path => {
        if (path === undefined) return originalRef(path);
        if (!refs.has(path)) refs.set(path, {
            once: jest.fn(async () => ({ val: () => valueAt(path) ?? null })),
            on: jest.fn((event, callback) => {
                callbacks.set(path, [...(callbacks.get(path) || []), callback]);
                callback({ val: () => valueAt(path) ?? null });
            }),
            off: jest.fn((event, callback) => callbacks.set(path, (callbacks.get(path) || []).filter(item => item !== callback))),
        });
        return refs.get(path);
    });
    f.refs = refs;
    return f;
}
const flushObserver = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };

test('public timing observer waits for explicit snapshots, never authenticates and disposes exact callbacks', async () => {
    const f = observedFixture({}, { '.info/serverTimeOffset': null });
    const changes = jest.fn(); const errors = jest.fn();
    const stop = f.client.subscribeTiming('event', 'r01', changes, errors);
    await flushObserver();
    expect(changes.mock.calls.every(([state]) => state.connected === false)).toBe(true);
    f.emit('.info/serverTimeOffset', 1500);
    await flushObserver();
    expect(changes).toHaveBeenLastCalledWith({ timing: null, offsetMs: 1500, connected: true });
    expect(f.identity.ensureUser).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    stop(); stop();
    expect(Array.from(f.refs.values()).filter(reference => reference.on.mock.calls.length).every(reference => reference.off.mock.calls.length === 1)).toBe(true);
    const count = changes.mock.calls.length;
    f.emit('events/event/public/rounds/r01/timing', { roundId: 'r01', deadlineMs: 12345 });
    await flushObserver();
    expect(changes).toHaveBeenCalledTimes(count);
});

test('timing observer preserves confirmed value while disconnected and recovers on reconnect', async () => {
    const f = observedFixture({ 'public/rounds/r01/timing': { roundId: 'r01', deadlineMs: 12345 } });
    const changes = jest.fn(); const errors = jest.fn();
    const stop = f.client.subscribeTiming('event', 'r01', changes, errors);
    await flushObserver();
    f.emit('.info/connected', false);
    expect(changes).toHaveBeenLastCalledWith({ timing: { roundId: 'r01', deadlineMs: 12345 }, offsetMs: 0, connected: false });
    f.emit('events/event/public/rounds/r01/timing', { roundId: 'r01', deadlineMs: 20000 });
    await flushObserver();
    expect(changes.mock.calls.some(([state]) => state.connected && state.timing?.deadlineMs === 20000)).toBe(false);
    f.emit('.info/connected', true);
    await flushObserver();
    expect(changes).toHaveBeenLastCalledWith({ timing: { roundId: 'r01', deadlineMs: 20000 }, offsetMs: 0, connected: true });
    stop();
});

test('timing observer fails closed on malformed timing and safely isolates consumer exceptions', async () => {
    const f = observedFixture({ 'public/rounds/r01/timing': { roundId: 'r02', deadlineMs: 12345 } });
    const errors = jest.fn(); const changes = jest.fn(() => { throw new Error('consumer failure'); });
    const stop = f.client.subscribeTiming('event', 'r01', changes, errors);
    await flushObserver();
    expect(errors).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledWith(expect.objectContaining({ code: 'unavailable' }));
    expect(changes.mock.calls.some(([state]) => state.connected)).toBe(false);
    f.emit('events/event/public/rounds/r01/timing', null);
    await flushObserver();
    expect(errors).toHaveBeenCalledTimes(1);
    expect(changes.mock.calls.some(([state]) => state.connected)).toBe(true);
    stop();
});

test('synchronous subscription cancellation stops registration and exact listener cleanup', () => {
    const f = observedFixture();
    const reference = f.database.ref('.info/connected');
    reference.on.mockImplementation((event, callback, cancel) => cancel(new Error('private provider failure')));
    const errors = jest.fn();
    const stop = f.client.subscribeTiming('event', 'r01', jest.fn(), errors);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(errors.mock.calls[0][0].message).toBe('unavailable');
    expect(reference.off).toHaveBeenCalledTimes(2);
    expect(f.refs.size).toBe(1);
    stop();
    expect(reference.off).toHaveBeenCalledTimes(2);
});

test('timing cancellation detaches a listener installed after the synchronous cancel callback', () => {
    const f = observedFixture();
    const reference = f.database.ref('.info/connected');
    const registered = new Set();
    reference.on.mockImplementation((event, callback, cancel) => {
        cancel(new Error('provider cancellation'));
        registered.add(callback);
    });
    reference.off.mockImplementation((event, callback) => registered.delete(callback));
    const changes = jest.fn(); const errors = jest.fn();
    const stop = f.client.subscribeTiming('event', 'r01', changes, errors);
    expect(registered.size).toBe(0);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(reference.off.mock.calls[0][1]).toBe(reference.off.mock.calls[1][1]);
    expect(f.refs.size).toBe(1);
    stop();
    expect(registered.size).toBe(0);
});

test.each([true, false])('timing observer suppresses optimistic writes until accepted/rejected ACK (accepted=%s)', async accepted => {
    jest.useFakeTimers();
    const f = observedFixture({ 'public/state': { phase: 'guessing', roundId: 'r01', revision: 1 } });
    const raw = deferred(); const queued = deferred();
    const currentRef = f.database.ref;
    f.database.ref = jest.fn(path => path === undefined ? { update(changes) {
        Object.entries(changes).forEach(([key, value]) => f.emit(key, value));
        queued.resolve();
        return raw.promise;
    } } : currentRef(path));
    const changes = jest.fn(); const errors = jest.fn();
    const stop = f.client.subscribeTiming('event', 'r01', changes, errors);
    try {
        await flushObserver();
        const target = Date.now() + 60000;
        const write = f.client.setDeadline('event', { roundId: 'r01', revision: 1 }, target);
        const timeout = expect(write).rejects.toMatchObject({ code: 'unavailable' });
        await queued.promise;
        await flushObserver();
        expect(changes.mock.calls.some(([state]) => state.connected && state.timing?.deadlineMs === target)).toBe(false);
        await jest.advanceTimersByTimeAsync(15000);
        await timeout;
        expect(errors).toHaveBeenCalledWith(expect.objectContaining({ code: 'unavailable' }));
        if (accepted) raw.resolve();
        else {
            f.emit('events/event/public/rounds/r01/timing', null);
            raw.reject(Object.assign(new Error('denied'), { code: 'PERMISSION_DENIED' }));
        }
        await flushObserver();
        expect(changes).toHaveBeenLastCalledWith({ timing: accepted ? { roundId: 'r01', deadlineMs: target } : null, offsetMs: 0, connected: true });
        if (!accepted) expect(changes.mock.calls.some(([state]) => state.connected && state.timing?.deadlineMs === target)).toBe(false);
    } finally { stop(); jest.useRealTimers(); }
});

test('stopping the timing observer invalidates an outstanding timing read', async () => {
    const f = observedFixture();
    const pendingRead = deferred();
    f.database.ref('events/event/public/rounds/r01/timing').once.mockReturnValue(pendingRead.promise);
    const changes = jest.fn();
    const stop = f.client.subscribeTiming('event', 'r01', changes);
    await flushObserver();
    stop();
    const count = changes.mock.calls.length;
    pendingRead.resolve({ val: () => ({ roundId: 'r01', deadlineMs: 9000 }) });
    await flushObserver();
    expect(changes).toHaveBeenCalledTimes(count);
});

test.each([undefined, 'r1', 'r00', 'r21', '../r01'])('timing rejects malformed round %p before subscriptions', roundId => {
    const f = observedFixture();
    expect(() => f.client.subscribeTiming('event', roundId, jest.fn())).toThrow('invalid-round-id');
    expect(f.database.ref).not.toHaveBeenCalled();
});

test('timing observes exactly the requested configured round and validates its identity', async () => {
    const f = observedFixture({ 'public/rounds/r02/timing': { roundId: 'r02', deadlineMs: 12345 } });
    const changes = jest.fn(); const errors = jest.fn();
    const stop = f.client.subscribeTiming('event', 'r02', changes, errors);
    await flushObserver();
    expect(changes).toHaveBeenLastCalledWith({ timing: { roundId: 'r02', deadlineMs: 12345 }, offsetMs: 0, connected: true });
    expect(f.database.ref.mock.calls.some(([path]) => path?.includes('/r01/'))).toBe(false);
    expect(f.database.ref.mock.calls.some(([path]) => path?.includes('/private/'))).toBe(false);
    f.emit('events/event/public/rounds/r02/timing', { roundId: 'r01', deadlineMs: 12345 });
    await flushObserver();
    expect(errors).toHaveBeenCalledWith(expect.objectContaining({ code: 'unavailable' }));
    stop();
});

test('timing rejects an unconfigured round and releases all exact observers', async () => {
    const f = observedFixture(); const errors = jest.fn(); const changes = jest.fn();
    f.client.subscribeTiming('event', 'r20', changes, errors);
    await flushObserver();
    expect(errors).toHaveBeenCalledWith(expect.objectContaining({ code: 'invalid-round-id' }));
    expect(changes.mock.calls.every(([value]) => !value.connected)).toBe(true);
    expect(Array.from(f.refs.values()).filter(reference => reference.on.mock.calls.length).every(reference => reference.off.mock.calls.length === 1)).toBe(true);
});
