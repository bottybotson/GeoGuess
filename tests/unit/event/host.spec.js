import { createHostClient } from '@/event/host';
import { createRoundClient } from '@/event/round';
import { createLobbyClient } from '@/event/lobby';

jest.mock('@/event/round', () => ({ createRoundClient: jest.fn() }));
jest.mock('@/event/lobby', () => ({ createLobbyClient: jest.fn() }));

const authFixture = () => ({
    onAuthStateChanged: jest.fn(next => { next(null); return jest.fn(); }),
    setPersistence: jest.fn().mockResolvedValue(),
    signInWithEmailAndPassword: jest.fn().mockResolvedValue({ user: { uid: 'host' } }),
    signOut: jest.fn().mockResolvedValue(),
});
beforeEach(() => {
    jest.clearAllMocks();
    createRoundClient.mockReturnValue({});
    createLobbyClient.mockReturnValue({ subscribe: jest.fn() });
});

describe('separate organizer identity', () => {
    it('restores a signed-out host without creating a guest and disposes synchronous callbacks', async () => {
        const auth = authFixture();
        const stop = jest.fn();
        auth.onAuthStateChanged.mockImplementation(next => { next(null); return stop; });
        const client = createHostClient({}, auth);
        await expect(client.restore()).resolves.toBeNull();
        expect(stop).toHaveBeenCalledTimes(1);
        expect(auth.setPersistence).not.toHaveBeenCalled();
        const identity = createRoundClient.mock.calls[0][1];
        await expect(identity.ensureUser()).rejects.toMatchObject({ code: 'unauthenticated' });
    });

    it('coalesces initial restoration and preserves the actual user', async () => {
        const auth = authFixture();
        let next;
        const stop = jest.fn();
        auth.onAuthStateChanged.mockImplementation(callback => { next = callback; return stop; });
        const client = createHostClient({}, auth);
        const first = client.restore();
        const second = client.restore();
        expect(second).toBe(first);
        const user = { uid: 'actual-host' };
        next(user);
        await expect(first).resolves.toBe(user);
        expect(stop).toHaveBeenCalledTimes(1);
    });

    it('sets only host-local persistence, trims email and preserves password bytes', async () => {
        const auth = authFixture();
        const client = createHostClient({}, auth);
        await expect(client.signIn(' host@example.test ', ' exact password ')).resolves.toEqual({ uid: 'host' });
        expect(auth.setPersistence).toHaveBeenCalledWith('local');
        expect(auth.signInWithEmailAndPassword).toHaveBeenCalledWith('host@example.test', ' exact password ');
        await client.signOut();
        expect(auth.signOut).toHaveBeenCalledTimes(1);
    });

    it('propagates auth failures and permits a later restoration attempt', async () => {
        const auth = authFixture();
        const failure = new Error('auth failed');
        auth.onAuthStateChanged.mockImplementationOnce((next, error) => { error(failure); return jest.fn(); });
        const client = createHostClient({}, auth);
        await expect(client.restore()).rejects.toBe(failure);
        await expect(client.restore()).resolves.toBeNull();
        auth.signInWithEmailAndPassword.mockRejectedValueOnce(failure);
        await expect(client.signIn('host@example.test', 'password')).rejects.toBe(failure);
    });
});


test('host guards legacy commands and exposes explicit v2 session without replacing its identity', async () => {
    const methods = Object.fromEntries(['subscribeTiming', 'setDeadline', 'getTiming', 'getServerTime'].map(name => [name, jest.fn()]));
    createRoundClient.mockReturnValue(methods);
    const once = jest.fn().mockResolvedValue({ val: () => null });
    const client = createHostClient({ ref: () => ({ once }) }, authFixture());
    await client.setDeadline('party', 123);
    expect(methods.setDeadline).toHaveBeenCalledWith('party', 123);
    expect(client.session.next).toEqual(expect.any(Function));
    await expect(client.session.next('party')).rejects.toMatchObject({ code: 'invalid-expected-state' });
    once.mockResolvedValue({ val: () => 2 });
    await expect(client.setDeadline('party', 123)).rejects.toMatchObject({ code: 'unsupported-format' });
    expect(methods.setDeadline).toHaveBeenCalledTimes(1);
});

test('host inspects formatVersion without restoring organizer identity or signing in', async () => {
    const auth = authFixture();
    const once = jest.fn().mockResolvedValue({ val: () => 2 });
    const ref = jest.fn(() => ({ once }));
    const client = createHostClient({ ref }, auth);
    await expect(client.getFormatVersion('party')).resolves.toBe(2);
    expect(ref).toHaveBeenCalledWith('events/party/public/formatVersion');
    expect(auth.onAuthStateChanged).not.toHaveBeenCalled();
    expect(auth.signInWithEmailAndPassword).not.toHaveBeenCalled();
});

