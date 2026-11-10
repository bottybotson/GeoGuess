import { mount } from '@vue/test-utils';
import OrderedRoundsEditor from '@/components/event/OrderedRoundsEditor.vue';
import { confirmationKey, MAX_ROUNDS } from '@/utils/event/orderedSetup';

const mapsLoader = jest.fn();

describe('OrderedRoundsEditor', () => {
    it('supports accessible bounded add, reorder and remove controls', async () => {
        const wrapper = mount(OrderedRoundsEditor, { propsData: { mapsLoader } });
        expect(wrapper.text()).toContain('1 of 20 rounds');
        expect(wrapper.find('button[aria-label="Move round 1 up"]').element.disabled).toBe(true);
        expect(wrapper.find('button[aria-label="Remove round 1"]').element.disabled).toBe(true);
        await wrapper.find('button').trigger('click');
        expect(wrapper.text()).toContain('2 of 20 rounds');
        const firstId = wrapper.vm.rounds[0].localId;
        const secondId = wrapper.vm.rounds[1].localId;
        await wrapper.find('button[aria-label="Move round 2 up"]').trigger('click');
        expect(wrapper.vm.rounds.map(round => round.localId)).toEqual([secondId, firstId]);
        await wrapper.find('button[aria-label="Remove round 1"]').trigger('click');
        expect(wrapper.vm.rounds.map(round => round.localId)).toEqual([firstId]);
        for (let count = 1; count < MAX_ROUNDS; count++) wrapper.vm.addRound();
        await wrapper.vm.$nextTick();
        expect(wrapper.text()).toContain('20 of 20 rounds');
        expect(wrapper.find('.ordered-rounds__actions > button').element.disabled).toBe(true);
        wrapper.destroy();
    });

    it('keeps row confirmation through reorder, invalidates coordinate edits, and ignores stale preview events', async () => {
        const wrapper = mount(OrderedRoundsEditor, { propsData: { mapsLoader } });
        const [row] = wrapper.vm.rounds;
        Object.assign(row, { panoramaId: 'pano-one', heading: '20', pitch: '0', answerLat: '10', answerLng: '20' });
        const firstKey = wrapper.vm.previewKey;
        wrapper.vm.addRound();
        const second = wrapper.vm.activeRound;
        Object.assign(second, { panoramaId: 'pano-two', heading: '30', pitch: '2', answerLat: '11', answerLng: '21' });
        second.confirmation = confirmationKey(second);
        const secondKey = wrapper.vm.previewKey;
        wrapper.vm.recordChoice(row.localId, firstKey, { panoramaId: 'pano-one', heading: 20, pitch: 0 });
        expect(row.confirmation).toBe('');
        expect(second.confirmation).toBe(confirmationKey(second));
        wrapper.vm.recordChoice(row.localId, secondKey, { panoramaId: 'pano-one', heading: 20, pitch: 0 });
        expect(row.confirmation).toBe('');
        wrapper.vm.recordChoice(second.localId, secondKey, { panoramaId: 'pano-two', heading: 30, pitch: 2 });
        expect(second.confirmation).toBe(confirmationKey(second));
        wrapper.vm.move(0, 1);
        expect(wrapper.vm.rounds.map(item => item.localId)).toEqual([second.localId, row.localId]);
        expect(second.confirmation).toBe(confirmationKey(second));
        row.answerLat = '12';
        expect(row.confirmation).not.toBe(confirmationKey(row));
        wrapper.destroy();
    });

    it('replays captured Vue preview listeners only for their original row and configuration', async () => {
        const wrapper = mount(OrderedRoundsEditor, { propsData: { mapsLoader } });
        const first = wrapper.vm.rounds[0];
        Object.assign(first, {
            panoramaId: 'shared-pano', heading: '20', pitch: '0', answerLat: '10', answerLng: '20', difficulty: '2000',
        });
        await wrapper.vm.$nextTick();

        const firstPreview = wrapper.findComponent({ name: 'EventPanoramaPreview' });
        const firstChoiceListener = firstPreview.vm.$listeners.choice;
        expect(typeof firstChoiceListener).toBe('function');

        wrapper.vm.addRound();
        const second = wrapper.vm.activeRound;
        Object.assign(second, {
            panoramaId: 'shared-pano', heading: '20', pitch: '0', answerLat: '11', answerLng: '21', difficulty: '2000',
        });
        await wrapper.vm.$nextTick();

        const choice = { panoramaId: 'shared-pano', heading: 20, pitch: 0 };
        firstChoiceListener(choice);
        expect(first.confirmation).toBe('');
        expect(second.confirmation).toBe('');

        const secondPreview = wrapper.findComponent({ name: 'EventPanoramaPreview' });
        const oldConfigurationListener = secondPreview.vm.$listeners.choice;
        second.difficulty = '2500';
        await wrapper.vm.$nextTick();
        oldConfigurationListener(choice);
        expect(second.confirmation).toBe('');

        const currentPreview = wrapper.findComponent({ name: 'EventPanoramaPreview' });
        currentPreview.vm.$listeners.choice(choice);
        expect(second.confirmation).toBe(confirmationKey(second));
        wrapper.destroy();
    });
});
