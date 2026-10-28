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
});
