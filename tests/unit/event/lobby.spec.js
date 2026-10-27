import { createLobbyClient } from '@/event/lobby';

const base = 'events/party/public';
const denied = () => Object.assign(new Error('Denied'), { code: 'PERMISSION_DENIED' });
const snap = value => ({ val: () => value });
const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };
const participant = (nickname = 'Original', slot = 's01', extra = {}) => ({ slot, nickname, ...extra });
const fullSlots = () => Object.fromEntries(Array.from({ length: 50 }, (_, i) => [
    `s${String(i + 1).padStart(2, '0')}`, `guest_${i}`,
]));

function sdk(initial = {}) {
    const data = { [`${base}/phase`]: 'lobby', ...initial };
    const listeners = [];
    const once = jest.fn(path => Promise.resolve(snap(Object.prototype.hasOwnProperty.call(data, path) ? data[path] : null)));
    const update = jest.fn(() => Promise.resolve());
    const off = jest.fn();
    const on = jest.fn((path, handler, cancel) => { listeners.push({ path, handler, cancel }); });
    const database = {
        ref: jest.fn(path => ({
            once: event => { expect(event).toBe('value'); return once(path); },
            update: updates => { expect(path).toBeUndefined(); return update(updates); },
            on: (event, handler, cancel) => { expect(event).toBe('value'); return on(path, handler, cancel); },
            off: (event, handler) => { expect(event).toBe('value'); off(path, handler); },
        })),
    };
    const identity = { ensureGuest: jest.fn(() => Promise.resolve({ uid: 'guest' })) };
    return { data, listeners, once, update, on, off, database, identity, client: createLobbyClient(database, identity) };
}

