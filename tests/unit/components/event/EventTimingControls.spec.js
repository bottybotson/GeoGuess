import { mount } from '@vue/test-utils';
import EventTimingControls from '@/components/event/EventTimingControls.vue';

function create(propsData = {}) {
    return mount(EventTimingControls, {
        propsData: { timing: null, nowMs: 1000, connected: true, ...propsData },
    });
}

describe('EventTimingControls', () => {
    it('requests a two minute initial timer once and suppresses duplicate activation', async () => {
        const wrapper = create();
        const button = wrapper.find('button');
        await button.trigger('click');
        await button.trigger('click');
        expect(wrapper.emitted('request-duration')).toEqual([[{ durationMs: 120000 }]]);
        expect(button.element.disabled).toBe(true);
        wrapper.destroy();
    });

    it('requests one minute extensions, including after expiry', async () => {
        const wrapper = create({ timing: { roundId: 'r1', deadlineMs: 500 } });
        await wrapper.find('button').trigger('click');
        expect(wrapper.emitted('request-duration')).toEqual([[{ durationMs: 60000 }]]);
        wrapper.destroy();
    });

    it('disables actions while disconnected, without a clock, while busy, or on malformed timing', async () => {
        const wrapper = create({ connected: false });
        expect(wrapper.find('button').element.disabled).toBe(true);
        await wrapper.setProps({ connected: true, nowMs: null });
        expect(wrapper.find('button').element.disabled).toBe(true);
        await wrapper.setProps({ nowMs: 1000, busy: true });
        expect(wrapper.find('button').element.disabled).toBe(true);
        await wrapper.setProps({ busy: false, timing: { roundId: 'bad', deadlineMs: 3000 } });
        expect(wrapper.find('button').element.disabled).toBe(true);
        expect(wrapper.emitted('request-duration')).toBeUndefined();
        wrapper.destroy();
    });

    it('only retries when a parent-owned target is available and latches duplicate clicks', async () => {
        const wrapper = create({ error: 'Timing update not confirmed.', retryAvailable: true });
        const retry = wrapper.findAll('button').at(1);
        await retry.trigger('click');
        await retry.trigger('click');
        expect(wrapper.emitted('retry')).toHaveLength(1);
        wrapper.destroy();
    });
});
