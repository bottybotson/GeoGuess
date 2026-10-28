import { mount } from '@vue/test-utils';
import EventGuessMap from '@/components/event/EventGuessMap.vue';

function makeMaps() {
    const listeners = [];
    const markers = [];
    const map = { options: null };
    const maps = {
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
