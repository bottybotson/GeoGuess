import { shallowMount } from '@vue/test-utils';
import EventGuestRound from '@/pages/event/EventGuestRound.vue';
import EventRoundPlay from '@/components/event/EventRoundPlay.vue';
import EventRoundResults from '@/components/event/EventRoundResults.vue';

const clue = { id: 'r1', panoramaId: 'fixture', heading: 37, pitch: -4 };
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const flush = async wrapper => { for (let i = 0; i < 8; i++) await Promise.resolve(); await wrapper.vm.$nextTick(); };
function fixture(phase = 'guessing', overrides = {}) {
    const client = {
        getRound: jest.fn().mockResolvedValue(clue),
        getOwnGuess: jest.fn().mockResolvedValue(null),
        getReveal: jest.fn().mockResolvedValue({ roundId: 'r1', answer: { lat: 1, lng: 2 }, results: {} }),
        submitGuess: jest.fn().mockResolvedValue({ status: 'submitted', guess: { lat: 1, lng: 2 } }),
        ...overrides,
    };
    const wrapper = shallowMount(EventGuestRound, { propsData: {
        eventId: 'fixture', phase, roundClient: client, mapsLoader: () => Promise.resolve({}),
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
