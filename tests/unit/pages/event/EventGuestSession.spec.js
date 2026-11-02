import { mount, shallowMount } from '@vue/test-utils';
import EventGuestSession from '@/pages/event/EventGuestSession.vue';
import EventRoundPlay from '@/components/event/EventRoundPlay.vue';
import EventGuessMap from '@/components/event/EventGuessMap.vue';
import EventRoundResults from '@/components/event/EventRoundResults.vue';

const clue = id => ({ id, panoramaId: `fixture-${id}`, heading: 37, pitch: -4 });
const reveal = id => ({ roundId: id, answer: { lat: 1, lng: 2 }, results: {
    guest: { nickname: 'Alex', answered: false, points: 0, totalPoints: id === 'r01' ? 0 : 100 },
} });
const state = (phase = 'guessing', roundId = 'r01') => {
    const index = Number(roundId.slice(1));
    const revision = { lobby: 0, ready: index * 4 - 4, guessing: index * 4 - 3,
        closed: index * 4 - 2, reveal: index * 4 - 1, complete: index * 4 }[phase];
    return { phase, roundId, revision, roundCount: 2,
        ...(['reveal', 'complete'].includes(phase) ? { lastRevealedRoundId: roundId } :
            index > 1 ? { lastRevealedRoundId: 'r01' } : {}) };
};
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async wrapper => { for (let i = 0; i < 12; i++) await Promise.resolve(); await wrapper.vm.$nextTick(); };
function fixture(initialState = state(), overrides = {}, options = {}) {
    const listeners = [];
    const client = {
        subscribeTiming: jest.fn((eventId, roundId, onChange, onError) => {
            const listener = { eventId, roundId, onChange, onError, dispose: jest.fn() };
            listeners.push(listener);
            onChange({ timing: null, offsetMs: 0, connected: true });
            return listener.dispose;
        }),
        getClue: jest.fn((eventId, id) => Promise.resolve(clue(id))),
        getOwnGuess: jest.fn().mockResolvedValue(null),
        getReveal: jest.fn((eventId, id) => Promise.resolve(reveal(id))),
        submitGuess: jest.fn().mockResolvedValue({ status: 'submitted', guess: { lat: 3, lng: 4 } }),
        ...overrides,
    };
    const wrapper = (options.full ? mount : shallowMount)(EventGuestSession, {
        propsData: { eventId: 'fixture', state: initialState, sessionClient: client,
            mapsLoader: options.mapsLoader || (() => Promise.resolve({})) },
        stubs: options.full ? { EventPanorama: true, EventRoundTimer: true } : {},
    });
    return { wrapper, client, listeners };
}

