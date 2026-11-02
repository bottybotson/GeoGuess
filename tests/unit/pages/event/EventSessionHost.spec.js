import { mount } from '@vue/test-utils';
import EventHost from '@/pages/event/EventHost.vue';
import EventSessionHost from '@/pages/event/EventSessionHost.vue';

const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};
const flush = async wrapper => { for (let i = 0; i < 12; i++) await Promise.resolve(); await wrapper.vm.$nextTick(); };
const setup = id => ({ id, panoramaId: 'private-panorama', heading: 20, pitch: 0, answer: { lat: 1, lng: 2 }, difficulty: 1 });
const projection = (phase = 'lobby', roundId = 'r01', revision = 0) => ({
    title: 'Party', formatVersion: 2, phase, roundId, revision, roundCount: 2,
    participants: [{ id: 'g1', nickname: 'Alex' }],
    ...(['reveal', 'complete'].includes(phase) ? { lastRevealedRoundId: roundId } : roundId === 'r02' ? { lastRevealedRoundId: 'r01' } : {}),
});
function client() {
    const listeners = [], timing = [], authListeners = [];
    const session = {
        getHostSetup: jest.fn((eventId, id) => Promise.resolve(setup(id))),
        subscribeTiming: jest.fn((eventId, roundId, onChange, onError) => {
            const listener = { roundId, onChange, onError, dispose: jest.fn() };
            timing.push(listener);
            onChange({ timing: null, offsetMs: 0, connected: true });
            return listener.dispose;
        }),
        getReveal: jest.fn((eventId, roundId) => Promise.resolve({ roundId, answer: { lat: 1, lng: 2 }, results: { g1: { nickname: 'Alex', answered: true, points: 50, totalPoints: roundId === 'r01' ? 50 : 100, distance: 100 } } })),
        getServerTime: jest.fn().mockResolvedValue({ nowMs: 100000, offsetMs: 0 }),
        setDeadline: jest.fn().mockResolvedValue({ status: 'set' }),
    };
    for (const [name, status] of Object.entries({ start: 'started', close: 'closed', reveal: 'revealed', next: 'advanced', complete: 'completed' })) session[name] = jest.fn().mockResolvedValue({ status });
    return {
        session, listeners, timing, authListeners,
        subscribeAuth: jest.fn((onChange, onError) => {
            const listener = { onChange, onError, dispose: jest.fn() };
            authListeners.push(listener);
            onChange({ uid: 'host' });
            return listener.dispose;
        }),
        getFormatVersion: jest.fn().mockResolvedValue(2),
        restore: jest.fn().mockResolvedValue({ uid: 'host' }), signIn: jest.fn().mockResolvedValue({ uid: 'host' }), signOut: jest.fn().mockResolvedValue(),
        subscribe: jest.fn((eventId, onChange, onError) => {
            const listener = { eventId, onChange, onError, dispose: jest.fn() };
            listeners.push(listener); return listener.dispose;
        }),
    };
}
async function ready(value = projection(), hostClient = client()) {
    const wrapper = mount(EventSessionHost, { propsData: { eventId: 'party', hostClient } });
    await flush(wrapper);
    hostClient.listeners[0].onChange(value);
    await flush(wrapper);
    return { wrapper, hostClient };
}
const button = (wrapper, text) => wrapper.findAll('button').wrappers.find(item => item.text() === text);

describe('version-dispatched host', () => {
    it('detects format before restoring identity and preserves v1', async () => {
        const hostClient = client(), version = deferred();
        hostClient.getFormatVersion.mockReturnValue(version.promise);
        const wrapper = mount(EventHost, { propsData: { eventId: 'party', hostClient } });
        expect(hostClient.restore).not.toHaveBeenCalled();
        version.resolve(1);
        await flush(wrapper);
        expect(wrapper.findComponent({ name: 'EventLegacyHost' }).exists()).toBe(true);
        expect(hostClient.getFormatVersion).toHaveBeenCalledWith('party');
        wrapper.destroy();
    });
    it('fails closed for unsupported formats and stale version replies', async () => {
        const hostClient = client(), version = deferred();
        hostClient.getFormatVersion.mockReturnValueOnce(version.promise).mockResolvedValue(3);
        const wrapper = mount(EventHost, { propsData: { eventId: 'A', hostClient } });
        await wrapper.setProps({ eventId: 'B' });
        version.resolve(2);
        await flush(wrapper);
        expect(hostClient.restore).not.toHaveBeenCalled();
        expect(wrapper.text()).toContain('Event format is unavailable');
        wrapper.destroy();
    });
});

