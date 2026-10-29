import { mount } from '@vue/test-utils';
import EventSetup from '@/pages/event/EventSetup.vue';
import EventPanoramaPreview from '@/components/event/EventPanoramaPreview.vue';
const { validate } = require('../../../../scripts/event-setup/core.cjs');

const mapsLoader = jest.fn();
const values = {
    projectId: 'party-project', databaseUrl: 'https://party-project.firebaseio.com', eventId: 'birthday',
    hostUid: 'existing-host-uid', title: 'Birthday game', panoramaId: 'curated-pano', heading: '137', pitch: '-8',
    answerLat: '40.5', answerLng: '-73.25', difficulty: '2000',
};

async function fillForm(wrapper, overrides = {}) {
    for (const [key, value] of Object.entries({ ...values, ...overrides })) {
        await wrapper.find(`#event-setup-${key === 'databaseUrl' ? 'database' : key === 'projectId' ? 'project' : key === 'eventId' ? 'id' : key === 'hostUid' ? 'host' : key === 'title' ? 'title' : key === 'panoramaId' ? 'panorama' : key === 'answerLat' ? 'lat' : key === 'answerLng' ? 'lng' : key}`).setValue(value);
    }
}

describe('EventSetup', () => {
    it('starts blank except for the friendly difficulty and does not load maps until preview fields are valid', () => {
        const wrapper = mount(EventSetup, { propsData: { mapsLoader } });
        expect(wrapper.find('h1').text()).toBe('Prepare a test event');
        expect(wrapper.text()).toContain('Drafts stay in this browser tab and are not stored or uploaded.');
        expect(wrapper.text()).toContain('Use the UID from the host’s Firebase Authentication account. Do not enter a password.');
        expect(wrapper.find('#event-setup-project').element.value).toBe('');
        expect(wrapper.find('#event-setup-panorama').element.value).toBe('');
        expect(wrapper.find('#event-setup-difficulty').element.value).toBe('2000');
        expect(mapsLoader).not.toHaveBeenCalled();
        expect(wrapper.findAll('input').wrappers.every(input => !input.element.value || input.element.id === 'event-setup-difficulty')).toBe(true);
        wrapper.destroy();
    });

    it('exports the exact merged seed only after the current panorama choice', async () => {
        const wrapper = mount(EventSetup, { propsData: { mapsLoader } });
        await fillForm(wrapper);
        expect(wrapper.findComponent(EventPanoramaPreview).exists()).toBe(true);
        expect(wrapper.find('.event-setup__export').text()).toContain('Select “Use this panorama”');
        expect(wrapper.find('.event-setup__actions button').element.disabled).toBe(true);
        wrapper.findComponent(EventPanoramaPreview).vm.$emit('choice', { panoramaId: 'curated-pano', heading: 137, pitch: -8 });
        await wrapper.vm.$nextTick();
        expect(wrapper.vm.seed).toEqual({
            projectId: 'party-project', databaseUrl: 'https://party-project.firebaseio.com', eventId: 'birthday',
            event: {
                hostUid: 'existing-host-uid', public: { title: 'Birthday game', phase: 'lobby' },
                private: { round: { id: 'r1', panoramaId: 'curated-pano', heading: 137, pitch: -8,
                    answer: { lat: 40.5, lng: -73.25 }, difficulty: 2000 } },
            },
        });
        expect(validate(wrapper.vm.seed, {
            projectId: wrapper.vm.seed.projectId,
            databaseUrl: wrapper.vm.seed.databaseUrl,
            eventId: wrapper.vm.seed.eventId,
        })).toEqual(wrapper.vm.seed);
        expect(JSON.parse(wrapper.find('pre').text())).toEqual(wrapper.vm.seed);

        await wrapper.find('#event-setup-title').setValue('Changed title');
        expect(wrapper.vm.canExport).toBe(false);
        expect(wrapper.find('pre').exists()).toBe(false);
        wrapper.destroy();
    });

    it('ignores malformed preview choices and stale clipboard completions', async () => {
        const wrapper = mount(EventSetup, { propsData: { mapsLoader } });
        await fillForm(wrapper);
        expect(() => wrapper.vm.recordPreviewChoice(null)).not.toThrow();
        wrapper.vm.recordPreviewChoice({ panoramaId: 'curated-pano', heading: 137, pitch: -8 });
        await wrapper.vm.$nextTick();

        let finishCopy;
        const clipboard = { writeText: jest.fn(() => new Promise(resolve => { finishCopy = resolve; })) };
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
        const pending = wrapper.vm.copySeed();
        await wrapper.find('#event-setup-title').setValue('Updated during copy');
        finishCopy();
        await pending;
        expect(wrapper.vm.message).toBe('');
        wrapper.destroy();
        delete navigator.clipboard;
    });

    it('rejects malformed, non-decimal and out-of-range coordinates and headings', async () => {
        const wrapper = mount(EventSetup, { propsData: { mapsLoader } });
        await fillForm(wrapper, { heading: '0x10' });
        expect(wrapper.vm.previewConfigurationValid).toBe(false);
        await wrapper.find('#event-setup-heading').setValue('360');
        expect(wrapper.vm.previewConfigurationValid).toBe(false);
        await fillForm(wrapper, { heading: '90', answerLat: '90.0001' });
        expect(wrapper.vm.validSeed).toBe(false);
        await wrapper.find('#event-setup-lat').setValue('-90');
        expect(wrapper.vm.validSeed).toBe(true);
        wrapper.destroy();
    });

    it('downloads a JSON blob and revokes its object URL on replacement and destroy', async () => {
        const createObjectURL = jest.fn(() => 'blob:seed-test');
        const revokeObjectURL = jest.fn();
        const originalCreate = URL.createObjectURL;
        const originalRevoke = URL.revokeObjectURL;
        URL.createObjectURL = createObjectURL;
        URL.revokeObjectURL = revokeObjectURL;
        const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        const wrapper = mount(EventSetup, { propsData: { mapsLoader } });
        await fillForm(wrapper);
        wrapper.findComponent(EventPanoramaPreview).vm.$emit('choice', { panoramaId: 'curated-pano', heading: 137, pitch: -8 });
        await wrapper.vm.$nextTick();
        await wrapper.findAll('.event-setup__actions button').at(1).trigger('click');
        expect(createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ type: 'application/json' }));
        expect(click).toHaveBeenCalledTimes(1);
        expect(wrapper.vm.message).toContain('downloaded');
        wrapper.vm.downloadSeed();
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:seed-test');
        wrapper.destroy();
        expect(revokeObjectURL).toHaveBeenCalledTimes(2);
        click.mockRestore();
        URL.createObjectURL = originalCreate;
        URL.revokeObjectURL = originalRevoke;
    });
});