describe('event lobby joins', () => {
    it('uses trusted identity, trims Unicode nickname, and sends exactly two atomic root updates', async () => {
        const service = sdk();
        expect(await service.client.join('party', '  😀'.concat('😀'.repeat(19), '  '))).toEqual({
            status: 'joined', participant: { id: 'guest', nickname: '😀'.repeat(20) },
        });
        expect(service.update).toHaveBeenCalledTimes(1);
        expect(service.update).toHaveBeenCalledWith({
            [`${base}/participants/guest`]: { slot: 's01', nickname: '😀'.repeat(20) },
            [`${base}/slots/s01`]: 'guest',
        });
        expect(service.once.mock.calls.map(([path]) => path)).toEqual([
            `${base}/participants/guest`, `${base}/phase`, `${base}/slots`,
        ]);
        expect(service.identity.ensureGuest).toHaveBeenCalledWith();
    });

    it.each(['', 'a/b', 'a.b', 'é', 'a'.repeat(81), null, 42])('rejects invalid event ID %p before refs or auth', async eventId => {
        const service = sdk();
        await expect(service.client.join(eventId, 'Name')).rejects.toMatchObject({ code: 'invalid-event-id' });
        expect(service.database.ref).not.toHaveBeenCalled();
        expect(service.identity.ensureGuest).not.toHaveBeenCalled();
    });

    it('accepts an 80-character ID and authenticated 128-character UID', async () => {
        const service = sdk();
        const eventId = 'a'.repeat(80);
        service.data[`events/${eventId}/public/phase`] = 'lobby';
        service.identity.ensureGuest.mockResolvedValue({ uid: 'g'.repeat(128) });
        await expect(service.client.join(eventId, 'Name')).resolves.toMatchObject({ status: 'joined' });
    });

    it.each([null, {}, { uid: '' }, { uid: 'bad/path' }, { uid: 'g'.repeat(129) }])('rejects invalid authenticated user %p', async user => {
        const service = sdk();
        service.identity.ensureGuest.mockResolvedValue(user);
        await expect(service.client.join('party', 'Name')).rejects.toMatchObject({ code: 'invalid-identity' });
        expect(service.database.ref).not.toHaveBeenCalled();
    });

    it.each(['', '  ', '😀'.repeat(21), 4, undefined])('rejects invalid newcomer nickname %p without writes', async name => {
        const service = sdk();
        await expect(service.client.join('party', name)).rejects.toMatchObject({ code: 'invalid-nickname' });
        expect(service.update).not.toHaveBeenCalled();
    });

    it.each(['lobby', 'guessing', 'reveal', 'complete'])('rejoins read-only preserving name during %s even with invalid nickname', async phase => {
        const service = sdk({
            [`${base}/participants/guest`]: participant('Original', 's50', { score: 99 }),
            [`${base}/phase`]: phase,
            [`${base}/slots`]: fullSlots(),
        });
        await expect(service.client.join('party', null)).resolves.toEqual({
            status: 'rejoined', participant: { id: 'guest', nickname: 'Original' },
        });
        expect(service.once.mock.calls).toEqual([[`${base}/participants/guest`]]);
        expect(service.update).not.toHaveBeenCalled();
    });

    it.each(['guessing', 'reveal', 'complete', null])('returns started for newcomer during %p before nickname validation', async phase => {
        const service = sdk({ [`${base}/phase`]: phase });
        await expect(service.client.join('party', '')).resolves.toEqual({ status: 'started' });
        expect(service.once).toHaveBeenCalledTimes(2);
        expect(service.update).not.toHaveBeenCalled();
    });

    it('coalesces calls including identity, uses the first nickname, and clears settled entries', async () => {
        const service = sdk();
        const auth = deferred();
        service.identity.ensureGuest.mockReturnValueOnce(auth.promise);
        const first = service.client.join('party', 'First');
        const second = service.client.join('party', 'Second');
        expect(second).toBe(first);
        await flush();
        expect(service.identity.ensureGuest).toHaveBeenCalledTimes(1);
        auth.resolve({ uid: 'guest' });
        await expect(first).resolves.toMatchObject({ participant: { nickname: 'First' } });
        await service.client.join('party', 'Retry');
        expect(service.identity.ensureGuest).toHaveBeenCalledTimes(2);
    });

    it('does not coalesce distinct events', async () => {
        const service = sdk({ 'events/other/public/phase': 'lobby' });
        await Promise.all([service.client.join('party', 'One'), service.client.join('other', 'Two')]);
        expect(service.identity.ensureGuest).toHaveBeenCalledTimes(2);
        expect(service.update).toHaveBeenCalledTimes(2);
    });

    it('rereads membership, phase, and slots after permission contention and chooses the next empty slot', async () => {
        const service = sdk();
        service.update.mockImplementationOnce(() => {
            service.data[`${base}/slots`] = { s01: 'other' };
            return Promise.reject(denied());
        });
        await expect(service.client.join('party', 'Guest')).resolves.toMatchObject({ status: 'joined' });
        expect(service.update.mock.calls[1][0][`${base}/participants/guest`].slot).toBe('s02');
        expect(service.once.mock.calls.map(([path]) => path)).toEqual([
            `${base}/participants/guest`, `${base}/phase`, `${base}/slots`,
            `${base}/participants/guest`, `${base}/phase`, `${base}/slots`,
        ]);
    });

    it.each(['rejoined', 'started', 'full'])('observes %s after a denied claim', async status => {
        const service = sdk();
        service.update.mockImplementationOnce(() => {
            if (status === 'rejoined') service.data[`${base}/participants/guest`] = participant('Other tab');
            if (status === 'started') service.data[`${base}/phase`] = 'guessing';
            if (status === 'full') service.data[`${base}/slots`] = fullSlots();
            return Promise.reject(denied());
        });
        await expect(service.client.join('party', 'Guest')).resolves.toMatchObject({ status });
        expect(service.update).toHaveBeenCalledTimes(1);
    });

    it('rereads membership before reporting capacity when another tab just occupied the last slot', async () => {
        const service = sdk({ [`${base}/slots`]: fullSlots() });
        service.once.mockImplementation(path => {
            const value = service.data[path] === undefined ? null : service.data[path];
            if (path === `${base}/slots`) service.data[`${base}/participants/guest`] = participant('Other tab', 's50');
            return Promise.resolve(snap(value));
        });
        await expect(service.client.join('party', 'New name')).resolves.toEqual({
            status: 'rejoined', participant: { id: 'guest', nickname: 'Other tab' },
        });
        expect(service.update).not.toHaveBeenCalled();
    });

    it('never calls persistent denials full and bounds claims to 51 before allowing explicit retry', async () => {
        const service = sdk();
        service.update.mockRejectedValue(denied());
        await expect(service.client.join('party', 'Host?')).rejects.toMatchObject({ code: 'unavailable' });
        expect(service.update).toHaveBeenCalledTimes(51);
        expect(service.once).toHaveBeenCalledTimes(52 * 3);
        service.update.mockResolvedValue();
        await expect(service.client.join('party', 'Guest')).resolves.toMatchObject({ status: 'joined' });
    });

    it.each(['auth', 'read', 'write'])('propagates %s errors unchanged without automatic retries', async where => {
        const service = sdk();
        const error = Object.assign(new Error('Offline'), { code: 'network-error' });
        if (where === 'auth') service.identity.ensureGuest.mockRejectedValue(error);
        if (where === 'read') service.once.mockRejectedValue(error);
        if (where === 'write') service.update.mockRejectedValue(error);
        await expect(service.client.join('party', 'Guest')).rejects.toBe(error);
        expect(service.identity.ensureGuest).toHaveBeenCalledTimes(1);
        expect(service.update).toHaveBeenCalledTimes(where === 'write' ? 1 : 0);
    });

    it.each([
        { s00: 'guest' }, { s51: 'guest' }, { s01: 1 }, { s01: 'bad/path' },
        { s01: 'same', s02: 'same' }, [], 'malformed',
    ])('fails closed on malformed slots %p without claiming full', async slots => {
        const service = sdk({ [`${base}/slots`]: slots });
        await expect(service.client.join('party', 'Guest')).rejects.toMatchObject({ code: 'unavailable' });
        expect(service.update).not.toHaveBeenCalled();
    });

    it('fails closed on malformed existing membership without overwriting it', async () => {
        const service = sdk({ [`${base}/participants/guest`]: { nickname: 'Bad', slot: 's51' } });
        await expect(service.client.join('party', 'Guest')).rejects.toMatchObject({ code: 'unavailable' });
        expect(service.update).not.toHaveBeenCalled();
    });

    it('admits exactly 50 of 51 concurrent controlled clients, without duplicate slots or overwritten names', async () => {
        const state = { participants: {}, slots: {} };
        const updates = [];
        const clients = Array.from({ length: 51 }, (_, index) => {
            const uid = `guest_${index}`;
            const service = sdk();
            service.identity.ensureGuest.mockResolvedValue({ uid });
            service.once.mockImplementation(path => {
                const value = path.endsWith('/phase') ? 'lobby' : path.endsWith('/slots') ? { ...state.slots } : state.participants[uid] || null;
                return Promise.resolve(snap(value));
            });
            service.update.mockImplementation(value => {
                const member = value[`${base}/participants/${uid}`];
                if (state.slots[member.slot]) return Promise.reject(denied());
                state.slots[member.slot] = uid;
                state.participants[uid] = member;
                updates.push(value);
                return Promise.resolve();
            });
            return service.client;
        });
        const results = await Promise.all(clients.map((client, index) => client.join('party', `Guest ${index}`)));
        expect(results.filter(result => result.status === 'joined')).toHaveLength(50);
        expect(results.filter(result => result.status === 'full')).toHaveLength(1);
        expect(Object.keys(state.slots)).toHaveLength(50);
        expect(Object.keys(state.participants)).toHaveLength(50);
        expect(updates).toHaveLength(50);
        expect(Object.values(state.participants).map(value => value.nickname).sort()).toEqual(
            results.filter(result => result.status === 'joined').map(value => value.participant.nickname).sort(),
        );
    });
});

