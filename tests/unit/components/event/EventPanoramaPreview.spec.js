import { mount } from '@vue/test-utils';
import EventPanoramaPreview from '@/components/event/EventPanoramaPreview.vue';

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

const configuration = { panoramaId: 'curated-pano-9', heading: 137, pitch: -8 };
async function flushPromises() {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

describe('EventPanoramaPreview', () => {
    it('previews the exact panorama and POV, then emits the validated choice', async () => {
        const { maps, panorama } = makeMaps();
        const mapsLoader = jest.fn().mockResolvedValue(maps);
        const wrapper = mount(EventPanoramaPreview, { propsData: { ...configuration, mapsLoader } });
        await flushPromises();
        await wrapper.vm.$nextTick();

        expect(mapsLoader).toHaveBeenCalledTimes(1);
        expect(maps.StreetViewPanorama).toHaveBeenCalledWith(wrapper.findComponent({ name: 'EventPanorama' }).vm.$refs.panorama, {
            pano: 'curated-pano-9',
            pov: { heading: 137, pitch: -8 },
            visible: true,
            addressControl: false,
        });
        const choice = wrapper.find('button');
        expect(choice.element.disabled).toBe(false);
        await choice.trigger('click');
        expect(wrapper.emitted('choice')).toEqual([[configuration]]);
        wrapper.destroy();
        expect(panorama.setVisible).toHaveBeenCalledWith(false);
    });

    it('rejects invalid IDs and camera bounds without loading Street View', async () => {
        const mapsLoader = jest.fn();
        const cases = [
            { ...configuration, panoramaId: '  ' },
            { ...configuration, panoramaId: ' curated-pano-9' },
            { ...configuration, panoramaId: 'curated-pano-9 ' },
            { ...configuration, panoramaId: 'x'.repeat(513) },
            { ...configuration, heading: -1 },
            { ...configuration, heading: 360 },
            { ...configuration, pitch: -91 },
            { ...configuration, pitch: 91 },
        ];
        for (const invalid of cases) {
            const wrapper = mount(EventPanoramaPreview, { propsData: { ...invalid, mapsLoader } });
            expect(wrapper.find('[role="alert"]').text()).toContain('Enter a panorama ID');
            expect(wrapper.findComponent({ name: 'EventPanorama' }).exists()).toBe(false);
            expect(wrapper.find('button').exists()).toBe(false);
            expect(wrapper.emitted('choice')).toBeUndefined();
            wrapper.destroy();
        }
        expect(mapsLoader).not.toHaveBeenCalled();
    });

    it('keeps choice unavailable while loading and after an unavailable panorama', async () => {
        const { maps, listeners } = makeMaps('ZERO_RESULTS');
        const wrapper = mount(EventPanoramaPreview, {
            propsData: { ...configuration, mapsLoader: () => Promise.resolve(maps) },
        });
        const choice = wrapper.find('button');
        expect(choice.element.disabled).toBe(true);
        await flushPromises();
        await wrapper.vm.$nextTick();
        expect(wrapper.text()).toContain('Street View could not be loaded');
        expect(choice.element.disabled).toBe(true);
        expect(wrapper.emitted('choice')).toBeUndefined();
        expect(listeners[0].remove).toHaveBeenCalled();
        wrapper.destroy();
    });

    it('invalidates a ready choice as soon as valid configuration changes', async () => {
        let resolveSecond;
        const first = makeMaps();
        const second = makeMaps();
        const mapsLoader = jest.fn()
            .mockResolvedValueOnce(first.maps)
            .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));
        const wrapper = mount(EventPanoramaPreview, { propsData: { ...configuration, mapsLoader } });
        await flushPromises();
        await wrapper.vm.$nextTick();
        expect(wrapper.vm.previewStatus).toBe('ready');

        await wrapper.setProps({ panoramaId: 'second-curated-pano', heading: 12, pitch: 3 });
        const choice = wrapper.find('button');
        expect(wrapper.vm.previewStatus).toBe('loading');
        expect(choice.element.disabled).toBe(true);
        await choice.trigger('click');
        expect(wrapper.emitted('choice')).toBeUndefined();

        resolveSecond(second.maps);
        await flushPromises();
        await wrapper.vm.$nextTick();
        expect(wrapper.vm.previewStatus).toBe('ready');
        expect(choice.element.disabled).toBe(false);
        await choice.trigger('click');
        expect(wrapper.emitted('choice')).toEqual([[
            { panoramaId: 'second-curated-pano', heading: 12, pitch: 3 },
        ]]);
        wrapper.destroy();
    });

    it('does not attach the child status watcher if destroyed before nextTick', async () => {
        const { maps } = makeMaps();
        const wrapper = mount(EventPanoramaPreview, {
            propsData: { ...configuration, mapsLoader: () => Promise.resolve(maps) },
        });
        const preview = wrapper.findComponent({ name: 'EventPanorama' }).vm;
        const childWatch = jest.spyOn(preview, '$watch');
        const parent = wrapper.vm;
        wrapper.destroy();
        await parent.$nextTick();
        expect(childWatch).not.toHaveBeenCalled();
    });

    it('ignores a late maps load after the configuration changes and disposes on unmount', async () => {
        let resolveFirst;
        const first = new Promise((resolve) => { resolveFirst = resolve; });
        const fresh = makeMaps();
        const mapsLoader = jest.fn().mockReturnValueOnce(first).mockResolvedValue(fresh.maps);
        const wrapper = mount(EventPanoramaPreview, { propsData: { ...configuration, mapsLoader } });
        await wrapper.setProps({ panoramaId: 'next-exact-pano', heading: 12, pitch: 0 });
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
});
