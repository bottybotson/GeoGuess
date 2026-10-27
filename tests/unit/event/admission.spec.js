import { MAX_GUESTS, planAdmission } from '@/event/admission';

const makeState = (overrides = {}) => ({
    hostUid: 'host_1',
    phase: 'lobby',
    participants: {},
    ...overrides,
});

const deepFreeze = value => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.values(value).forEach(deepFreeze);
        Object.freeze(value);
    }
    return value;
};

describe('event lobby admission policy', () => {
    it('exports the fixed guest cap', () => {
        expect(MAX_GUESTS).toBe(50);
    });

    it('admits 50 distinct guests sequentially and rejects guest 51', () => {
        let state = makeState();

        for (let index = 1; index <= MAX_GUESTS; index += 1) {
            const result = planAdmission(state, { uid: `guest_${index}`, nickname: ` Guest ${index} ` });
            expect(result.status).toBe('joined');
            expect(result.nextState.participants[`guest_${index}`]).toEqual({ nickname: `Guest ${index}` });
            state = result.nextState;
        }

        const fullResult = planAdmission(state, { uid: 'guest_51', nickname: 'Late guest' });
        expect(fullResult).toEqual({ status: 'full', nextState: null });
        expect(Object.keys(state.participants)).toHaveLength(MAX_GUESTS);
    });

    it('trims a new guest nickname and preserves unrelated state and participant data', () => {
        const state = deepFreeze({
            ...makeState({
                metadata: { event: 'birthday' },
                participants: { existing: { nickname: 'Existing', score: 42 } },
            }),
        });

        const result = planAdmission(state, { uid: 'new_guest', nickname: '  New Guest  ' });

        expect(result.status).toBe('joined');
        expect(result.nextState).not.toBe(state);
        expect(result.nextState.participants).not.toBe(state.participants);
        expect(result.nextState).toEqual({
            hostUid: 'host_1',
            phase: 'lobby',
            metadata: { event: 'birthday' },
            participants: {
                existing: { nickname: 'Existing', score: 42 },
                new_guest: { nickname: 'New Guest' },
            },
        });
        expect(state.participants).toEqual({ existing: { nickname: 'Existing', score: 42 } });
    });

    it.each(['lobby', 'guessing', 'reveal', 'complete'])(
        'rejoins an existing guest in %s without changing state or consuming a slot',
        phase => {
            const state = deepFreeze({
                ...makeState({
                    phase,
                    participants: { guest_1: { nickname: 'Original', score: 7, extra: { rounds: 2 } } },
                }),
            });

            const result = planAdmission(state, { uid: 'guest_1', nickname: 'Replacement' });

            expect(result).toEqual({ status: 'rejoined', nextState: state });
            expect(result.nextState).toBe(state);
            expect(result.nextState.participants.guest_1).toEqual({
                nickname: 'Original',
                score: 7,
                extra: { rounds: 2 },
            });
        },
    );

    it('rejoins an existing guest at capacity without changing state', () => {
        const participants = {};
        for (let index = 1; index <= MAX_GUESTS; index += 1) {
            participants[`guest_${index}`] = { nickname: `Guest ${index}` };
        }
        const state = deepFreeze(makeState({ participants }));

        const result = planAdmission(state, { uid: 'guest_50', nickname: 'Replacement' });

        expect(result).toEqual({ status: 'rejoined', nextState: state });
        expect(result.nextState).toBe(state);
        expect(result.nextState.participants.guest_50.nickname).toBe('Guest 50');
    });

    it('lets the host bypass guest admission without taking a slot', () => {
        const state = makeState();
        expect(planAdmission(state, { uid: 'host_1', nickname: 'Host' })).toEqual({ status: 'host', nextState: null });
        expect(state.participants).toEqual({});
    });

    it('rejects new guests after the lobby starts before validating their nickname', () => {
        for (const phase of ['guessing', 'reveal', 'complete']) {
            expect(planAdmission(makeState({ phase }), { uid: 'late_guest' })).toEqual({
                status: 'started',
                nextState: null,
            });
        }
    });

    it('rejects malformed state and missing or invalid request identities', () => {
        const valid = makeState();
        const invalidStates = [
            null,
            [],
            { ...valid, hostUid: 'bad uid' },
            { ...valid, phase: 'unknown' },
            { ...valid, participants: null },
            { ...valid, participants: [] },
            { hostUid: 'host_1', phase: 'lobby' },
            { ...valid, participants: { 'bad uid': { nickname: 'Guest' } } },
            { ...valid, participants: { host_1: { nickname: 'Guest' } } },
            { ...valid, participants: { guest_1: { nickname: ' Guest ' } } },
            { ...valid, participants: { guest_1: { nickname: '' } } },
            {
                ...valid,
                participants: Object.fromEntries(
                    Array.from({ length: MAX_GUESTS + 1 }, (_, index) => [
                        `guest_${index + 1}`,
                        { nickname: 'Guest' },
                    ]),
                ),
            },
        ];

        invalidStates.forEach(state => {
            expect(planAdmission(state, { uid: 'new_guest', nickname: 'Guest' })).toEqual({
                status: 'invalid',
                nextState: null,
            });
        });

        for (const request of [null, [], {}, { uid: '' }, { uid: 'bad uid' }, { uid: 3 }]) {
            expect(planAdmission(valid, request)).toEqual({ status: 'invalid', nextState: null });
        }
    });

    it('trims nicknames and counts Unicode code points at the 1–20 boundary', () => {
        expect(planAdmission(makeState(), { uid: 'one', nickname: ' 😀 ' }).nextState.participants.one.nickname).toBe(
            '😀',
        );
        expect(
            planAdmission(makeState(), { uid: 'twenty', nickname: '😀'.repeat(20) }).status,
        ).toBe('joined');
        expect(planAdmission(makeState(), { uid: 'twenty_one', nickname: '😀'.repeat(21) })).toEqual({
            status: 'invalid',
            nextState: null,
        });
        expect(planAdmission(makeState(), { uid: 'empty', nickname: ' \t\n ' })).toEqual({
            status: 'invalid',
            nextState: null,
        });
        expect(planAdmission(makeState(), { uid: 'number', nickname: 12 })).toEqual({
            status: 'invalid',
            nextState: null,
        });
    });

    it('accepts identity UIDs of 128 characters and rejects 129 characters', () => {
        const uid128 = 'a'.repeat(128);
        const uid129 = 'a'.repeat(129);

        expect(planAdmission(makeState(), { uid: uid128, nickname: 'Guest' }).status).toBe('joined');
        expect(planAdmission(makeState(), { uid: uid129, nickname: 'Guest' })).toEqual({
            status: 'invalid',
            nextState: null,
        });
    });

    it('uses only own participant entries for membership and capacity', () => {
        const inherited = { inherited_guest: { nickname: 'Inherited' } };
        const participants = Object.assign(Object.create(inherited), { own_guest: { nickname: 'Own' } });
        const state = makeState({ participants });

        const result = planAdmission(state, { uid: 'inherited_guest', nickname: 'Now admitted' });

        expect(result.status).toBe('joined');
        expect(Object.keys(result.nextState.participants)).toEqual(['own_guest', 'inherited_guest']);
        expect(Object.prototype.hasOwnProperty.call(state.participants, 'inherited_guest')).toBe(false);
    });

    it.each(['constructor', '__proto__'])(
        'safely admits the prototype-like identity %s as an own participant key',
        uid => {
            const state = deepFreeze(makeState({ participants: Object.create(null) }));
            const result = planAdmission(state, { uid, nickname: 'Safe' });

            expect(result.status).toBe('joined');
            expect(Object.prototype.hasOwnProperty.call(result.nextState.participants, uid)).toBe(true);
            expect(result.nextState.participants[uid]).toEqual({ nickname: 'Safe' });
            expect(Object.getPrototypeOf(result.nextState.participants)).toBe(Object.prototype);
            expect(Object.prototype.hasOwnProperty.call(state.participants, uid)).toBe(false);
        },
    );

    it.each(['constructor', '__proto__'])(
        'recognizes the own prototype-like identity %s as a rejoin',
        uid => {
            const participants = Object.create(null);
            Object.defineProperty(participants, uid, {
                value: { nickname: 'Original', score: 9 },
                enumerable: true,
                writable: false,
            });
            const state = deepFreeze(makeState({ participants }));

            const result = planAdmission(state, { uid, nickname: 'Replacement' });

            expect(result).toEqual({ status: 'rejoined', nextState: state });
            expect(result.nextState).toBe(state);
            expect(result.nextState.participants[uid]).toEqual({ nickname: 'Original', score: 9 });
        },
    );

    it('returns invalid plans without mutating frozen inputs and leaves them unchanged across calls', () => {
        const state = deepFreeze(makeState({ participants: { guest_1: { nickname: 'Guest' } } }));
        const request = deepFreeze({ uid: 'new_guest', nickname: '  ' });

        expect(planAdmission(state, request)).toEqual({ status: 'invalid', nextState: null });
        expect(planAdmission(state, request)).toEqual({ status: 'invalid', nextState: null });
        expect(state.participants).toEqual({ guest_1: { nickname: 'Guest' } });
    });

    it('does not mutate frozen state or request inputs when joining', () => {
        const state = deepFreeze(makeState({ participants: { existing: { nickname: 'Existing' } } }));
        const request = deepFreeze({ uid: 'new_guest', nickname: '  New Guest  ' });

        const first = planAdmission(state, request);
        const second = planAdmission(state, request);

        expect(first.status).toBe('joined');
        expect(first.nextState.participants.new_guest).toEqual({ nickname: 'New Guest' });
        expect(second.nextState).not.toBe(first.nextState);
        expect(state.participants).toEqual({ existing: { nickname: 'Existing' } });
        expect(request.nickname).toBe('  New Guest  ');
    });
});