describe('join overall deadline', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    const timeOutOptimisticClaim = async (service, pending) => {
        service.update.mockImplementationOnce(updates => {
            service.data[`${base}/participants/guest`] = updates[`${base}/participants/guest`];
            service.data[`${base}/slots`] = { s01: 'guest' };
            return pending.promise;
        });
        const first = service.client.join('party', 'Original');
        const rejected = expect(first).rejects.toMatchObject({ code: 'unavailable' });
        await flush();
        expect(service.update).toHaveBeenCalledTimes(1);
        jest.advanceTimersByTime(15000);
        await rejected;
    };

    it.each([false, true])('waits for an unacknowledged optimistic member across retry (new client: %p)', async newClient => {
        const service = sdk();
        const pending = deferred();
        await timeOutOptimisticClaim(service, pending);
        const client = newClient ? createLobbyClient(service.database, service.identity) : service.client;
        const reads = service.once.mock.calls.length;
        const retry = client.join('party', 'Replacement');
        const rejected = expect(retry).rejects.toMatchObject({ code: 'unavailable' });
        await flush();
        expect(service.once).toHaveBeenCalledTimes(reads);
        jest.advanceTimersByTime(15000);
        await rejected;
        expect(service.once).toHaveBeenCalledTimes(reads);
        pending.resolve();
        await flush();
        expect(service.once).toHaveBeenCalledTimes(reads);
        expect(jest.getTimerCount()).toBe(0);
    });

    it.each([false, true])('recovers an acknowledged late commit read-only (new client: %p)', async newClient => {
        const service = sdk();
        const pending = deferred();
        await timeOutOptimisticClaim(service, pending);
        const client = newClient ? createLobbyClient(service.database, service.identity) : service.client;
        const reads = service.once.mock.calls.length;
        const retry = client.join('party', 'Replacement');
        await flush();
        expect(service.once).toHaveBeenCalledTimes(reads);
        pending.resolve();
        await expect(retry).resolves.toEqual({
            status: 'rejoined', participant: { id: 'guest', nickname: 'Original' },
        });
        expect(service.update).toHaveBeenCalledTimes(1);
        expect(jest.getTimerCount()).toBe(0);
    });

    it.each([false, true].flatMap(newClient => ['joined', 'started', 'full'].map(status => [newClient, status])))(
        'reads rolled-back authoritative state after old denial (new client: %p, outcome: %s)',
        async (newClient, status) => {
            const service = sdk();
            const pending = deferred();
            await timeOutOptimisticClaim(service, pending);
            const client = newClient ? createLobbyClient(service.database, service.identity) : service.client;
            const reads = service.once.mock.calls.length;
            const retry = client.join('party', 'Replacement');
            await flush();
            expect(service.once).toHaveBeenCalledTimes(reads);
            delete service.data[`${base}/participants/guest`];
            service.data[`${base}/phase`] = status === 'started' ? 'guessing' : 'lobby';
            service.data[`${base}/slots`] = status === 'full' ? fullSlots() : null;
            pending.reject(denied());
            await expect(retry).resolves.toMatchObject({ status });
            expect(service.update).toHaveBeenCalledTimes(status === 'joined' ? 2 : 1);
            expect(jest.getTimerCount()).toBe(0);
        },
    );

    it('also waits for another UID pending on the same database/event before trusting optimistic capacity', async () => {
        const service = sdk();
        const pending = deferred();
        await timeOutOptimisticClaim(service, pending);
        service.data[`${base}/slots`] = fullSlots();
        const identity = { ensureGuest: jest.fn().mockResolvedValue({ uid: 'other_guest' }) };
        const client = createLobbyClient(service.database, identity);
        const reads = service.once.mock.calls.length;
        const retry = client.join('party', 'Other guest');
        await flush();
        expect(service.once).toHaveBeenCalledTimes(reads);
        delete service.data[`${base}/participants/guest`];
        service.data[`${base}/slots`] = null;
        pending.reject(denied());
        await expect(retry).resolves.toMatchObject({
            status: 'joined', participant: { id: 'other_guest', nickname: 'Other guest' },
        });
        expect(jest.getTimerCount()).toBe(0);
    });

    it('does not block different databases or events on an unresolved old claim', async () => {
        const service = sdk({ 'events/other/public/phase': 'lobby' });
        const pending = deferred();
        await timeOutOptimisticClaim(service, pending);
        const otherDatabase = sdk();
        await expect(otherDatabase.client.join('party', 'Other database')).resolves.toMatchObject({ status: 'joined' });
        await expect(service.client.join('other', 'Other event')).resolves.toMatchObject({ status: 'joined' });
        expect(service.update).toHaveBeenCalledTimes(2);
        expect(otherDatabase.update).toHaveBeenCalledTimes(1);
        pending.resolve();
        await flush();
        expect(jest.getTimerCount()).toBe(0);
    });

    it('discards an optimistic snapshot when another client claims while once() is already waiting', async () => {
        const service = sdk();
        const reading = deferred();
        const writing = deferred();
        service.once.mockReturnValueOnce(reading.promise);
        const original = service.client.join('party', 'Original');
        await flush();
        service.update.mockImplementationOnce(updates => {
            service.data[`${base}/participants/guest`] = updates[`${base}/participants/guest`];
            service.data[`${base}/slots`] = { s01: 'guest' };
            reading.resolve(snap(service.data[`${base}/participants/guest`]));
            return writing.promise;
        });
        const other = createLobbyClient(service.database, service.identity).join('party', 'Other client');
        let settled = false;
        original.then(() => { settled = true; });
        await flush();
        expect(service.update).toHaveBeenCalledTimes(1);
        expect(settled).toBe(false);
        delete service.data[`${base}/participants/guest`];
        service.data[`${base}/slots`] = null;
        service.data[`${base}/phase`] = 'guessing';
        writing.reject(denied());
        await expect(original).resolves.toEqual({ status: 'started' });
        await expect(other).resolves.toEqual({ status: 'started' });
        expect(service.update).toHaveBeenCalledTimes(1);
        expect(jest.getTimerCount()).toBe(0);
    });

    it.each(['auth', 'read', 'write'])('expires stalled %s once, cleans the timer, and ignores late completion', async where => {
        const service = sdk();
        const pending = deferred();
        if (where === 'auth') service.identity.ensureGuest.mockReturnValueOnce(pending.promise);
        if (where === 'read') service.once.mockReturnValueOnce(pending.promise);
        if (where === 'write') service.update.mockReturnValueOnce(pending.promise);
        const result = service.client.join('party', 'Guest');
        const rejected = expect(result).rejects.toMatchObject({ code: 'unavailable' });
        await flush();
        const calls = service.database.ref.mock.calls.length;
        jest.advanceTimersByTime(15000);
        await rejected;
        expect(jest.getTimerCount()).toBe(0);
        if (where === 'auth') pending.resolve({ uid: 'guest' });
        if (where === 'read') pending.resolve(snap(null));
        if (where === 'write') pending.resolve();
        await flush();
        expect(service.database.ref).toHaveBeenCalledTimes(calls);
        service.data[`${base}/participants/guest`] = participant('Committed later');
        await expect(service.client.join('party', 'Retry')).resolves.toMatchObject({
            status: 'rejoined', participant: { nickname: 'Committed later' },
        });
        expect(jest.getTimerCount()).toBe(0);
    });

    it('shares one overall budget across auth, reads and retries rather than resetting it', async () => {
        const service = sdk();
        const auth = deferred();
        const write = deferred();
        service.identity.ensureGuest.mockReturnValue(auth.promise);
        service.update.mockReturnValue(write.promise);
        const result = service.client.join('party', 'Guest');
        const rejected = expect(result).rejects.toMatchObject({ code: 'unavailable' });
        await flush();
        jest.advanceTimersByTime(10000);
        auth.resolve({ uid: 'guest' });
        await flush();
        expect(service.update).toHaveBeenCalledTimes(1);
        jest.advanceTimersByTime(5000);
        await rejected;
        write.reject(denied());
        await flush();
        expect(service.once).toHaveBeenCalledTimes(3);
        expect(service.update).toHaveBeenCalledTimes(1);
    });

    it('cleans timers on ordinary success, auth failure, and validation failure', async () => {
        const service = sdk();
        await service.client.join('party', 'Guest');
        expect(jest.getTimerCount()).toBe(0);
        service.identity.ensureGuest.mockRejectedValueOnce(new Error('Auth failed'));
        await expect(service.client.join('party', 'Guest')).rejects.toThrow('Auth failed');
        expect(jest.getTimerCount()).toBe(0);
        await expect(service.client.join('party', '')).rejects.toMatchObject({ code: 'invalid-nickname' });
        expect(jest.getTimerCount()).toBe(0);
    });
});