test('continuous host Auth observer reports sign-out and account switches until disposed', () => {
    const auth = authFixture(); let next; let failed;
    const released = jest.fn();
    auth.onAuthStateChanged.mockImplementation((receive, error) => { next = receive; failed = error; receive(null); return released; });
    const client = createHostClient({}, auth); const changes = jest.fn(); const errors = jest.fn();
    const stop = client.subscribeAuth(changes, errors);
    expect(changes).toHaveBeenLastCalledWith(null);
    next({ uid: 'organizer-a' }); next({ uid: 'organizer-b' }); next(null);
    expect(changes.mock.calls.map(([user]) => user && user.uid)).toEqual([null, 'organizer-a', 'organizer-b', null]);
    expect(released).not.toHaveBeenCalled();
    stop(); stop(); next({ uid: 'stale-host' }); failed(new Error('stale failure'));
    expect(changes).toHaveBeenCalledTimes(4);
    expect(errors).not.toHaveBeenCalled();
    expect(released).toHaveBeenCalledTimes(1);
    expect(auth.setPersistence).not.toHaveBeenCalled();
    expect(auth.signInWithEmailAndPassword).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
});

test('host Auth observation invalidates callbacks before cleanup and survives independent restore', async () => {
    const auth = authFixture(); let next; let failed;
    const changes = jest.fn(); const errors = jest.fn();
    const released = jest.fn(() => next({ uid: 'released-stale' }));
    auth.onAuthStateChanged.mockImplementationOnce((receive, error) => { next = receive; failed = error; return released; });
    const client = createHostClient({}, auth);
    const stop = client.subscribeAuth(changes, errors);
    await expect(client.restore()).resolves.toBeNull();
    next({ uid: 'continuous-host' });
    expect(changes).toHaveBeenLastCalledWith({ uid: 'continuous-host' });
    const failure = new Error('Auth observer failed');
    failed(failure); stop();
    expect(changes).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledWith(failure);
    expect(released).toHaveBeenCalledTimes(1);
});

test('host Auth observer releases a subscription returned after synchronous provider failure', () => {
    const auth = authFixture(); const released = jest.fn(); const failure = new Error('Auth observer failed');
    let next;
    auth.onAuthStateChanged.mockImplementation((receive, failed) => { next = receive; failed(failure); return released; });
    const changes = jest.fn(); const errors = jest.fn();
    const stop = createHostClient({}, auth).subscribeAuth(changes, errors);
    expect(errors).toHaveBeenCalledWith(failure);
    expect(released).toHaveBeenCalledTimes(1);
    next({ uid: 'late-host' }); stop();
    expect(changes).not.toHaveBeenCalled();
    expect(released).toHaveBeenCalledTimes(1);
});

test('host Auth observer reports a registration exception and permits a later subscription', () => {
    const auth = authFixture(); const failure = new Error('Auth unavailable');
    auth.onAuthStateChanged.mockImplementationOnce(() => { throw failure; });
    const client = createHostClient({}, auth); const errors = jest.fn();
    const stopFailed = client.subscribeAuth(jest.fn(), errors);
    expect(errors).toHaveBeenCalledWith(failure);
    stopFailed();
    const changes = jest.fn(); const stop = client.subscribeAuth(changes);
    expect(changes).toHaveBeenCalledWith(null);
    stop();
});

test.each(['change', 'error'])('throwing consumer %s cannot interrupt synchronous Auth registration or cleanup', delivery => {
    const auth = authFixture(); const active = new Set(); const released = jest.fn();
    auth.onAuthStateChanged.mockImplementation((next, error) => {
        active.add(next);
        if (delivery === 'change') next(null);
        else error(new Error('provider failure'));
        return () => { released(); active.delete(next); };
    });
    const changes = jest.fn(() => { throw new Error('consumer change'); });
    const errors = jest.fn(() => { throw new Error('consumer error'); });
    const stop = createHostClient({}, auth).subscribeAuth(changes, errors);
    if (delivery === 'change') {
        expect(active.size).toBe(1);
        expect(errors).not.toHaveBeenCalled();
    } else expect(active.size).toBe(0);
    stop(); stop();
    expect(active.size).toBe(0);
    expect(released).toHaveBeenCalledTimes(1);
});
