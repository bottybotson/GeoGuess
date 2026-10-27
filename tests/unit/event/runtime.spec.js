import { createEventLobbyRuntime } from '@/event/runtime';
import { createGuestIdentity } from '@/event/identity';
import { createLobbyClient } from '@/event/lobby';

jest.mock('@/event/identity', () => ({ createGuestIdentity: jest.fn() }));
jest.mock('@/event/lobby', () => ({ createLobbyClient: jest.fn() }));

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
    createLobbyClient.mockImplementation((database, identity) => ({ database, identity }));
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
        expect(createLobbyClient).not.toHaveBeenCalled();
    });

    it('pins demo project and endpoints before constructing a client', () => {
        const f = sdkFixture();
        createEventLobbyRuntime(f.sdk, { mode: 'development', hostname: '127.0.0.1', emulators: true });
        expect(f.sdk.app).not.toHaveBeenCalled();
        expect(f.sdk.initializeApp.mock.calls[0][0].projectId).toBe('demo-geoguess-admission');
        expect(f.auth.useEmulator).toHaveBeenCalledWith('http://127.0.0.1:9099', { disableWarnings: true });
        expect(f.db.useEmulator).toHaveBeenCalledWith('127.0.0.1', 9009);
        expect(f.calls.indexOf('auth-emulator')).toBeLessThan(f.calls.indexOf('database'));
        expect(createGuestIdentity).not.toHaveBeenCalled();
    });

    it('rejects a reused named app bound to a different project', () => {
        const f = sdkFixture();
        f.sdk.apps.push({ name: 'geoguess-event-guest', options: { projectId: 'wrong-project' } });
        expect(() => createEventLobbyRuntime(f.sdk)).toThrow('configuration mismatch');
        expect(createLobbyClient).not.toHaveBeenCalled();
    });

    it('does not silently reuse an auth emulator at a different endpoint', () => {
        const f = sdkFixture();
        f.auth.emulatorConfig = { host: 'unexpected.example', port: 9099 };
        expect(() => createEventLobbyRuntime(f.sdk, {
            mode: 'development', hostname: 'localhost', emulators: true,
        })).toThrow('Unexpected event auth emulator');
        expect(f.db.useEmulator).not.toHaveBeenCalled();
    });
});