describe('v2 guest session', () => {
    it('makes no clue, guess or timing reads in lobby/ready and rejects r1 and malformed atomic state', async () => {
        const { wrapper, client } = fixture(state('lobby'));
        await flush(wrapper);
        expect(wrapper.text()).toContain('Round 1 of 2');
        expect(wrapper.text()).toContain('host will start');
        await wrapper.setProps({ state: state('ready', 'r02') });
        await flush(wrapper);
        expect(wrapper.text()).toContain('Round 2 of 2');
        expect(wrapper.text()).toContain('Wait for the host');
        expect(client.getClue).not.toHaveBeenCalled();
        expect(client.getOwnGuess).not.toHaveBeenCalled();
        expect(client.getReveal).not.toHaveBeenCalled();
        expect(client.subscribeTiming).not.toHaveBeenCalled();
        await wrapper.setProps({ state: { ...state(), roundId: 'r1' } });
        await flush(wrapper);
        expect(wrapper.text()).toContain('Event status is unavailable');
        await wrapper.setProps({ state: { ...state(), revision: 8 } });
        await flush(wrapper);
        expect(client.getClue).not.toHaveBeenCalled();
        wrapper.destroy();
    });

    it('restores the current immutable guess before play and submits only one acknowledged original pin', async () => {
        const sent = deferred();
        const { wrapper, client } = fixture(state(), { submitGuess: jest.fn().mockReturnValue(sent.promise) });
        await flush(wrapper);
        expect(client.getClue).toHaveBeenCalledWith('fixture', 'r01');
        expect(client.getOwnGuess).toHaveBeenCalledWith('fixture', 'r01');
        const payload = { roundId: 'r01', guess: { lat: 10, lng: 20 } };
        wrapper.findComponent(EventRoundPlay).vm.$emit('submit', payload);
        wrapper.findComponent(EventRoundPlay).vm.$emit('submit', payload);
        expect(client.submitGuess).toHaveBeenCalledTimes(1);
        expect(client.submitGuess).toHaveBeenCalledWith('fixture', 'r01', payload.guess);
        sent.resolve({ status: 'already-submitted', guess: { lat: 3, lng: 4 } });
        await flush(wrapper);
        expect(wrapper.findComponent(EventRoundPlay).props()).toMatchObject({
            submissionState: 'accepted', submittedGuess: { lat: 3, lng: 4 },
        });
        client.getOwnGuess.mockResolvedValue(null);
        await wrapper.vm.refresh();
        expect(wrapper.findComponent(EventRoundPlay).props('submittedGuess')).toEqual({ lat: 3, lng: 4 });
        wrapper.destroy();
    });

    it('keeps the actual map and unsaved selection through close, reveals no fake guess, then resets for the successor', async () => {
        const maps = {
            Map: jest.fn(() => ({ fitBounds: jest.fn(), setOptions: jest.fn() })),
            Marker: jest.fn(() => ({ setPosition: jest.fn(), setMap: jest.fn() })),
            LatLngBounds: jest.fn(() => ({ extend: jest.fn() })),
            event: { addListener: jest.fn(() => ({ remove: jest.fn() })) },
        };
        const { wrapper, client, listeners } = fixture(state(), {}, { full: true, mapsLoader: () => Promise.resolve(maps) });
        await flush(wrapper);
        const originalMap = wrapper.findComponent(EventGuessMap).vm;
        const originalPlay = wrapper.findComponent(EventRoundPlay).vm;
        originalPlay.selectGuess({ lat: 10, lng: 20 });
        await wrapper.vm.$nextTick();
        await wrapper.setProps({ state: state('closed') });
        await flush(wrapper);
        expect(wrapper.findComponent(EventGuessMap).vm).toBe(originalMap);
        expect(originalPlay.selection).toEqual({ lat: 10, lng: 20 });
        expect(client.getReveal).not.toHaveBeenCalled();
        expect(listeners[0].dispose).toHaveBeenCalledTimes(1);
        await wrapper.setProps({ state: state('reveal') });
        await flush(wrapper);
        expect(wrapper.findComponent(EventGuessMap).vm).toBe(originalMap);
        expect(maps.Map).toHaveBeenCalledTimes(1);
        expect(wrapper.findComponent(EventGuessMap).props()).toMatchObject({ answer: { lat: 1, lng: 2 }, selected: null, disabled: true });
        expect(wrapper.text()).toContain('No answer');
        expect(client.submitGuess).not.toHaveBeenCalled();
        await wrapper.setProps({ state: state('ready', 'r02') });
        await flush(wrapper);
        expect(wrapper.findComponent(EventRoundPlay).exists()).toBe(false);
        expect(client.getClue).toHaveBeenCalledTimes(1);
        await wrapper.setProps({ state: state('guessing', 'r02') });
        await flush(wrapper);
        expect(wrapper.findComponent(EventRoundPlay).vm.selection).toBe(null);
        expect(wrapper.findComponent(EventGuessMap).vm).not.toBe(originalMap);
        expect(client.getClue).toHaveBeenLastCalledWith('fixture', 'r02');
        expect(client.getOwnGuess).toHaveBeenLastCalledWith('fixture', 'r02');
        expect(listeners[1].roundId).toBe('r02');
        await wrapper.setProps({ state: state('reveal', 'r02') });
        await flush(wrapper);
        await wrapper.setProps({ state: state('complete', 'r02') });
        await flush(wrapper);
        expect(wrapper.findComponent(EventRoundResults).props()).toMatchObject({ cumulative: true, final: true });
        expect(wrapper.text()).toContain('final standings');
        expect(client.getReveal.mock.calls).toEqual([['fixture', 'r01'], ['fixture', 'r02']]);
        wrapper.destroy();
    });

    it.each(['guessing', 'reveal', 'complete'])('restores round 2 on %s refresh with its own saved guess', async phase => {
        const { wrapper, client } = fixture(state(phase, 'r02'), { getOwnGuess: jest.fn().mockResolvedValue({ lat: 3, lng: 4 }) });
        await flush(wrapper);
        expect(wrapper.findComponent(EventRoundPlay).props()).toMatchObject({
            round: phase === 'guessing' ? clue('r02') : { id: 'r02' }, submissionState: 'accepted', submittedGuess: { lat: 3, lng: 4 },
        });
        expect(client.getOwnGuess).toHaveBeenCalledWith('fixture', 'r02');
        if (phase === 'guessing') expect(client.getReveal).not.toHaveBeenCalled();
        else {
            expect(client.getClue).not.toHaveBeenCalled();
            expect(client.getReveal).toHaveBeenCalledWith('fixture', 'r02');
            expect(wrapper.findComponent(EventRoundResults).props('cumulative')).toBe(true);
        }
        wrapper.destroy();
    });

    it.each(['round', 'event', 'client', 'unmount'])('ignores delayed clue, guess and timing from a previous %s scope', async change => {
        const oldClue = deferred();
        const oldGuess = deferred();
        const { wrapper, client, listeners } = fixture(state(), {
            getClue: jest.fn().mockImplementation((eventId, id) => Promise.resolve(clue(id))).mockReturnValueOnce(oldClue.promise),
            getOwnGuess: jest.fn().mockReturnValueOnce(oldGuess.promise).mockResolvedValue(null),
        });
        const oldTiming = listeners[0];
        if (change === 'round') await wrapper.setProps({ state: state('guessing', 'r02') });
        if (change === 'event') await wrapper.setProps({ eventId: 'other' });
        if (change === 'client') await wrapper.setProps({ sessionClient: { ...client, getClue: jest.fn().mockResolvedValue(clue('r01')) } });
        if (change === 'unmount') wrapper.destroy();
        await flush(wrapper);
        oldClue.resolve(clue('r01'));
        oldGuess.resolve({ lat: 80, lng: 90 });
        oldTiming.onChange({ timing: { roundId: 'r01', deadlineMs: 0 }, connected: true, offsetMs: 9999 });
        await flush(wrapper);
        expect(wrapper.vm.submittedGuess).toBe(null);
        if (change !== 'unmount') {
            expect(wrapper.vm.timingOffsetMs).toBe(0);
            expect(wrapper.findComponent(EventRoundPlay).props('round').id).toBe(change === 'round' ? 'r02' : 'r01');
            wrapper.destroy();
        }
        expect(oldTiming.dispose).toHaveBeenCalledTimes(1);
    });

    it('ignores delayed previous-round reveal and submission replies', async () => {
        const pendingReveal = deferred();
        const pendingSubmit = deferred();
        const { wrapper, client } = fixture(state(), {
            submitGuess: jest.fn().mockReturnValue(pendingSubmit.promise),
            getReveal: jest.fn().mockReturnValueOnce(pendingReveal.promise).mockResolvedValue(reveal('r02')),
        });
        await flush(wrapper);
        wrapper.findComponent(EventRoundPlay).vm.$emit('submit', { roundId: 'r01', guess: { lat: 10, lng: 20 } });
        await wrapper.setProps({ state: state('reveal') });
        await flush(wrapper);
        await wrapper.setProps({ state: state('guessing', 'r02') });
        await flush(wrapper);
        pendingSubmit.resolve({ status: 'submitted', guess: { lat: 10, lng: 20 } });
        pendingReveal.resolve(reveal('r01'));
        await flush(wrapper);
        expect(wrapper.findComponent(EventRoundPlay).props()).toMatchObject({ round: clue('r02'), submittedGuess: null });
        expect(wrapper.findComponent(EventRoundResults).exists()).toBe(false);
        expect(client.getOwnGuess).toHaveBeenLastCalledWith('fixture', 'r02');
        wrapper.destroy();
    });

    it('disables guessing on expired/offline/unknown timing and resumes after a host extension', async () => {
        const { wrapper, client, listeners } = fixture();
        await flush(wrapper);
        const play = () => wrapper.findComponent(EventRoundPlay);
        const send = () => play().vm.$emit('submit', { roundId: 'r01', guess: { lat: 1, lng: 2 } });
        listeners[0].onChange({ timing: { roundId: 'r01', deadlineMs: Date.now() - 1 }, connected: true, offsetMs: 0 });
        await wrapper.vm.$nextTick();
        expect(play().props('phase')).toBe('closed');
        send();
        listeners[0].onChange({ timing: null, connected: false, offsetMs: null });
        await wrapper.vm.$nextTick();
        expect(play().props('phase')).toBe('closed');
        send();
        listeners[0].onChange({ timing: { roundId: 'r02', deadlineMs: Date.now() + 10000 }, connected: true, offsetMs: 0 });
        await wrapper.vm.$nextTick();
        expect(play().props('phase')).toBe('closed');
        send();
        expect(client.submitGuess).not.toHaveBeenCalled();
        listeners[0].onChange({ timing: { roundId: 'r01', deadlineMs: Date.now() + 10000 }, connected: true, offsetMs: 0 });
        await wrapper.vm.$nextTick();
        expect(play().props('phase')).toBe('guessing');
        send();
        await flush(wrapper);
        expect(client.submitGuess).toHaveBeenCalledTimes(1);
        wrapper.destroy();
    });

    it('shows published results when own-guess restoration fails and retries without advancing', async () => {
        const { wrapper, client } = fixture(state('reveal'), {
            getOwnGuess: jest.fn().mockRejectedValueOnce(new Error('private detail')).mockResolvedValue({ lat: 3, lng: 4 }),
        });
        await flush(wrapper);
        expect(wrapper.findComponent(EventRoundResults).exists()).toBe(true);
        expect(wrapper.find('[role="alert"]').exists()).toBe(true);
        expect(wrapper.text()).not.toContain('private detail');
        await wrapper.find('button').trigger('click');
        await flush(wrapper);
        expect(wrapper.findComponent(EventRoundPlay).props('submittedGuess')).toEqual({ lat: 3, lng: 4 });
        expect(wrapper.find('[role="alert"]').exists()).toBe(false);
        expect(client.submitGuess).not.toHaveBeenCalled();
        wrapper.destroy();
    });

    it('does not accept a successful status without an acknowledged real guess', async () => {
        const { wrapper, client } = fixture(state(), { submitGuess: jest.fn().mockResolvedValue({ status: 'submitted' }) });
        await flush(wrapper);
        wrapper.findComponent(EventRoundPlay).vm.$emit('submit', { roundId: 'r1', guess: { lat: 1, lng: 2 } });
        expect(client.submitGuess).not.toHaveBeenCalled();
        wrapper.findComponent(EventRoundPlay).vm.$emit('submit', { roundId: 'r01', guess: { lat: 1, lng: 2 } });
        await flush(wrapper);
        expect(wrapper.findComponent(EventRoundPlay).props()).toMatchObject({ submissionState: 'error', submittedGuess: null });
        wrapper.destroy();
    });
});