describe('multi-round host', () => {
    it('runs two rounds with a separate ready/start and final complete', async () => {
        const { wrapper, hostClient: host } = await ready();
        const send = async (phase, id, revision) => { host.listeners[0].onChange(projection(phase, id, revision)); await flush(wrapper); };
        expect(wrapper.text()).toContain('Round 1 of 2');
        expect(wrapper.text()).not.toContain('private-panorama');
        for (const [label, command, phase, revision] of [['Start round', 'start', 'guessing', 1], ['Close guessing', 'close', 'closed', 2], ['Reveal results', 'reveal', 'reveal', 3]]) {
            await button(wrapper, label).trigger('click'); await flush(wrapper);
            expect(host.session[command]).toHaveBeenLastCalledWith('party', { roundId: 'r01', revision: revision - 1 });
            await send(phase, 'r01', revision);
        }
        expect(wrapper.findComponent({ name: 'EventRoundResults' }).props('cumulative')).toBe(true);
        await button(wrapper, 'Next round').trigger('click'); await flush(wrapper);
        expect(host.session.next).toHaveBeenCalledWith('party', { roundId: 'r01', revision: 3 });
        await send('ready', 'r02', 4);
        expect(wrapper.text()).toContain('Round 2 of 2');
        expect(host.session.start).toHaveBeenCalledTimes(1);
        expect(host.session.getHostSetup).toHaveBeenLastCalledWith('party', 'r02');
        expect(host.timing[0].dispose).toHaveBeenCalledTimes(1);
        for (const [label, command, phase, revision] of [['Start round', 'start', 'guessing', 5], ['Close guessing', 'close', 'closed', 6], ['Reveal results', 'reveal', 'reveal', 7], ['Finish event', 'complete', 'complete', 8]]) {
            await button(wrapper, label).trigger('click'); await flush(wrapper);
            expect(host.session[command]).toHaveBeenLastCalledWith('party', { roundId: 'r02', revision: revision - 1 });
            await send(phase, 'r02', revision);
        }
        expect(wrapper.text()).toContain('Event complete');
        expect(button(wrapper, 'Next round')).toBeUndefined();
        expect(wrapper.findComponent({ name: 'EventRoundResults' }).props('final')).toBe(true);
        wrapper.destroy();
    });
    it.each([['lobby', 'r01', 0], ['ready', 'r02', 4], ['guessing', 'r02', 5], ['closed', 'r02', 6], ['reveal', 'r02', 7], ['complete', 'r02', 8]])('restores direct reload in %s', async (phase, id, revision) => {
        const { wrapper, hostClient: host } = await ready(projection(phase, id, revision));
        expect(host.session.getHostSetup).toHaveBeenCalledWith('party', id);
        expect(wrapper.find('[aria-label="Host controls"]').exists()).toBe(true);
        await wrapper.vm.restore(); await flush(wrapper);
        expect(host.listeners[0].dispose).toHaveBeenCalledTimes(1);
        host.listeners[1].onChange(projection(phase, id, revision)); await flush(wrapper);
        expect(wrapper.find('[aria-label="Host controls"]').exists()).toBe(true);
        wrapper.destroy();
    });
    it('keeps the displayed expected state on double click and uncertain retry', async () => {
        const { wrapper, hostClient: host } = await ready();
        const pending = deferred(); host.session.start.mockReturnValueOnce(pending.promise);
        await button(wrapper, 'Start round').trigger('click');
        await wrapper.vm.runCommand('start');
        expect(host.session.start).toHaveBeenCalledTimes(1);
        host.listeners[0].onChange(projection('guessing', 'r01', 1)); await flush(wrapper);
        pending.reject(new Error('uncertain')); await flush(wrapper);
        await button(wrapper, 'Retry start').trigger('click'); await flush(wrapper);
        expect(host.session.start).toHaveBeenLastCalledWith('party', { roundId: 'r01', revision: 0 });
        wrapper.destroy();
    });
    it('retains one absolute deadline and expected state for timing retry', async () => {
        const { wrapper, hostClient: host } = await ready(projection('guessing', 'r02', 5));
        host.session.setDeadline.mockRejectedValueOnce(new Error('uncertain'));
        await button(wrapper, 'Start 2 minute timer').trigger('click'); await flush(wrapper);
        expect(host.session.setDeadline).toHaveBeenCalledWith('party', { roundId: 'r02', revision: 5 }, 220000);
        await button(wrapper, 'Retry timing update').trigger('click'); await flush(wrapper);
        expect(host.session.getServerTime).toHaveBeenCalledTimes(1);
        expect(host.session.setDeadline).toHaveBeenLastCalledWith('party', { roundId: 'r02', revision: 5 }, 220000);
        host.timing[0].onChange({ timing: null, offsetMs: null, connected: false }); await flush(wrapper);
        expect(button(wrapper, 'Close guessing').attributes('disabled')).toBe('disabled');
        wrapper.destroy();
    });
    it('locks controls until private setup resolves and ignores stale setup on event changes', async () => {
        const host = client(), pending = deferred();
        host.session.getHostSetup.mockReturnValueOnce(pending.promise);
        const { wrapper } = await ready(projection(), host);
        expect(wrapper.find('[aria-label="Host controls"]').exists()).toBe(false);
        await wrapper.setProps({ eventId: 'other' }); await flush(wrapper);
        pending.resolve(setup('r01')); await flush(wrapper);
        expect(wrapper.find('[aria-label="Host controls"]').exists()).toBe(false);
        host.listeners[0].onChange(projection('reveal', 'r01', 3)); await flush(wrapper);
        expect(wrapper.text()).not.toContain('Results revealed');
        wrapper.destroy();
    });
    it('clears authorization on round changes and on sign-out before acknowledgements', async () => {
        const { wrapper, hostClient: host } = await ready();
        const setupReply = deferred(); host.session.getHostSetup.mockReturnValueOnce(setupReply.promise);
        host.listeners[0].onChange(projection('ready', 'r02', 4)); await flush(wrapper);
        expect(wrapper.find('[aria-label="Host controls"]').exists()).toBe(false);
        const out = deferred(); host.signOut.mockReturnValue(out.promise);
        await button(wrapper, 'Sign out').trigger('click');
        setupReply.resolve(setup('r02')); await flush(wrapper);
        expect(wrapper.find('[aria-label="Host controls"]').exists()).toBe(false);
        expect(wrapper.find('form').exists()).toBe(true);
        out.resolve(); await flush(wrapper); wrapper.destroy();
    });
    it('reports stale state without rebasing or executing a new command', async () => {
        const { wrapper, hostClient: host } = await ready();
        host.session.start.mockRejectedValueOnce(Object.assign(new Error('stale-state'), { code: 'stale-state' }));
        await button(wrapper, 'Start round').trigger('click'); await flush(wrapper);
        expect(wrapper.text()).toContain('These controls are out of date');
        host.listeners[0].onChange(projection('guessing', 'r01', 1)); await flush(wrapper);
        expect(button(wrapper, 'Close guessing').attributes('disabled')).toBe('disabled');
        await button(wrapper, 'Retry start').trigger('click'); await flush(wrapper);
        expect(host.session.start).toHaveBeenLastCalledWith('party', { roundId: 'r01', revision: 0 });
        expect(host.session.close).not.toHaveBeenCalled();
        wrapper.destroy();
    });
    it('does not write a timer after server-time lookup crosses a round change', async () => {
        const { wrapper, hostClient: host } = await ready(projection('guessing', 'r01', 1));
        const time = deferred(); host.session.getServerTime.mockReturnValue(time.promise);
        await button(wrapper, 'Start 2 minute timer').trigger('click');
        host.listeners[0].onChange(projection('ready', 'r02', 4)); await flush(wrapper);
        time.resolve({ nowMs: 100000 }); await flush(wrapper);
        expect(host.session.setDeadline).not.toHaveBeenCalled();
        expect(wrapper.vm.pendingTiming).toBeNull();
        expect(wrapper.vm.privateSetup.id).toBe('r02');
        wrapper.destroy();
    });
    it('clears private setup and ignores late reveal replies after subscription failure', async () => {
        const host = client(), result = deferred(); host.session.getReveal.mockReturnValue(result.promise);
        const { wrapper } = await ready(projection('reveal', 'r01', 3), host);
        host.listeners[0].onError(new Error('offline')); await flush(wrapper);
        result.resolve({ roundId: 'r01', answer: { lat: 1, lng: 2 }, results: {} }); await flush(wrapper);
        expect(wrapper.vm.privateSetup).toBeNull();
        expect(wrapper.vm.reveal).toBeNull();
        expect(wrapper.find('[aria-label="Host controls"]').exists()).toBe(false);
        wrapper.destroy();
    });

    it('keeps private state cleared while initial account observation is pending', async () => {
        const host = client(); let changed;
        host.subscribeAuth.mockImplementation(next => { changed = next; return jest.fn(); });
        const wrapper = mount(EventSessionHost, { propsData: { eventId: 'party', hostClient: host } });
        await flush(wrapper);
        expect(host.restore).not.toHaveBeenCalled();
        expect(wrapper.vm.privateSetup).toBeNull();
        expect(wrapper.find('button[type="submit"]').element.disabled).toBe(true);
        changed(null); await flush(wrapper);
        expect(wrapper.find('button[type="submit"]').element.disabled).toBe(true);
        await wrapper.find('#event-host-email').setValue('host@example.test');
        await wrapper.find('#event-host-password').setValue('password');
        await wrapper.find('form').trigger('submit'); await flush(wrapper);
        expect(host.subscribe).not.toHaveBeenCalled();
        expect(wrapper.find('[aria-label="Host controls"]').exists()).toBe(false);
        changed({ uid: 'host' }); await flush(wrapper);
        host.listeners[0].onChange(projection()); await flush(wrapper);
        expect(wrapper.find('[aria-label="Host controls"]').exists()).toBe(true);
        wrapper.destroy();
    });
    it('invalidates pending setup immediately on cross-tab signout and disposes account observation', async () => {
        const host = client(), pending = deferred();
        host.session.getHostSetup.mockReturnValueOnce(pending.promise);
        const { wrapper } = await ready(projection(), host);
        host.authListeners[0].onChange(null);
        expect(wrapper.vm.privateSetup).toBeNull();
        expect(wrapper.vm.state).toBeNull();
        expect(host.listeners[0].dispose).toHaveBeenCalledTimes(1);
        pending.resolve(setup('r01')); await flush(wrapper);
        expect(wrapper.vm.authorized).toBe(false);
        host.listeners[0].onChange(projection('reveal', 'r01', 3)); await flush(wrapper);
        expect(wrapper.vm.state).toBeNull();
        wrapper.destroy();
        expect(host.authListeners[0].dispose).toHaveBeenCalledTimes(1);
        host.authListeners[0].onChange({ uid: 'host' });
        expect(host.restore).toHaveBeenCalledTimes(1);
    });
    it('requires fresh setup for a switched account and ignores the previous account command reply', async () => {
        const { wrapper, hostClient: host } = await ready();
        const command = deferred(), newSetup = deferred();
        host.session.start.mockReturnValue(command.promise);
        await button(wrapper, 'Start round').trigger('click');
        host.restore.mockResolvedValue({ uid: 'other-host' });
        host.session.getHostSetup.mockReturnValueOnce(newSetup.promise);
        host.authListeners[0].onChange({ uid: 'other-host' });
        expect(wrapper.vm.authorized).toBe(false);
        expect(wrapper.vm.privateSetup).toBeNull();
        expect(wrapper.vm.pendingCommand).toBeNull();
        await flush(wrapper);
        host.listeners[1].onChange(projection()); await flush(wrapper);
        expect(wrapper.find('[aria-label="Host controls"]').exists()).toBe(false);
        command.resolve({ status: 'started' }); await flush(wrapper);
        expect(wrapper.vm.message).not.toBe('The event update was acknowledged.');
        newSetup.reject(new Error('permission-denied')); await flush(wrapper);
        expect(wrapper.find('[aria-label="Host controls"]').exists()).toBe(false);
        expect(wrapper.text()).toContain('Host access or active-round setup is unavailable');
        wrapper.destroy();
    });
    it('fails closed on auth observer errors and disposes stale observers across event changes', async () => {
        const { wrapper, hostClient: host } = await ready();
        host.authListeners[0].onError(new Error('offline')); await flush(wrapper);
        expect(wrapper.vm.privateSetup).toBeNull();
        expect(wrapper.vm.authorized).toBe(false);
        expect(host.authListeners[0].dispose).toHaveBeenCalledTimes(1);
        expect(button(wrapper, 'Reconnect')).toBeDefined();
        host.authListeners[0].onChange({ uid: 'host' }); await flush(wrapper);
        expect(host.restore).toHaveBeenCalledTimes(1);
        await button(wrapper, 'Reconnect').trigger('click'); await flush(wrapper);
        expect(host.subscribeAuth).toHaveBeenCalledTimes(2);
        await wrapper.setProps({ eventId: 'other' }); await flush(wrapper);
        expect(host.authListeners[1].dispose).toHaveBeenCalledTimes(1);
        host.authListeners[1].onChange(null); await flush(wrapper);
        expect(wrapper.vm.authUid).toBe('host');
        wrapper.destroy();
        expect(host.authListeners[2].dispose).toHaveBeenCalledTimes(1);
    });

});
