import { mount, shallowMount } from '@vue/test-utils';
import EventGuestRound from '@/pages/event/EventGuestRound.vue';
import EventRoundPlay from '@/components/event/EventRoundPlay.vue';
import EventRoundResults from '@/components/event/EventRoundResults.vue';
import EventGuessMap from '@/components/event/EventGuessMap.vue';

const clue = { id: 'r1', panoramaId: 'fixture', heading: 37, pitch: -4 };
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const flush = async wrapper => { for (let i = 0; i < 8; i++) await Promise.resolve(); await wrapper.vm.$nextTick(); };
function fixture(phase = 'guessing', overrides = {}, options = {}) {
    const client = {
        subscribeTiming: jest.fn((eventId, onChange, onError) => {
            const listener = { eventId, onChange, onError, dispose: jest.fn() };
            onChange({ timing: null, offsetMs: 0, connected: true });
            return listener.dispose;
        }),
        getRound: jest.fn().mockResolvedValue(clue),
        getOwnGuess: jest.fn().mockResolvedValue(null),
        getReveal: jest.fn().mockResolvedValue({ roundId: 'r1', answer: { lat: 1, lng: 2 }, results: {} }),
        submitGuess: jest.fn().mockResolvedValue({ status: 'submitted', guess: { lat: 1, lng: 2 } }),
        ...overrides,
    };
    const wrapper = (options.full ? mount : shallowMount)(EventGuestRound, {
        stubs: options.full ? { EventPanorama: true, EventRoundTimer: true } : {}, propsData: {
        eventId: 'fixture', phase, roundClient: client, mapsLoader: options.mapsLoader || (() => Promise.resolve({})),
    } });
    return { wrapper, client };
}

