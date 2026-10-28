import { mount } from '@vue/test-utils';
import EventPanorama from '@/components/event/EventPanorama.vue';

function makeMaps(status) {
    const listeners = [];
    let currentStatus = arguments.length === 0 ? 'OK' : status;
    const panorama = {
        getStatus: jest.fn(() => currentStatus),
        setVisible: jest.fn(),
    };
    const maps = {
        StreetViewStatus: { OK: 'OK' },
        StreetViewPanorama: jest.fn(() => panorama),
        event: {
            addListener: jest.fn((target, name, callback) => {
                const listener = { target, name, callback, remove: jest.fn() };
                listeners.push(listener);
                return listener;
            }),
        },
    };
    return { maps, panorama, listeners, setStatus(value) { currentStatus = value; } };
}
const round = { id: 'r1', panoramaId: 'exact-pano-42', heading: 137, pitch: -8 };
async function flushPromises() {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe('EventPanorama', () => {
    it('loads the exact panorama ID and initial heading and pitch', async () => {
        const { maps, panorama } = makeMaps();
        const mapsLoader = jest.fn().mockResolvedValue(maps);
        const wrapper = mount(EventPanorama, { propsData: { round, mapsLoader } });
        await flushPromises();
        await wrapper.vm.$nextTick();

        expect(mapsLoader).toHaveBeenCalledTimes(1);
        expect(maps.StreetViewPanorama).toHaveBeenCalledWith(wrapper.vm.$refs.panorama, {
            pano: 'exact-pano-42',
            pov: { heading: 137, pitch: -8 },
            visible: true,
            addressControl: false,
        });
        expect(wrapper.vm.status).toBe('ready');
        wrapper.destroy();
        expect(panorama.setVisible).toHaveBeenCalledWith(false);
    });

    it('shows a retry action after a panorama status failure and removes the listener', async () => {
        const { maps, panorama, listeners } = makeMaps('ZERO_RESULTS');
        const wrapper = mount(EventPanorama, { propsData: { round, mapsLoader: () => Promise.resolve(maps) } });
        await flushPromises();
        await wrapper.vm.$nextTick();
        expect(wrapper.vm.status).toBe('error');
        expect(wrapper.find('button').text()).toBe('Retry Street View');
        expect(panorama.setVisible).toHaveBeenCalledWith(false);
        expect(listeners[0].remove).toHaveBeenCalled();
        wrapper.destroy();
    });

    it('keeps an unset initial status loading until a later success event', async () => {
        const { maps, listeners, setStatus } = makeMaps(undefined);
        const wrapper = mount(EventPanorama, { propsData: { round, mapsLoader: () => Promise.resolve(maps) } });
        await flushPromises();
        expect(wrapper.vm.status).toBe('loading');
        expect(wrapper.find('button').exists()).toBe(false);
        setStatus('OK');
        listeners[0].callback();
        expect(wrapper.vm.status).toBe('ready');
        wrapper.destroy();
    });

    it('fails with a retry action if a panorama never emits a terminal status within ten seconds', async () => {
        jest.useFakeTimers();
        const { maps } = makeMaps(undefined);
        const wrapper = mount(EventPanorama, { propsData: { round, mapsLoader: () => Promise.resolve(maps) } });
        await flushPromises();
        expect(wrapper.vm.status).toBe('loading');
        jest.advanceTimersByTime(10000);
        await flushPromises();
        expect(wrapper.vm.status).toBe('error');
        expect(wrapper.find('button').text()).toBe('Retry Street View');
        wrapper.destroy();
        jest.useRealTimers();
    });

    it('keeps the current panorama and POV when unrelated round metadata changes', async () => {
        const { maps } = makeMaps();
        const wrapper = mount(EventPanorama, { propsData: { round, mapsLoader: () => Promise.resolve(maps) } });
        await flushPromises();
        await wrapper.setProps({ round: { ...round, title: 'A public caption' } });
        await flushPromises();
        expect(maps.StreetViewPanorama).toHaveBeenCalledTimes(1);
        expect(wrapper.vm.panorama).not.toBe(null);
        wrapper.destroy();
    });

    it('fails closed after a ten second loader timeout and supports explicit retry', async () => {
        jest.useFakeTimers();
        let resolveLoader;
        const mapsLoader = jest.fn(() => new Promise((resolve) => { resolveLoader = resolve; }));
        const wrapper = mount(EventPanorama, { propsData: { round, mapsLoader } });
        await flushPromises();
        jest.advanceTimersByTime(10000);
        await Promise.resolve();
        await wrapper.vm.$nextTick();
        expect(wrapper.vm.status).toBe('error');
        expect(wrapper.find('button').exists()).toBe(true);
        wrapper.find('button').trigger('click');
        await flushPromises();
        expect(mapsLoader).toHaveBeenCalledTimes(2);
        wrapper.destroy();
        if (resolveLoader) resolveLoader(makeMaps().maps);
        jest.useRealTimers();
    });

    it('ignores stale loads and status callbacks after a round change or unmount', async () => {
        let resolveFirst;
        const first = new Promise((resolve) => { resolveFirst = resolve; });
        const fresh = makeMaps();
        const mapsLoader = jest.fn().mockReturnValueOnce(first).mockResolvedValue(fresh.maps);
        const wrapper = mount(EventPanorama, { propsData: { round, mapsLoader } });
        await wrapper.setProps({ round: { ...round, id: 'r2', panoramaId: 'next-pano', heading: 12 } });
        await flushPromises();
        await wrapper.vm.$nextTick();
        expect(fresh.maps.StreetViewPanorama).toHaveBeenCalledTimes(1);
        const stale = makeMaps();
        resolveFirst(stale.maps);
        await flushPromises();
        expect(stale.maps.StreetViewPanorama).not.toHaveBeenCalled();
        const callback = fresh.listeners[0].callback;
        wrapper.destroy();
        callback();
        expect(fresh.panorama.setVisible).toHaveBeenCalledWith(false);
    });

    it('does not select a fallback panorama when the configured identifier is absent', async () => {
        const mapsLoader = jest.fn();
        const wrapper = mount(EventPanorama, {
            propsData: { round: { id: 'r1', heading: 0, pitch: 0 }, mapsLoader },
        });
        await wrapper.vm.$nextTick();
        expect(wrapper.vm.status).toBe('error');
        expect(mapsLoader).not.toHaveBeenCalled();
        wrapper.destroy();
    });
});
