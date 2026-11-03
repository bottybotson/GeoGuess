import {
    absoluteCreationLinks, createGameFromHost, GameCreationError, newRequestId,
    readPendingCreation, writePendingCreation,
} from '@/event/game-creation';

const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: jest.fn().mockResolvedValue(body) });
const success = (status = 201, state = 'created') => response(status, {
    status: state, eventId: 'new-party', links: {
        host: '/event/new-party/host', join: '/event/new-party/join', presenter: '/event/new-party/present',
    },
});

describe('host game creation API client', () => {
    it('sends only the source and attempt key with a Bearer token', async () => {
        const fetchImpl = jest.fn().mockResolvedValue(success());
        await expect(createGameFromHost({ sourceEventId: 'party', requestId: 'a'.repeat(32), token: 'id-token', fetchImpl }))
            .resolves.toMatchObject({ status: 'created', eventId: 'new-party' });
        expect(fetchImpl).toHaveBeenCalledWith('/api/event-creations', {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer id-token' },
            body: JSON.stringify({ sourceEventId: 'party', requestId: 'a'.repeat(32) }),
            credentials: 'omit', cache: 'no-store',
        });
    });

    it('accepts only canonical relative routes tied to the returned ID and correct HTTP status', async () => {
        await expect(createGameFromHost({ sourceEventId: 'party', requestId: 'b'.repeat(32), token: 'token', fetchImpl: async () => success(200, 'already-created') }))
            .resolves.toMatchObject({ status: 'already-created' });
        const unsafe = success();
        unsafe.json.mockResolvedValue({ status: 'created', eventId: 'new-party', links: {
            host: '//attacker.test/', join: '/event/new-party/join', presenter: '/event/new-party/present',
        } });
        await expect(createGameFromHost({ sourceEventId: 'party', requestId: 'b'.repeat(32), token: 'token', fetchImpl: async () => unsafe }))
            .rejects.toMatchObject({ code: 'response-invalid' });
        const mismatch = success(200, 'created');
        await expect(createGameFromHost({ sourceEventId: 'party', requestId: 'b'.repeat(32), token: 'token', fetchImpl: async () => mismatch }))
            .rejects.toMatchObject({ code: 'response-invalid' });
    });

    it('maps fixed server errors and uncertain transport failures without exposing provider text', async () => {
        const failed = response(503, { error: 'creation-unconfirmed' });
        await expect(createGameFromHost({ sourceEventId: 'party', requestId: 'c'.repeat(32), token: 'token', fetchImpl: async () => failed }))
            .rejects.toMatchObject({ code: 'creation-unconfirmed', message: expect.stringContaining('same attempt') });
        await expect(createGameFromHost({ sourceEventId: 'party', requestId: 'c'.repeat(32), token: 'token', fetchImpl: async () => { throw new Error('secret details'); } }))
            .rejects.toMatchObject({ code: 'creation-unconfirmed' });
        await expect(createGameFromHost({ sourceEventId: 'party', requestId: 'C'.repeat(32), token: 'token', fetchImpl: jest.fn() }))
            .rejects.toMatchObject({ code: 'invalid-request' });
    });

    it('rejects malformed successes, unsafe links, extra fields and unknown provider errors', async () => {
        const canonical = await success().json();
        const bodies = [
            { ...canonical, eventId: 'party', links: { host: '/event/party/host', join: '/event/party/join', presenter: '/event/party/present' } },
            { ...canonical, eventId: 123, links: { host: '/event/123/host', join: '/event/123/join', presenter: '/event/123/present' } },
            { ...canonical, secret: 'private-value' },
            { ...canonical, links: { ...canonical.links, host: 'https://attacker.test/event/new-party/host' } },
            { ...canonical, links: { ...canonical.links, join: '/event/new-party/join?token=private-value' } },
        ];
        for (const body of bodies) {
            await expect(createGameFromHost({ sourceEventId: 'party', requestId: 'e'.repeat(32), token: 'token', fetchImpl: async () => response(201, body) }))
                .rejects.toMatchObject({ code: 'response-invalid' });
        }
        await expect(createGameFromHost({ sourceEventId: 'party', requestId: 'e'.repeat(32), token: 'token', fetchImpl: async () => response(500, { error: 'private-provider-detail' }) }))
            .rejects.toMatchObject({ code: 'response-invalid', message: expect.not.stringContaining('private-provider-detail') });
        expect(new GameCreationError('constructor').message).toContain('unexpected response');
    });

    it('creates exactly 128 random bits as 32 lowercase hexadecimal characters', () => {
        const cryptoProvider = { getRandomValues: bytes => { bytes.fill(0xab); return bytes; } };
        expect(newRequestId(cryptoProvider)).toBe('ab'.repeat(16));
        expect(newRequestId(cryptoProvider)).toMatch(/^[a-f0-9]{32}$/);
    });

    it('stores only host/source/request identities and builds absolute links from the browser origin', () => {
        const storage = window.sessionStorage;
        storage.clear();
        const attempt = { hostUid: 'host-1', sourceEventId: 'party', requestId: 'd'.repeat(32) };
        writePendingCreation(storage, attempt);
        expect(readPendingCreation(storage, 'host-1', 'party')).toEqual(attempt);
        expect(storage.getItem('geoguess:event-creation:host-1:party')).toBe(JSON.stringify(attempt));
        expect(readPendingCreation(storage, 'host-2', 'party')).toBeNull();
        writePendingCreation(storage, { ...attempt, token: 'must-not-persist', privateSetup: 'must-not-persist' });
        expect(storage.getItem('geoguess:event-creation:host-1:party')).toBe(JSON.stringify(attempt));
        expect(absoluteCreationLinks({ host: '/event/new-party/host', join: '/event/new-party/join', presenter: '/event/new-party/present' }, 'https://host.example'))
            .toEqual({ host: 'https://host.example/event/new-party/host', join: 'https://host.example/event/new-party/join', presenter: 'https://host.example/event/new-party/present' });
    });
});