describe('guest round controller', () => {
    it('restores the accepted pin before enabling play', async () => {
        const { wrapper } = fixture('guessing', { getOwnGuess: jest.fn().mockResolvedValue({ lat: 3, lng: 4 }) });
        await flush(wrapper);
        expect(wrapper.findComponent(EventRoundPlay).props()).toMatchObject({
            round: clue, submissionState: 'accepted', submittedGuess: { lat: 3, lng: 4 },
        });
    });

    it('sends one request and uses the acknowledged original guess on retry', async () => {
        const sent = deferred();
        const { wrapper, client } = fixture('guessing', { submitGuess: jest.fn().mockReturnValue(sent.promise) });
        await flush(wrapper);
        const event = { roundId: 'r1', guess: { lat: 10, lng: 20 } };
        wrapper.findComponent(EventRoundPlay).vm.$emit('submit', event);
        wrapper.findComponent(EventRoundPlay).vm.$emit('submit', event);
        expect(client.submitGuess).toHaveBeenCalledTimes(1);
        sent.resolve({ status: 'already-submitted', guess: { lat: 1, lng: 2 } });
        await flush(wrapper);
        expect(wrapper.findComponent(EventRoundPlay).props('submittedGuess')).toEqual({ lat: 1, lng: 2 });
    });

    it('never submits after close and loads only public results after reveal', async () => {
        const { wrapper, client } = fixture('closed');
        await flush(wrapper);
        wrapper.findComponent(EventRoundPlay).vm.$emit('submit', { roundId: 'r1', guess: { lat: 1, lng: 2 } });
        expect(client.submitGuess).not.toHaveBeenCalled();
        await wrapper.setProps({ phase: 'reveal' });
        await flush(wrapper);
        expect(client.getReveal).toHaveBeenCalledWith('fixture');
        expect(wrapper.findComponent(EventRoundResults).exists()).toBe(true);
    });

    it('retains the actual Google map from guessing through close and authorized reveal', async () => {
        const map = { fitBounds: jest.fn(), setOptions: jest.fn() };
        const maps = {
            Map: jest.fn(() => map),
            Marker: jest.fn(() => ({ setPosition: jest.fn(), setMap: jest.fn() })),
            LatLngBounds: jest.fn(() => ({ extend: jest.fn() })),
            event: { addListener: jest.fn(() => ({ remove: jest.fn() })) },
        };
        const { wrapper, client } = fixture('guessing', {
            getOwnGuess: jest.fn().mockResolvedValue({ lat: 3, lng: 4 }),
        }, { full: true, mapsLoader: () => Promise.resolve(maps) });
        await flush(wrapper);
        const originalMap = wrapper.findComponent(EventGuessMap).vm;
        expect(maps.Map).toHaveBeenCalledTimes(1);
        await wrapper.setProps({ phase: 'closed' });
        await flush(wrapper);
        expect(wrapper.findComponent(EventGuessMap).vm).toBe(originalMap);
        expect(client.getReveal).not.toHaveBeenCalled();
        expect(wrapper.findComponent(EventGuessMap).props('answer')).toBe(null);
        await wrapper.setProps({ phase: 'reveal' });
        await flush(wrapper);
        expect(wrapper.findComponent(EventGuessMap).vm).toBe(originalMap);
        expect(maps.Map).toHaveBeenCalledTimes(1);
        expect(wrapper.findComponent(EventGuessMap).props()).toMatchObject({
            answer: { lat: 1, lng: 2 }, selected: { lat: 3, lng: 4 }, disabled: true,
        });
        expect(map.fitBounds).toHaveBeenCalled();
        expect(wrapper.find('.event-round-play__controls').exists()).toBe(false);
        expect(wrapper.findComponent(EventRoundResults).exists()).toBe(true);
        wrapper.destroy();
        expect(maps.event.addListener.mock.results[0].value.remove).toHaveBeenCalledTimes(1);
    });

    it.each([null, { lat: 3, lng: 4 }])('restores direct reveal refresh with accepted guess %p', async guess => {
        const { wrapper, client } = fixture('reveal', { getOwnGuess: jest.fn().mockResolvedValue(guess) });
        await flush(wrapper);
        expect(client.getRound).not.toHaveBeenCalled();
        expect(client.getOwnGuess).toHaveBeenCalledWith('fixture', 'r1');
        expect(wrapper.findComponent(EventRoundPlay).props()).toMatchObject({
            round: { id: 'r1' }, phase: 'reveal', submittedGuess: guess, answer: { lat: 1, lng: 2 },
        });
        expect(wrapper.findComponent(EventRoundResults).exists()).toBe(true);
        wrapper.destroy();
    });

    it('keeps textual results and reveal map retry accessible when the provider fails', async () => {
        const { wrapper } = fixture('reveal', {
            getReveal: jest.fn().mockResolvedValue({ roundId: 'r1', answer: { lat: 1, lng: 2 }, results: {
                guest: { nickname: 'No pin', answered: false, points: 0 },
            } }),
        }, { full: true, mapsLoader: () => Promise.reject(new Error('provider unavailable')) });
        await flush(wrapper);
        expect(wrapper.text()).toContain('could not be loaded');
        expect(wrapper.text()).toContain('Try again');
        expect(wrapper.text()).toContain('No answer · 0 points');
        expect(wrapper.findComponent(EventGuessMap).props('selected')).toBe(null);
        wrapper.destroy();
    });

    it('still shows the public reveal if restoring the saved guess fails, then retries it', async () => {
        const { wrapper, client } = fixture('reveal', {
            getOwnGuess: jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ lat: 3, lng: 4 }),
        });
        await flush(wrapper);
        expect(wrapper.findComponent(EventRoundResults).exists()).toBe(true);
        expect(wrapper.findComponent(EventRoundPlay).props()).toMatchObject({ answer: { lat: 1, lng: 2 }, submittedGuess: null });
        expect(wrapper.find('[role="alert"]').exists()).toBe(true);
        expect(client.submitGuess).not.toHaveBeenCalled();
        await wrapper.find('button').trigger('click');
        await flush(wrapper);
        expect(wrapper.findComponent(EventRoundPlay).props('submittedGuess')).toEqual({ lat: 3, lng: 4 });
        expect(wrapper.find('[role="alert"]').exists()).toBe(false);
        wrapper.destroy();
    });

    it.each(['event', 'client'])('clears the previous answer and ignores pending reveal after %s changes', async change => {
        const stale = deferred();
        const next = deferred();
        const { wrapper, client } = fixture('reveal');
        await flush(wrapper);
        expect(wrapper.findComponent(EventRoundResults).exists()).toBe(true);
        client.getReveal.mockReturnValueOnce(stale.promise);
        const previousRefresh = wrapper.vm.refresh();
        const replacement = { ...client, getReveal: jest.fn().mockReturnValue(next.promise) };
        if (change === 'event') {
            client.getReveal.mockReturnValueOnce(next.promise);
            await wrapper.setProps({ eventId: 'next' });
        } else {
            await wrapper.setProps({ roundClient: replacement });
        }
        await flush(wrapper);
        expect(wrapper.findComponent(EventRoundResults).exists()).toBe(false);
        expect(wrapper.findComponent(EventRoundPlay).exists()).toBe(false);
        stale.resolve({ roundId: 'r1', answer: { lat: 70, lng: 80 }, results: {} });
        await previousRefresh;
        await flush(wrapper);
        expect(wrapper.findComponent(EventRoundResults).exists()).toBe(false);
        next.resolve({ roundId: 'r1', answer: { lat: -1, lng: -2 }, results: {} });
        await flush(wrapper);
        expect(wrapper.findComponent(EventRoundPlay).props('answer')).toEqual({ lat: -1, lng: -2 });
        wrapper.destroy();
    });

    it('does not apply a reveal after phase changes or unmount and supports reveal retry', async () => {
        const pending = deferred();
        const { wrapper, client } = fixture('reveal', { getReveal: jest.fn().mockReturnValueOnce(pending.promise)
            .mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue({ roundId: 'r1', answer: { lat: 1, lng: 2 }, results: {} }) });
        await wrapper.setProps({ phase: 'closed' });
        await flush(wrapper);
        pending.resolve({ roundId: 'r1', answer: { lat: 70, lng: 80 }, results: {} });
        await flush(wrapper);
        expect(wrapper.findComponent(EventRoundPlay).props('answer')).toBe(null);
        expect(wrapper.findComponent(EventRoundResults).exists()).toBe(false);
        await wrapper.setProps({ phase: 'reveal' });
        await flush(wrapper);
        expect(wrapper.find('[role="alert"]').exists()).toBe(true);
        await wrapper.find('button').trigger('click');
        await flush(wrapper);
        expect(wrapper.findComponent(EventRoundResults).exists()).toBe(true);
        const late = deferred();
        client.getReveal.mockReturnValueOnce(late.promise);
        const request = wrapper.vm.refresh();
        wrapper.destroy();
        late.resolve({ roundId: 'r1', answer: { lat: 70, lng: 80 }, results: {} });
        await request;
        expect(wrapper.vm.reveal.answer).toEqual({ lat: 1, lng: 2 });
    });

    it('fails closed when timing is unknown or expired and preserves a restored accepted guess', async () => {
        const accepted = { lat: 3, lng: 4 };
        const { wrapper, client } = fixture('guessing', {
            getOwnGuess: jest.fn().mockResolvedValue(accepted),
            subscribeTiming: jest.fn((eventId, onChange) => {
                onChange({ timing: { roundId: 'r1', deadlineMs: Date.now() - 1 }, offsetMs: 0, connected: true });
                return jest.fn();
            }),
        });
        await flush(wrapper);
        expect(wrapper.findComponent(EventRoundPlay).props('phase')).toBe('closed');
        expect(wrapper.findComponent(EventRoundPlay).props('submittedGuess')).toEqual(accepted);
        wrapper.findComponent(EventRoundPlay).vm.$emit('submit', { roundId: 'r1', guess: accepted });
        expect(client.submitGuess).not.toHaveBeenCalled();
        wrapper.destroy();

        const unknown = fixture('guessing', {
            subscribeTiming: jest.fn((eventId, onChange) => {
                onChange({ timing: null, offsetMs: null, connected: false });
                return jest.fn();
            }),
        });
        await flush(unknown.wrapper);
        expect(unknown.wrapper.findComponent(EventRoundPlay).props('phase')).toBe('closed');
        unknown.wrapper.destroy();
    });

    it('retries a terminal timing subscription on the same client after explicit reconnect', async () => {
        const listeners = [];
        const subscribeTiming = jest.fn((eventId, onChange, onError) => {
            const listener = { onChange, onError, dispose: jest.fn() };
            listeners.push(listener);
            onChange({ timing: null, offsetMs: 0, connected: true });
            return listener.dispose;
        });
        const { wrapper } = fixture('guessing', { subscribeTiming });
        await flush(wrapper);
        listeners[0].onError(new Error('offline'));
        await wrapper.vm.$nextTick();
        expect(wrapper.find('[role="alert"]').exists()).toBe(true);
        expect(wrapper.find('button').text()).toBe('Retry connection');
        await wrapper.find('button').trigger('click');
        await flush(wrapper);
        expect(subscribeTiming).toHaveBeenCalledTimes(2);
        expect(listeners[0].dispose).toHaveBeenCalledTimes(1);
        expect(wrapper.find('[role="alert"]').exists()).toBe(false);
        wrapper.destroy();
        expect(listeners[1].dispose).toHaveBeenCalledTimes(1);
    });

    it('ignores a stale request after event change and provides explicit retry on error', async () => {
        const first = deferred();
        const { wrapper, client } = fixture('guessing', { getRound: jest.fn().mockReturnValueOnce(first.promise).mockResolvedValue(clue) });
        await wrapper.setProps({ eventId: 'next' });
        await flush(wrapper);
        first.resolve({ ...clue, panoramaId: 'stale' });
        await flush(wrapper);
        expect(wrapper.findComponent(EventRoundPlay).props('round')).toEqual(clue);
        client.getRound.mockRejectedValueOnce(new Error('private provider details'));
        await wrapper.vm.refresh();
        expect(wrapper.text()).not.toContain('private provider details');
        expect(wrapper.find('button').text()).toBe('Retry connection');
        await wrapper.find('button').trigger('click');
        await flush(wrapper);
        expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    });
});
