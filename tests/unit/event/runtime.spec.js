import { createEventLobbyRuntime, createEventPresenterRuntime, createEventSessionRuntime } from '@/event/runtime';
import { createGuestIdentity } from '@/event/identity';
import { createVersionedLobbyClient, createVersionedSessionClient, createPresenterClient } from '@/event/facade';

jest.mock('@/event/identity', () => ({ createGuestIdentity: jest.fn() }));
jest.mock('@/event/facade', () => ({ createVersionedLobbyClient: jest.fn(), createVersionedSessionClient: jest.fn(), createPresenterClient: jest.fn() }));

function sdkFixture() {
    const calls = [];
    const auth = { emulatorConfig: null, useEmulator: jest.fn(() => calls.push('auth-emulator')) };
    const db = { useEmulator: jest.fn(() => calls.push('database-emulator')) };
    const options = { projectId: 'configured-project', apiKey: 'example-config', databaseURL: 'https://example.test' };
    const sdk = { apps: [], app: jest.fn(() => ({ options })) };
    sdk.initializeApp = jest.fn((config, name) => {
        const app = {
            name, options: config,
            auth: jest.fn(() => { calls.push('auth'); return auth; }),
            database: jest.fn(() => { calls.push('database'); return db; }),
        };
        sdk.apps.push(app);
        return app;
    });
    return { sdk, db, auth, calls, options };
}

beforeEach(() => {
    jest.clearAllMocks();
    createVersionedLobbyClient.mockImplementation((database, identity) => ({ database, identity }));
    createVersionedSessionClient.mockImplementation((database, identity) => ({ database, identity }));
    createPresenterClient.mockImplementation(database => ({ database }));
    createGuestIdentity.mockReturnValue({ ensureGuest: jest.fn().mockResolvedValue({ uid: 'guest' }) });
});

describe('event runtime isolation', () => {
    it('uses a separate named app and does not request guest auth for public reads', async () => {
        const f = sdkFixture();
        const client = createEventLobbyRuntime(f.sdk, { mode: 'production', hostname: 'event.example' });
        expect(f.sdk.initializeApp).toHaveBeenCalledWith(f.options, 'geoguess-event-guest');
        expect(client.database).toBe(f.db);
        expect(f.sdk.apps[0].auth).not.toHaveBeenCalled();
        expect(f.db.useEmulator).not.toHaveBeenCalled();
        await expect(client.identity.ensureGuest()).resolves.toEqual({ uid: 'guest' });
        await client.identity.ensureGuest();
        expect(createGuestIdentity).toHaveBeenCalledTimes(1);
        expect(createGuestIdentity).toHaveBeenCalledWith(f.auth);
    });

    it('reuses the event database singleton across clients', () => {
        const f = sdkFixture();
        const first = createEventLobbyRuntime(f.sdk);
        const second = createEventLobbyRuntime(f.sdk);
        expect(first.database).toBe(second.database);
        expect(f.sdk.initializeApp).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['production', '127.0.0.1'],
        ['test', '127.0.0.1'],
        ['development', 'event.example'],
        ['development', '192.168.1.10'],
    ])('refuses emulator mode outside local development (%s, %s)', (mode, hostname) => {
        const f = sdkFixture();
        expect(() => createEventLobbyRuntime(f.sdk, { mode, hostname, emulators: true })).toThrow();
        expect(f.sdk.initializeApp).not.toHaveBeenCalled();
        expect(createVersionedLobbyClient).not.toHaveBeenCalled();
    });

    it('pins demo database and defers emulator Auth until deliberate joining', async () => {
        const f = sdkFixture();
        const client = createEventLobbyRuntime(f.sdk, { mode: 'development', hostname: '127.0.0.1', emulators: true });
        expect(f.sdk.app).not.toHaveBeenCalled();
        expect(f.sdk.initializeApp.mock.calls[0][0].projectId).toBe('demo-geoguess-admission');
        expect(f.sdk.apps[0].auth).not.toHaveBeenCalled();
        expect(f.db.useEmulator).toHaveBeenCalledWith('127.0.0.1', 9009);
        expect(createGuestIdentity).not.toHaveBeenCalled();
        await client.identity.ensureGuest();
        expect(f.auth.useEmulator).toHaveBeenCalledWith('http://127.0.0.1:9099', { disableWarnings: true });
        expect(createGuestIdentity).toHaveBeenCalledTimes(1);
    });

    it('rejects a reused named app bound to a different project', () => {
        const f = sdkFixture();
        f.sdk.apps.push({ name: 'geoguess-event-guest', options: { projectId: 'wrong-project' } });
        expect(() => createEventLobbyRuntime(f.sdk)).toThrow('configuration mismatch');
        expect(createVersionedLobbyClient).not.toHaveBeenCalled();
    });

    it('does not silently reuse an auth emulator at a different endpoint during join', async () => {
        const f = sdkFixture();
        f.auth.emulatorConfig = { host: 'unexpected.example', port: 9099 };
        const client = createEventLobbyRuntime(f.sdk, {
            mode: 'development', hostname: 'localhost', emulators: true,
        });
        await expect(client.identity.ensureGuest()).rejects.toThrow('Unexpected event auth emulator');
        expect(createGuestIdentity).not.toHaveBeenCalled();
    });
});


test.each([false, true])('presenter does not request Auth or guest identity (emulators=%s)', emulators => {
    const f = sdkFixture();
    const presenter = createEventPresenterRuntime(f.sdk, { mode: 'development', hostname: 'localhost', emulators });
    expect(presenter.database).toBe(f.db);
    expect(f.sdk.apps[0].name).toBe(emulators ? 'geoguess-event-demo-presenter' : 'geoguess-event-presenter');
    expect(f.sdk.apps[0].auth).not.toHaveBeenCalled();
    expect(createGuestIdentity).not.toHaveBeenCalled();
    expect(createVersionedLobbyClient).not.toHaveBeenCalled();
    expect(createPresenterClient).toHaveBeenCalledWith(f.db);
});

test('guest session uses the same stable guest identity lazily', async () => {
    const f = sdkFixture();
    createVersionedSessionClient.mockImplementation((database, identity) => ({
        getOwnGuess: () => identity.ensureUser(), start: jest.fn(), getHostSetup: jest.fn(),
    }));
    const session = createEventSessionRuntime(f.sdk);
    expect(f.sdk.apps[0].auth).not.toHaveBeenCalled();
    await expect(session.getOwnGuess()).resolves.toEqual({ uid: 'guest' });
    expect(createGuestIdentity).toHaveBeenCalledTimes(1);
    expect(Object.keys(session).sort()).toEqual(['getClue', 'getOwnGuess', 'getReveal', 'getServerTime', 'getState', 'getTiming', 'submitGuess', 'subscribeState', 'subscribeTiming']);
    expect(session.start).toBeUndefined();
    expect(session.getHostSetup).toBeUndefined();
});
