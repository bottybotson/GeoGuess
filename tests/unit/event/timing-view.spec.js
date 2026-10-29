import { mount } from '@vue/test-utils';
import timingView from '@/event/timing-view';

const fixture = () => mount({ mixins: [timingView], render: h => h('div') });

describe('shared timing view', () => {
    afterEach(() => jest.useRealTimers());

    it('uses the server offset and updates the display clock at half-second intervals', () => {
        jest.useFakeTimers();
        jest.setSystemTime(1000);
        const wrapper = fixture();
        const client = { subscribeTiming: jest.fn((eventId, onChange) => {
            onChange({ timing: null, offsetMs: 250, connected: true });
            return jest.fn();
        }) };
        wrapper.vm.observeTiming(client, 'party');
        expect(wrapper.vm.nowMs).toBe(1250);
        expect(wrapper.vm.serverNowMs).toBe(1250);
        jest.advanceTimersByTime(500);
        expect(wrapper.vm.nowMs).toBe(1750);
        wrapper.destroy();
        expect(jest.getTimerCount()).toBe(0);
    });

    it('disposes synchronous cancellation exactly once and ignores late callbacks', () => {
        const dispose = jest.fn();
        let lateChange;
        const client = { subscribeTiming: jest.fn((eventId, onChange, onError) => {
            lateChange = onChange;
            onChange({ timing: null, offsetMs: 0, connected: true });
            onError(new Error('offline'));
            return dispose;
        }) };
        const wrapper = fixture();
        wrapper.vm.observeTiming(client, 'party');
        expect(dispose).toHaveBeenCalledTimes(1);
        expect(wrapper.vm.timingConnected).toBe(false);
        lateChange({ timing: null, offsetMs: 0, connected: true });
        expect(wrapper.vm.timingConnected).toBe(false);
        wrapper.destroy();
        expect(dispose).toHaveBeenCalledTimes(1);
    });

    it('can subscribe again after a terminal error and stops callbacks on disable', () => {
        const listeners = [];
        const client = { subscribeTiming: jest.fn((eventId, onChange, onError) => {
            const listener = { onChange, onError, dispose: jest.fn() };
            listeners.push(listener);
            onChange({ timing: null, offsetMs: 0, connected: true });
            return listener.dispose;
        }) };
        const wrapper = fixture();
        wrapper.vm.observeTiming(client, 'party');
        listeners[0].onError(new Error('offline'));
        wrapper.vm.observeTiming(client, 'party');
        expect(client.subscribeTiming).toHaveBeenCalledTimes(2);
        wrapper.vm.observeTiming(client, 'party', false);
        listeners[1].onChange({ timing: null, offsetMs: 0, connected: true });
        expect(wrapper.vm.timingConnected).toBe(false);
        expect(listeners[1].dispose).toHaveBeenCalledTimes(1);
        wrapper.destroy();
    });

    it('fails closed for fractional clock offsets', () => {
        const wrapper = fixture();
        const client = { subscribeTiming: jest.fn((eventId, onChange) => {
            onChange({ timing: null, offsetMs: 0.5, connected: true });
            return jest.fn();
        }) };
        wrapper.vm.observeTiming(client, 'party');
        expect(wrapper.vm.timingConnected).toBe(false);
        expect(wrapper.vm.nowMs).toBe(null);
        wrapper.destroy();
    });
});
