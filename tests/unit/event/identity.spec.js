import { createGuestIdentity } from '@/event/identity';

const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
};

const makeAuth = (overrides = {}) => {
    const listeners = [];
    const auth = {
        listeners,
        onAuthStateChanged: jest.fn(next => {
            const listener = { next, unsubscribe: jest.fn() };
            listeners.push(listener);
            return listener.unsubscribe;
        }),
        setPersistence: jest.fn(() => Promise.resolve()),
        signInAnonymously: jest.fn(() => Promise.resolve({ user: { uid: 'anonymous_user' } })),
        ...overrides,
    };
    return auth;
};

describe('guest identity adapter', () => {
    it('waits for delayed auth restoration before deciding to sign in anonymously', async () => {
        const restoration = deferred();
        const auth = makeAuth({
            onAuthStateChanged: jest.fn(next => {
                const listener = { next, unsubscribe: jest.fn() };
                auth.listeners.push(listener);
                restoration.promise.then(() => listener.next(null));
                return listener.unsubscribe;
            }),
        });
        const identity = createGuestIdentity(auth);
        const result = identity.ensureGuest();

        expect(auth.setPersistence).not.toHaveBeenCalled();
        expect(auth.signInAnonymously).not.toHaveBeenCalled();
        restoration.resolve(null);
        await result;

        expect(auth.listeners[0].unsubscribe).toHaveBeenCalledTimes(1);
        expect(auth.setPersistence).toHaveBeenCalledWith('local');
        expect(auth.signInAnonymously).toHaveBeenCalledTimes(1);
    });

    it('reuses a restored user, including a separately signed-in organizer', async () => {
        const organizer = { uid: 'organizer_account', role: 'organizer' };
        const auth = makeAuth({
            onAuthStateChanged: jest.fn(next => {
                const listener = { next, unsubscribe: jest.fn() };
                auth.listeners.push(listener);
                return listener.unsubscribe;
            }),
        });
        const identity = createGuestIdentity(auth);
        const result = identity.ensureGuest();

        auth.listeners[0].next(organizer);

        await expect(result).resolves.toBe(organizer);
        expect(auth.listeners[0].unsubscribe).toHaveBeenCalledTimes(1);
        expect(auth.setPersistence).not.toHaveBeenCalled();
        expect(auth.signInAnonymously).not.toHaveBeenCalled();
    });

    it('uses local persistence before anonymous sign-in and returns Firebase user', async () => {
        const actualUser = { uid: 'firebase_assigned_uid' };
        const order = [];
        const auth = makeAuth({
            onAuthStateChanged: jest.fn(next => {
                const listener = { next, unsubscribe: jest.fn() };
                auth.listeners.push(listener);
                return listener.unsubscribe;
            }),
            setPersistence: jest.fn(() => {
                order.push('persistence');
                return Promise.resolve();
            }),
            signInAnonymously: jest.fn(() => {
                order.push('sign-in');
                return Promise.resolve({ user: actualUser });
            }),
        });
        const identity = createGuestIdentity(auth);
        const result = identity.ensureGuest();

        auth.listeners[0].next(null);

        await expect(result).resolves.toBe(actualUser);
        expect(order).toEqual(['persistence', 'sign-in']);
        expect(auth.setPersistence).toHaveBeenCalledWith('local');
    });

    it('keeps an organizer identity that appears while persistence is pending', async () => {
        const persistence = deferred();
        const organizer = { uid: 'organizer_account' };
        const auth = makeAuth({
            onAuthStateChanged: jest.fn(next => {
                const listener = { next, unsubscribe: jest.fn() };
                auth.listeners.push(listener);
                return listener.unsubscribe;
            }),
            setPersistence: jest.fn(() => persistence.promise),
            currentUser: null,
        });
        const result = createGuestIdentity(auth).ensureGuest();

        auth.listeners[0].next(null);
        await Promise.resolve();
        expect(auth.setPersistence).toHaveBeenCalledWith('local');
        expect(auth.signInAnonymously).not.toHaveBeenCalled();

        auth.currentUser = organizer;
        persistence.resolve();

        await expect(result).resolves.toBe(organizer);
        expect(auth.signInAnonymously).not.toHaveBeenCalled();
    });

    it('coalesces concurrent ensureGuest calls into one restoration and sign-in attempt', async () => {
        let listener;
        const auth = makeAuth({
            onAuthStateChanged: jest.fn((next, error) => {
                listener = { next, error, unsubscribe: jest.fn() };
                return listener.unsubscribe;
            }),
        });
        const identity = createGuestIdentity(auth);
        const first = identity.ensureGuest();
        const second = identity.ensureGuest();

        expect(second).toBe(first);
        expect(auth.onAuthStateChanged).toHaveBeenCalledTimes(1);
        listener.next(null);

        await expect(Promise.all([first, second])).resolves.toEqual([
            { uid: 'anonymous_user' },
            { uid: 'anonymous_user' },
        ]);
        expect(auth.setPersistence).toHaveBeenCalledTimes(1);
        expect(auth.signInAnonymously).toHaveBeenCalledTimes(1);
    });

    it('rejects restoration errors and unsubscribes the auth observer', async () => {
        let listener;
        const authError = new Error('observer failed');
        const auth = makeAuth({
            onAuthStateChanged: jest.fn((next, error) => {
                listener = { next, error, unsubscribe: jest.fn() };
                return listener.unsubscribe;
            }),
        });
        const result = createGuestIdentity(auth).ensureGuest();

        listener.error(authError);

        await expect(result).rejects.toBe(authError);
        expect(listener.unsubscribe).toHaveBeenCalledTimes(1);
        expect(auth.setPersistence).not.toHaveBeenCalled();
        expect(auth.signInAnonymously).not.toHaveBeenCalled();
    });

    it('rejects a synchronous observer registration failure', async () => {
        const error = new Error('registration failed');
        const auth = makeAuth({ onAuthStateChanged: jest.fn(() => { throw error; }) });

        await expect(createGuestIdentity(auth).ensureGuest()).rejects.toBe(error);
        expect(auth.setPersistence).not.toHaveBeenCalled();
        expect(auth.signInAnonymously).not.toHaveBeenCalled();
    });

    it('unsubscribes when the observer invokes its first callback synchronously', async () => {
        const restoredUser = { uid: 'restored' };
        let unsubscribe;
        const auth = makeAuth({
            onAuthStateChanged: jest.fn(next => {
                next(restoredUser);
                unsubscribe = jest.fn();
                return unsubscribe;
            }),
        });

        await expect(createGuestIdentity(auth).ensureGuest()).resolves.toBe(restoredUser);
        expect(unsubscribe).toHaveBeenCalledTimes(1);
        expect(auth.setPersistence).not.toHaveBeenCalled();
    });

    it('rejects persistence failures and permits an explicit retry', async () => {
        let listener;
        const persistenceError = new Error('persistence failed');
        const auth = makeAuth({
            onAuthStateChanged: jest.fn((next, error) => {
                listener = { next, error, unsubscribe: jest.fn() };
                return listener.unsubscribe;
            }),
            setPersistence: jest.fn().mockRejectedValueOnce(persistenceError).mockResolvedValue(undefined),
        });
        const identity = createGuestIdentity(auth);
        const first = identity.ensureGuest();
        listener.next(null);

        await expect(first).rejects.toBe(persistenceError);

        const retry = identity.ensureGuest();
        listener.next(null);

        await expect(retry).resolves.toEqual({ uid: 'anonymous_user' });
        expect(auth.onAuthStateChanged).toHaveBeenCalledTimes(2);
        expect(auth.setPersistence).toHaveBeenCalledTimes(2);
        expect(auth.signInAnonymously).toHaveBeenCalledTimes(1);
    });

    it('propagates synchronous persistence throws and anonymous sign-in errors', async () => {
        const persistenceError = new Error('persistence threw');
        const auth = makeAuth({ setPersistence: jest.fn(() => { throw persistenceError; }) });
        const identity = createGuestIdentity(auth);
        const persistenceAttempt = identity.ensureGuest();
        auth.listeners[0].next(null);

        await expect(persistenceAttempt).rejects.toBe(persistenceError);

        const signInError = new Error('sign-in rejected');
        const retryAuth = makeAuth({ signInAnonymously: jest.fn().mockRejectedValue(signInError) });
        const retryIdentity = createGuestIdentity(retryAuth);
        const signInAttempt = retryIdentity.ensureGuest();
        retryAuth.listeners[0].next(null);

        await expect(signInAttempt).rejects.toBe(signInError);
        expect(retryAuth.listeners[0].unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('rejects a Firebase result without a user and allows a later retry', async () => {
        const actualUser = { uid: 'firebase_assigned_uid' };
        const auth = makeAuth({
            onAuthStateChanged: jest.fn(next => {
                const listener = { next, unsubscribe: jest.fn() };
                auth.listeners.push(listener);
                return listener.unsubscribe;
            }),
            signInAnonymously: jest
                .fn()
                .mockResolvedValueOnce({})
                .mockResolvedValueOnce({ user: actualUser }),
        });
        const identity = createGuestIdentity(auth);
        const first = identity.ensureGuest();
        auth.listeners[0].next(null);

        await expect(first).rejects.toThrow('Anonymous sign-in did not return a user.');

        const retry = identity.ensureGuest();
        auth.listeners[1].next(null);

        await expect(retry).resolves.toBe(actualUser);
        expect(auth.signInAnonymously).toHaveBeenCalledTimes(2);
    });

    it('propagates a synchronous anonymous sign-in throw', async () => {
        const error = new Error('anonymous sign-in threw');
        const auth = makeAuth({ signInAnonymously: jest.fn(() => { throw error; }) });
        const result = createGuestIdentity(auth).ensureGuest();

        auth.listeners[0].next(null);

        await expect(result).rejects.toBe(error);
        expect(auth.listeners[0].unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('observes a later sign-out instead of permanently caching the prior user', async () => {
        const firstUser = { uid: 'first_user' };
        const secondUser = { uid: 'anonymous_user' };
        const auth = makeAuth({
            onAuthStateChanged: jest.fn(next => {
                const listener = { next, unsubscribe: jest.fn() };
                auth.listeners.push(listener);
                return listener.unsubscribe;
            }),
            signInAnonymously: jest.fn().mockResolvedValue({ user: secondUser }),
        });
        const identity = createGuestIdentity(auth);
        const first = identity.ensureGuest();
        auth.listeners[0].next(firstUser);
        await expect(first).resolves.toBe(firstUser);

        const afterSignOut = identity.ensureGuest();
        expect(auth.onAuthStateChanged).toHaveBeenCalledTimes(2);
        auth.listeners[1].next(null);

        await expect(afterSignOut).resolves.toBe(secondUser);
        expect(auth.signInAnonymously).toHaveBeenCalledTimes(1);
        expect(auth.listeners[1].unsubscribe).toHaveBeenCalledTimes(1);
    });
});
