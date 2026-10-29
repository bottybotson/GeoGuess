import { mount } from '@vue/test-utils';
import EventRoundTimer from '@/components/event/EventRoundTimer.vue';

function create(propsData = {}) {
    return mount(EventRoundTimer, { propsData: { connected: true, nowMs: 1000, timing: null, ...propsData } });
}

describe('EventRoundTimer', () => {
    it('shows untimed state and treats missing or disconnected clock data as unknown', async () => {
        const wrapper = create();
        expect(wrapper.text()).toContain('No time limit');
        await wrapper.setProps({ connected: false });
        expect(wrapper.text()).toContain('Waiting for connection');
        await wrapper.setProps({ connected: true, nowMs: null });
        expect(wrapper.text()).toContain('Waiting for connection');
        wrapper.destroy();
    });

    it('formats remaining time and holds at zero without implying round advancement', async () => {
        const wrapper = create({ timing: { roundId: 'r1', deadlineMs: 62000 } });
        expect(wrapper.text()).toContain('Time remaining: 01:01');
        await wrapper.setProps({ nowMs: 62000 });
        expect(wrapper.text()).toContain('Time is up—waiting for host');
        expect(wrapper.attributes('aria-live')).toBeUndefined();
        expect(wrapper.find('[aria-live="off"]').exists()).toBe(true);
        wrapper.destroy();
    });

    it('fails closed for malformed timing', () => {
        const wrapper = create({ timing: { roundId: 'r2', deadlineMs: 62000 } });
        expect(wrapper.text()).toContain('Waiting for connection');
        wrapper.destroy();
    });
});
