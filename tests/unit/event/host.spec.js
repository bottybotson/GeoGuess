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