describe('public lobby subscriptions', () => {
    const emit = (service, leaf, value) => service.listeners.find(listener => listener.path === `${base}/${leaf}`).handler(snap(value));
    const initialize = (service, participants = null, phase = 'lobby', title = null) => {
        emit(service, 'title', title);
        emit(service, 'phase', phase);
        emit(service, 'participants', participants);
    };

    it('installs exactly three public leaf listeners without auth, writes, or reads and waits for all initial snapshots', () => {
        const service = sdk();
        const changed = jest.fn();
        service.client.subscribe('party', changed, jest.fn());
        expect(service.database.ref.mock.calls.map(([path]) => path)).toEqual([
            `${base}/title`, `${base}/phase`, `${base}/participants`,
        ]);
        emit(service, 'participants', null);
        emit(service, 'title', null);
        emit(service, 'title', 'Latest');
        expect(changed).not.toHaveBeenCalled();
        emit(service, 'phase', 'lobby');
        expect(changed).toHaveBeenLastCalledWith({ title: 'Latest', phase: 'lobby', participants: [] });
        expect(service.identity.ensureGuest).not.toHaveBeenCalled();
        expect(service.once).not.toHaveBeenCalled();
        expect(service.update).not.toHaveBeenCalled();
    });

    it('redacts extras and slots, sorts IDs deterministically, and preserves duplicate names and earlier projections', () => {
        const service = sdk();
        const changed = jest.fn();
        service.client.subscribe('party', changed, jest.fn());
        const roster = {
            z: participant('Same', 's03', { secret: 'hidden', answer: 42 }),
            a: participant('Same', 's02'),
            A: participant('Other', 's01'),
        };
        initialize(service, roster, 'lobby', 'Birthday');
        const first = changed.mock.calls[0][0];
        expect(first).toEqual({ title: 'Birthday', phase: 'lobby', participants: [
            { id: 'A', nickname: 'Other' }, { id: 'a', nickname: 'Same' }, { id: 'z', nickname: 'Same' },
        ] });
        roster.z.nickname = 'Changed';
        emit(service, 'participants', roster);
        expect(first.participants[2].nickname).toBe('Same');
        expect(changed.mock.calls[1][0].participants[2].nickname).toBe('Changed');
    });

    it.each([null, undefined, 'unknown', 3])('uses unavailable for invalid phase %p and a default missing title', phase => {
        const service = sdk();
        const changed = jest.fn();
        service.client.subscribe('party', changed, jest.fn());
        emit(service, 'title', null);
        emit(service, 'participants', null);
        emit(service, 'phase', phase);
        expect(changed).toHaveBeenLastCalledWith({ title: 'Birthday GeoGuess', phase: 'unavailable', participants: [] });
    });

    it.each([
        [], 'bad', { 'bad/uid': participant() }, { guest: null }, { guest: {} },
        { guest: participant(' Bad ') }, { guest: participant('😀'.repeat(21)) },
        { guest: participant('Name', 's51') }, { guest: { nickname: 'No slot' } },
        { a: participant('One'), b: participant('Two') },
        Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`guest_${i}`, participant('Guest')])),
    ])('fails closed on invalid roster %p', roster => {
        const service = sdk();
        const changed = jest.fn();
        service.client.subscribe('party', changed, jest.fn());
        initialize(service, roster);
        expect(changed).toHaveBeenLastCalledWith({ title: 'Birthday GeoGuess', phase: 'unavailable', participants: [] });
    });

    it('handles own prototype-like UIDs as normal participants', () => {
        const service = sdk();
        const changed = jest.fn();
        service.client.subscribe('party', changed, jest.fn());
        initialize(service, Object.fromEntries([
            ['__proto__', participant('Prototype', 's01')], ['constructor', participant('Constructor', 's02')],
        ]));
        expect(changed.mock.calls[0][0].participants).toEqual([
            { id: '__proto__', nickname: 'Prototype' }, { id: 'constructor', nickname: 'Constructor' },
        ]);
    });

    it('disposes idempotently with original handlers and ignores late values and errors', () => {
        const service = sdk();
        const changed = jest.fn();
        const errored = jest.fn();
        const dispose = service.client.subscribe('party', changed, errored);
        initialize(service);
        dispose();
        dispose();
        expect(service.off.mock.calls).toEqual(service.listeners.map(({ path, handler }) => [path, handler]));
        initialize(service, { guest: participant() }, 'complete');
        service.listeners[0].cancel(new Error('Late'));
        expect(changed).toHaveBeenCalledTimes(1);
        expect(errored).not.toHaveBeenCalled();
        expect(service.identity.ensureGuest).not.toHaveBeenCalled();
        expect(service.update).not.toHaveBeenCalled();
    });

    it('disposes all listeners and reports exactly one error without later stale emissions', () => {
        const service = sdk();
        const changed = jest.fn();
        const errored = jest.fn();
        const dispose = service.client.subscribe('party', changed, errored);
        initialize(service);
        const error = denied();
        service.listeners[1].cancel(error);
        service.listeners[2].cancel(error);
        initialize(service, null, 'complete');
        dispose();
        expect(errored.mock.calls).toEqual([[error]]);
        expect(service.off).toHaveBeenCalledTimes(3);
        expect(changed).toHaveBeenCalledTimes(1);
    });

    it('supports synchronous initial callbacks from on()', () => {
        const service = sdk();
        const changed = jest.fn();
        service.on.mockImplementation((path, handler) => handler(snap(path.endsWith('/phase') ? 'lobby' : null)));
        const dispose = service.client.subscribe('party', changed, jest.fn());
        expect(changed).toHaveBeenCalledTimes(1);
        expect(changed).toHaveBeenCalledWith({ title: 'Birthday GeoGuess', phase: 'lobby', participants: [] });
        dispose();
        expect(service.off).toHaveBeenCalledTimes(3);
    });

    it.each(['throw', 'cancel'])('cleans up if registration fails synchronously via %s', mode => {
        const service = sdk();
        const changed = jest.fn();
        const errored = jest.fn();
        const error = denied();
        const attached = new Set();
        service.off.mockImplementation((path, handler) => attached.delete(handler));
        service.on.mockImplementation((path, handler, cancel) => {
            if (path.endsWith('/phase')) {
                if (mode === 'cancel') cancel(error);
                attached.add(handler); // on() can finish installation after synchronous cancellation.
                if (mode === 'throw') throw error;
            } else attached.add(handler);
        });
        const dispose = service.client.subscribe('party', changed, errored);
        dispose();
        expect(attached.size).toBe(0);
        expect(service.database.ref).toHaveBeenCalledTimes(2);
        expect(errored.mock.calls).toEqual([[error]]);
        expect(changed).not.toHaveBeenCalled();
    });

    it('cleans up previous listeners when creating a later ref throws', () => {
        const service = sdk();
        const original = service.database.ref.getMockImplementation();
        const error = new Error('Invalid database');
        service.database.ref.mockImplementation(path => {
            if (path.endsWith('/phase')) throw error;
            return original(path);
        });
        const errored = jest.fn();
        service.client.subscribe('party', jest.fn(), errored);
        expect(service.off).toHaveBeenCalledTimes(1);
        expect(errored).toHaveBeenCalledWith(error);
    });

    it('rejects invalid event IDs before creating refs or authenticating', () => {
        const service = sdk();
        expect(() => service.client.subscribe('../private', jest.fn(), jest.fn())).toThrow('invalid-event-id');
        expect(service.database.ref).not.toHaveBeenCalled();
        expect(service.identity.ensureGuest).not.toHaveBeenCalled();
    });
});
