import { mount } from '@vue/test-utils';
import EventGuessMap from '@/components/event/EventGuessMap.vue';

function makeMaps() {
    const listeners = [];
    const markers = [];
    const map = { options: null, fitBounds: jest.fn(), setOptions: jest.fn() };
    const maps = {
        LatLngBounds: jest.fn(() => ({ extend: jest.fn() })),
        Map: jest.fn((element, options) => { map.options = options; return map; }),
        Marker: jest.fn((options) => {
            const marker = {
                options,
                setPosition: jest.fn((position) => { marker.position = position; }),
                setMap: jest.fn((value) => { marker.map = value; }),
            };
            markers.push(marker);
            return marker;
        }),
        event: {
            addListener: jest.fn((target, event, callback) => {
                const listener = { target, event, callback, remove: jest.fn() };
                listeners.push(listener);
                return listener;
            }),
        },
    };
    return { maps, map, markers, listeners };
}
const click = (lat, lng) => ({ latLng: { lat: () => lat, lng: () => lng } });

async function mounted(propsData) {
    const wrapper = mount(EventGuessMap, { propsData });
    await Promise.resolve();
    await wrapper.vm.$nextTick();
    return wrapper;
}

describe('EventGuessMap', () => {
    it('starts at a neutral world view and emits plain validated coordinates on map click', async () => {
        const { maps, map, markers } = makeMaps();
        const wrapper = await mounted({ mapsLoader: () => Promise.resolve(maps) });
        expect(maps.Map).toHaveBeenCalledWith(wrapper.vm.$refs.map, expect.objectContaining({
            center: { lat: 15, lng: 0 }, zoom: 2,
        }));
        maps.event.addListener.mock.calls[0][2](click(47.5, -122.3));
        expect(wrapper.emitted('select')).toEqual([[{ lat: 47.5, lng: -122.3 }]]);
        expect(Object.getPrototypeOf(wrapper.emitted('select')[0][0])).toBe(Object.prototype);
        expect(markers).toHaveLength(1);
        expect(markers[0].options.position).toEqual({ lat: 47.5, lng: -122.3 });
        expect(markers[0].options.map).toBe(map);
        wrapper.destroy();
    });

    it('ignores clicks while disabled and rejects malformed or out of range coordinates', async () => {
        const { maps } = makeMaps();
        const wrapper = await mounted({ mapsLoader: () => Promise.resolve(maps), disabled: true });
        const clickHandler = maps.event.addListener.mock.calls[0][2];
        clickHandler(click(0, 0));
        await wrapper.setProps({ disabled: false });
        clickHandler(click(91, 0));
        clickHandler(click(0, -181));
        clickHandler({ latLng: { lat: () => NaN, lng: () => 0 } });
        expect(wrapper.emitted('select')).toBeUndefined();
        wrapper.destroy();
    });

    it('moves or clears its marker when the acknowledged selection changes', async () => {
        const { maps, markers } = makeMaps();
        const wrapper = await mounted({ mapsLoader: () => Promise.resolve(maps), selected: { lat: 1, lng: 2 } });
        expect(markers).toHaveLength(1);
        expect(markers[0].options.position).toEqual({ lat: 1, lng: 2 });
        await wrapper.setProps({ selected: { lat: -20, lng: 160 } });
        expect(markers[0].setPosition).toHaveBeenCalledWith({ lat: -20, lng: 160 });
        await wrapper.setProps({ selected: null });
        expect(markers[0].setMap).toHaveBeenLastCalledWith(null);
        wrapper.destroy();
        expect(maps.event.addListener.mock.results[0].value.remove).toHaveBeenCalled();
    });

    it('retains the map at reveal, labels both pins and fits them with padding and bounded zoom', async () => {
        const { maps, map, markers, listeners } = makeMaps();
        const guess = { lat: 10, lng: 20 };
        const answer = { lat: -10, lng: -30 };
        const wrapper = await mounted({ mapsLoader: () => Promise.resolve(maps), selected: guess });
        await wrapper.setProps({ disabled: true });
        expect(markers).toHaveLength(1);
        expect(map.fitBounds).not.toHaveBeenCalled();
        await wrapper.setProps({ answer });
        expect(maps.Map).toHaveBeenCalledTimes(1);
        expect(markers).toHaveLength(2);
        expect(markers[0].options).toMatchObject({ label: { text: 'G' }, title: 'Your guess (G)' });
        expect(markers[1].options).toMatchObject({ label: { text: 'A' }, title: 'Correct location (A)', position: answer });
        expect(markers[0].options.icon).toBeDefined();
        expect(markers[1].options.icon).toBeUndefined();
        const bounds = maps.LatLngBounds.mock.results[0].value;
        expect(bounds.extend.mock.calls).toEqual([[answer], [guess]]);
        expect(map.fitBounds).toHaveBeenCalledWith(bounds, { top: 56, right: 56, bottom: 56, left: 56 });
        expect(map.setOptions).toHaveBeenCalledWith({ maxZoom: 16 });
        expect(wrapper.text()).toContain('A — Correct location · G — Your saved guess');
        // An answer map stays read-only even if a caller forgets disabled.
        await wrapper.setProps({ disabled: false });
        listeners[0].callback(click(1, 2));
        expect(wrapper.emitted('select')).toBeUndefined();
        wrapper.destroy();
        expect(listeners[0].remove).toHaveBeenCalledTimes(1);
        markers.forEach(marker => expect(marker.setMap).toHaveBeenLastCalledWith(null));
    });

    it('fits the correct location alone for no answer and removes reveal data when cleared', async () => {
        const { maps, map, markers } = makeMaps();
        const answer = { lat: 0, lng: 0 };
        const wrapper = await mounted({ mapsLoader: () => Promise.resolve(maps), answer });
        expect(markers).toHaveLength(1);
        expect(markers[0].options.label.text).toBe('A');
        expect(maps.LatLngBounds.mock.results[0].value.extend.mock.calls).toEqual([[answer]]);
        expect(map.fitBounds).toHaveBeenCalledTimes(1);
        expect(wrapper.text()).toContain('No saved guess');
        await wrapper.setProps({ answer: null });
        expect(markers[0].setMap).toHaveBeenLastCalledWith(null);
        expect(wrapper.find('[aria-label="Map legend"]').exists()).toBe(false);
        wrapper.destroy();
    });

    it('disposes a late loader result after unmount', async () => {
        let resolveLoader;
        const mapsLoader = () => new Promise((resolve) => { resolveLoader = resolve; });
        const wrapper = mount(EventGuessMap, { propsData: { mapsLoader } });
        await Promise.resolve();
        wrapper.destroy();
        const { maps } = makeMaps();
        resolveLoader(maps);
        await Promise.resolve();
        expect(maps.Map).not.toHaveBeenCalled();
    });

    it('shows loading, exposes a retry after failure, and restores the acknowledged pin on success', async () => {
        const { maps, markers } = makeMaps();
        const wrapper = mount(EventGuessMap, {
            propsData: { mapsLoader: jest.fn().mockRejectedValue(new Error('private provider detail')), selected: { lat: 8, lng: 9 } },
        });
        expect(wrapper.find('[role="status"]').text()).toContain('Loading');
        await Promise.resolve();
        await Promise.resolve();
        await wrapper.vm.$nextTick();
        expect(wrapper.find('[role="alert"]').text()).toContain('could not be loaded');
        expect(wrapper.find('[role="alert"]').text()).toContain('If this keeps happening, reload this page.');
        expect(wrapper.find('[role="alert"]').text()).not.toContain('private provider detail');
        expect(wrapper.find('button').text()).toBe('Try again');

        await wrapper.setProps({ mapsLoader: () => Promise.resolve(maps) });
        await Promise.resolve();
        await wrapper.vm.$nextTick();
        expect(maps.Map).toHaveBeenCalledTimes(1);
        expect(markers[0].options.position).toEqual({ lat: 8, lng: 9 });
        expect(wrapper.find('[role="alert"]').exists()).toBe(false);
        wrapper.destroy();
    });

    it('restores both revealed pins after a provider failure and explicit retry', async () => {
        const { maps, markers, map } = makeMaps();
        const loader = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(maps);
        const wrapper = await mounted({ mapsLoader: loader, disabled: true,
            selected: { lat: 3, lng: 4 }, answer: { lat: 1, lng: 2 } });
        expect(wrapper.find('[role="alert"]').exists()).toBe(true);
        await wrapper.find('button').trigger('click');
        await Promise.resolve();
        await wrapper.vm.$nextTick();
        expect(markers.map(marker => marker.options.label.text)).toEqual(['G', 'A']);
        expect(map.fitBounds).toHaveBeenCalledTimes(1);
        expect(wrapper.find('[role="alert"]').exists()).toBe(false);
        wrapper.destroy();
    });

    it('allows explicit retry, prevents duplicate maps, and gates clicks while disabled', async () => {
        const { maps, markers } = makeMaps();
        const loader = jest.fn()
            .mockRejectedValueOnce(new Error('failed'))
            .mockRejectedValueOnce(new Error('failed again'))
            .mockResolvedValue(maps);
        const wrapper = mount(EventGuessMap, { propsData: { mapsLoader: loader, disabled: true } });
        await Promise.resolve();
        await Promise.resolve();
        await wrapper.vm.$nextTick();
        await wrapper.find('button').trigger('click');
        await Promise.resolve();
        await wrapper.vm.$nextTick();
        expect(wrapper.find('[role="alert"]').exists()).toBe(true);
        await wrapper.find('button').trigger('click');
        await Promise.resolve();
        await wrapper.vm.$nextTick();
        expect(loader).toHaveBeenCalledTimes(3);
        expect(maps.Map).toHaveBeenCalledTimes(1);
        maps.event.addListener.mock.calls[0][2](click(0, 0));
        expect(wrapper.emitted('select')).toBeUndefined();
        expect(markers).toHaveLength(0);
        wrapper.destroy();
    });

    it('shows a finite timeout error and ignores a loader that resolves afterward', async () => {
        jest.useFakeTimers();
        let resolveLoader;
        const mapsLoader = () => new Promise((resolve) => { resolveLoader = resolve; });
        const wrapper = mount(EventGuessMap, { propsData: { mapsLoader } });
        await Promise.resolve();
        jest.advanceTimersByTime(15000);
        await Promise.resolve();
        await Promise.resolve();
        await wrapper.vm.$nextTick();
        expect(wrapper.find('[role="alert"]').exists()).toBe(true);
        const { maps } = makeMaps();
        resolveLoader(maps);
        await Promise.resolve();
        expect(maps.Map).not.toHaveBeenCalled();
        wrapper.destroy();
        jest.useRealTimers();
    });

    it('removes old listeners and ignores callbacks after the loader prop changes', async () => {
        const first = makeMaps();
        const second = makeMaps();
        const wrapper = await mounted({ mapsLoader: () => Promise.resolve(first.maps) });
        const staleCallback = first.maps.event.addListener.mock.calls[0][2];
        await wrapper.setProps({ mapsLoader: () => Promise.resolve(second.maps) });
        await Promise.resolve();
        await wrapper.vm.$nextTick();
        expect(first.listeners[0].remove).toHaveBeenCalled();
        staleCallback(click(10, 20));
        expect(wrapper.emitted('select')).toBeUndefined();
        expect(second.maps.Map).toHaveBeenCalledTimes(1);
        wrapper.destroy();
    });

    it('reports an unusable Maps API and keeps the retry control available', async () => {
        const wrapper = await mounted({ mapsLoader: () => Promise.resolve({}) });
        expect(wrapper.find('[role="alert"]').exists()).toBe(true);
        expect(wrapper.find('button').exists()).toBe(true);
        wrapper.destroy();
    });
});
