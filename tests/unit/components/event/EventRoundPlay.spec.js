import { mount } from '@vue/test-utils';
import EventRoundPlay from '@/components/event/EventRoundPlay.vue';

const round = { id: 'r1', panoramaId: 'pano-1', heading: 90, pitch: 2 };
const mapStub = {
    props: ['selected', 'disabled', 'mapsLoader', 'answer', 'active', 'fill', 'gestureHandling'],
    template: '<button class="map-stub" :disabled="disabled" @click="$emit(\'select\', { lat: 10, lng: 20 })">map</button>',
};
const panoramaStub = { props: ['round', 'mapsLoader', 'active', 'fill'], template: '<div class="panorama-stub"></div>' };
function create(propsData = {}) {
    return mount(EventRoundPlay, {
        propsData: { round, phase: 'guessing', mapsLoader: () => Promise.resolve({}), ...propsData },
        stubs: { EventGuessMap: mapStub, EventPanorama: panoramaStub },
    });
}

describe('EventRoundPlay', () => {
    it('lets a player select and submit once with the round ID and plain pin coordinates', async () => {
        const wrapper = create();
        await wrapper.find('.map-stub').trigger('click');
        expect(wrapper.find('.event-round-play__submit').attributes('disabled')).toBeUndefined();
        await wrapper.find('.event-round-play__submit').trigger('click');
        await wrapper.find('.event-round-play__submit').trigger('click');
        expect(wrapper.emitted('submit')).toEqual([[{ roundId: 'r1', guess: { lat: 10, lng: 20 } }]]);
        expect(Object.getPrototypeOf(wrapper.emitted('submit')[0][0].guess)).toBe(Object.prototype);
        expect(wrapper.text()).toContain('Submitting your guess…');
        wrapper.destroy();
    });

    it('locks the local pin immediately on submit, before parent state updates', async () => {
        const wrapper = create();
        wrapper.vm.selectGuess({ lat: 10, lng: 20 });
        wrapper.vm.submitGuess();
        wrapper.vm.selectGuess({ lat: -30, lng: 150 });

        expect(wrapper.vm.canEdit).toBe(false);
        expect(wrapper.vm.selection).toEqual({ lat: 10, lng: 20 });
        expect(wrapper.emitted('submit')).toEqual([[{ roundId: 'r1', guess: { lat: 10, lng: 20 } }]]);
        await wrapper.vm.$nextTick();
        expect(wrapper.findComponent(mapStub).props('disabled')).toBe(true);
        expect(wrapper.findComponent(mapStub).props('selected')).toEqual({ lat: 10, lng: 20 });
        wrapper.destroy();
    });

    it('blocks guesses until selection, and while pending, accepted, or closed', async () => {
        const wrapper = create();
        expect(wrapper.find('.event-round-play__submit').element.disabled).toBe(true);
        await wrapper.find('.map-stub').trigger('click');
        await wrapper.setProps({ submissionState: 'submitting' });
        expect(wrapper.find('.event-round-play__submit').element.disabled).toBe(true);
        expect(wrapper.find('.map-stub').element.disabled).toBe(true);
        await wrapper.setProps({ submissionState: 'accepted' });
        expect(wrapper.text()).toContain('Your guess is saved.');
        await wrapper.setProps({ phase: 'closed', submissionState: 'idle' });
        expect(wrapper.find('.event-round-play__submit').element.disabled).toBe(true);
        expect(wrapper.text()).toContain('This round is closed for guesses.');
        wrapper.destroy();
    });

    it('allows an explicit retry after an error and does not permit a synchronous duplicate', async () => {
        const wrapper = create();
        await wrapper.find('.map-stub').trigger('click');
        await wrapper.find('.event-round-play__submit').trigger('click');
        await wrapper.setProps({ submissionState: 'error' });
        expect(wrapper.text()).toContain('Check your connection, then retry.');
        await wrapper.find('.event-round-play__submit').trigger('click');
        expect(wrapper.emitted('submit')).toHaveLength(2);
        wrapper.destroy();
    });

    it('shows the server-acknowledged pin when an earlier accepted write arrives late', async () => {
        const wrapper = create();
        await wrapper.find('.map-stub').trigger('click');
        await wrapper.find('.event-round-play__submit').trigger('click');
        await wrapper.setProps({ submissionState: 'accepted', submittedGuess: { lat: -40, lng: 120 } });
        expect(wrapper.findComponent(mapStub).props('selected')).toEqual({ lat: -40, lng: 120 });
        expect(wrapper.text()).toContain('Your guess is saved.');
        wrapper.destroy();
    });

    it('gates the answer on reveal, keeps the same map and hides guessing actions', async () => {
        const answer = { lat: -1, lng: -2 };
        const saved = { lat: 3, lng: 4 };
        const wrapper = create({ answer });
        const map = wrapper.findComponent(mapStub).vm;
        expect(wrapper.findComponent(mapStub).props('answer')).toBe(null);
        await wrapper.find('.map-stub').trigger('click');
        await wrapper.setProps({ phase: 'closed' });
        expect(wrapper.findComponent(mapStub).vm).toBe(map);
        expect(wrapper.findComponent(mapStub).props('answer')).toBe(null);
        expect(wrapper.find('.event-round-play__instruction').exists()).toBe(false);
        await wrapper.setProps({ phase: 'reveal' });
        expect(wrapper.findComponent(mapStub).vm).toBe(map);
        expect(wrapper.findComponent(mapStub).props()).toMatchObject({ answer, disabled: true, selected: null });
        expect(wrapper.find('.event-round-play__controls').exists()).toBe(false);
        expect(wrapper.find('.panorama-stub').exists()).toBe(false);
        await wrapper.setProps({ submittedGuess: saved, submissionState: 'accepted' });
        wrapper.vm.selectGuess({ lat: 8, lng: 9 });
        wrapper.vm.submitGuess();
        expect(wrapper.findComponent(mapStub).props('selected')).toEqual(saved);
        expect(wrapper.emitted('submit')).toBeUndefined();
        wrapper.destroy();
    });

    it('supports a direct reveal without requiring a Street View clue', () => {
        const wrapper = create({ round: { id: 'r1' }, phase: 'reveal', answer: { lat: 0, lng: 0 } });
        expect(wrapper.findComponent(mapStub).props('answer')).toEqual({ lat: 0, lng: 0 });
        expect(wrapper.find('.event-round-play__controls').exists()).toBe(false);
        wrapper.destroy();
    });

    it('switches mobile views with one tap, retaining components and pin without submitting', async () => {
        const originalMatchMedia = window.matchMedia;
        window.matchMedia = jest.fn(() => ({ matches: true }));
        const wrapper = create();
        await wrapper.vm.$nextTick();
        const map = wrapper.findComponent(mapStub).vm;
        const panorama = wrapper.findComponent(panoramaStub).vm;
        const views = wrapper.findAll('.event-round-play__views button');
        expect(views.wrappers.map(view => view.text())).toEqual(['Explore', 'Guess']);
        expect(views.at(0).attributes('aria-pressed')).toBe('true');
        expect(wrapper.findComponent(mapStub).props()).toMatchObject({ active: false, disabled: true, fill: true, gestureHandling: 'greedy' });
        // A late event from a hidden map must not move the selected pin.
        wrapper.vm.selectGuess({ lat: 1, lng: 2 });
        expect(wrapper.vm.selection).toBe(null);
        await views.at(1).trigger('click');
        await wrapper.find('.map-stub').trigger('click');
        expect(views.at(1).attributes('aria-pressed')).toBe('true');
        await views.at(0).trigger('click');
        expect(wrapper.text()).toContain('Your selected pin is kept on Guess.');
        expect(wrapper.findComponent(panoramaStub).props('active')).toBe(true);
        await views.at(1).trigger('click');
        expect(wrapper.findComponent(mapStub).vm._uid).toBe(map._uid);
        expect(wrapper.findComponent(panoramaStub).vm._uid).toBe(panorama._uid);
        expect(wrapper.findComponent(mapStub).props('selected')).toEqual({ lat: 10, lng: 20 });
        expect(wrapper.emitted('submit')).toBeUndefined();
        await wrapper.find('.event-round-play__submit').trigger('click');
        await wrapper.setProps({ submissionState: 'accepted', submittedGuess: { lat: 10, lng: 20 } });
        await views.at(0).trigger('click');
        expect(wrapper.text()).toContain('Your guess is saved.');
        await views.at(1).trigger('click');
        expect(wrapper.findComponent(mapStub).props('disabled')).toBe(true);
        await wrapper.setProps({ phase: 'closed' });
        await wrapper.setProps({ phase: 'reveal', answer: { lat: 30, lng: 40 } });
        expect(wrapper.findComponent(mapStub).vm._uid).toBe(map._uid);
        expect(wrapper.findComponent(mapStub).props('selected')).toEqual({ lat: 10, lng: 20 });
        expect(wrapper.emitted('submit')).toHaveLength(1);
        wrapper.destroy();
        window.matchMedia = originalMatchMedia;
    });

    it('returns to Explore and replaces the guess map only for a new round', async () => {
        const wrapper = create();
        await wrapper.setData({ mobile: true, activeView: 'guess' });
        wrapper.vm.selectGuess({ lat: 10, lng: 20 });
        const originalMap = wrapper.findComponent(mapStub).vm;
        await wrapper.setProps({ round: { ...round, id: 'r2' } });
        expect(wrapper.vm.activeView).toBe('explore');
        expect(wrapper.vm.selection).toBe(null);
        expect(originalMap._isDestroyed).toBe(true);
        expect(wrapper.findComponent(mapStub).vm._uid).not.toBe(originalMap._uid);
        wrapper.destroy();
    });

    it('resets the selection for a new round and fails closed for malformed phase or round data', async () => {
        const wrapper = create();
        await wrapper.find('.map-stub').trigger('click');
        await wrapper.setProps({ round: { ...round, id: 'r2' }, submissionState: 'idle' });
        expect(wrapper.findComponent(mapStub).props('selected')).toBe(null);
        await wrapper.setProps({ phase: 'unexpected' });
        expect(wrapper.text()).toContain('This round is unavailable.');
        expect(wrapper.find('.map-stub').exists()).toBe(false);
        await wrapper.setProps({ phase: 'guessing', round: { id: '' } });
        expect(wrapper.text()).toContain('This round is unavailable.');
        for (const malformedRound of [
            { id: 'r1' },
            { ...round, panoramaId: '' },
            { ...round, heading: NaN },
            { ...round, heading: 360 },
            { ...round, pitch: Infinity },
            { ...round, pitch: -91 },
        ]) {
            await wrapper.setProps({ round: malformedRound });
            expect(wrapper.text()).toContain('This round is unavailable.');
            expect(wrapper.find('.map-stub').exists()).toBe(false);
        }
        wrapper.destroy();
    });
});
