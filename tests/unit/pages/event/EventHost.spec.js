import { mount } from '@vue/test-utils';
import EventHost from '@/pages/event/EventHost.vue';

const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};

function makeClient({ user = null } = {}) {
    const listeners = [];
    return {
        listeners,
        restore: jest.fn().mockResolvedValue(user),
        signIn: jest.fn().mockResolvedValue({ uid: 'host' }),
        signOut: jest.fn().mockResolvedValue(undefined),
        getHostSetup: jest.fn().mockResolvedValue({ answer: { lat: 1, lng: 2 }, panoramaId: 'private' }),
        subscribe: jest.fn((eventId, onChange, onError) => {
            const listener = { eventId, onChange, onError, dispose: jest.fn() };
            listeners.push(listener);
            return listener.dispose;
        }),
        start: jest.fn().mockResolvedValue({ status: 'started' }),
        close: jest.fn().mockResolvedValue({ status: 'closed' }),
        reveal: jest.fn().mockResolvedValue({ status: 'revealed' }),
        getReveal: jest.fn().mockResolvedValue({
            roundId: 'r1', answer: { lat: 1, lng: 2 }, results: { guest_1: { nickname: 'Alex', answered: true, points: 50, distance: 1000 } },
        }),
    };
}

const projection = (phase = 'lobby', participants = []) => ({ title: 'Party', phase, participants });

async function readyHost(client = makeClient({ user: { uid: 'host' } }), eventId = 'party') {
    const wrapper = mount(EventHost, { propsData: { eventId, hostClient: client } });
    await Promise.resolve();
    await wrapper.vm.$nextTick();
    return { wrapper, client };
}

describe('EventHost', () => {
    it('restores the host, checks server authorization before showing controls, and whitelists roster data', async () => {
        const setup = deferred();
        const client = makeClient({ user: { uid: 'host' } });
        client.getHostSetup.mockReturnValue(setup.promise);
        const { wrapper } = await readyHost(client);

        expect(client.restore).toHaveBeenCalledTimes(1);
        expect(wrapper.find('[aria-label="Host controls"]').exists()).toBe(false);
        expect(wrapper.find('button').exists()).toBe(false);
        expect(wrapper.text()).not.toContain('Start game');
        setup.resolve({ answer: { lat: 9, lng: 8 }, adminToken: 'hidden' });
        await Promise.resolve();
        await wrapper.vm.$nextTick();
        expect(client.subscribe).toHaveBeenCalledWith('party', expect.any(Function), expect.any(Function));
        client.listeners[0].onChange(projection('lobby', [{ id: 'g1', nickname: 'Alex', guess: 'secret' }]));
        await wrapper.vm.$nextTick();
        expect(wrapper.text()).toContain('Alex');
        expect(wrapper.text()).not.toMatch(/hidden|secret|9|8/);
        expect(wrapper.text()).toContain('Start game');
        wrapper.destroy();
        expect(client.listeners[0].dispose).toHaveBeenCalledTimes(1);
    });

    it('uses labelled email and password fields, clears the password, and shows generic sign-in failures', async () => {
        const client = makeClient();
        client.signIn.mockRejectedValue(new Error('auth/internal-secret-detail'));
        const { wrapper } = await readyHost(client);
        expect(wrapper.find('label[for="event-host-email"]').exists()).toBe(true);
        expect(wrapper.find('label[for="event-host-password"]').exists()).toBe(true);
        await wrapper.find('#event-host-email').setValue('host@example.test');
        await wrapper.find('#event-host-password').setValue('private-password');
        await wrapper.find('form').trigger('submit');
        await Promise.resolve();
        await wrapper.vm.$nextTick();
        expect(client.signIn).toHaveBeenCalledWith('host@example.test', 'private-password');
        expect(wrapper.find('#event-host-password').element.value).toBe('');
        expect(wrapper.text()).toContain('We couldn’t sign in or load host access.');
        expect(wrapper.text()).not.toContain('internal-secret-detail');
        expect(wrapper.text()).not.toContain('private-password');
        wrapper.destroy();
    });

    it('gates actions by server phase and lobby roster, then displays results only after reveal', async () => {
        const { wrapper, client } = await readyHost();
        const listener = client.listeners[0];
        listener.onChange(projection('lobby'));
        await wrapper.vm.$nextTick();
        const lobbyStartButton = wrapper.findAll('button').wrappers.find(button => button.text() === 'Start game');
        expect(lobbyStartButton.attributes('disabled')).toBe('disabled');

        listener.onChange(projection('lobby', [{ id: 'g1', nickname: 'Alex' }]));
        await wrapper.vm.$nextTick();
        const startAck = deferred();
        client.start.mockReturnValue(startAck.promise);
        const startButton = wrapper.findAll('button').wrappers.find(button => button.text() === 'Start game');
        const firstAttempt = startButton.trigger('click');
        await startButton.trigger('click');
        expect(client.start).toHaveBeenCalledTimes(1);
        startAck.resolve({ status: 'started' });
        await firstAttempt;
        expect(client.start).toHaveBeenCalledWith('party');
        expect(wrapper.findComponent({ name: 'EventRoundResults' }).exists()).toBe(false);

        listener.onChange(projection('guessing', [{ id: 'g1', nickname: 'Alex' }]));
        await wrapper.vm.$nextTick();
        expect(wrapper.text()).toContain('Close guessing');
        await wrapper.findAll('button').wrappers.find(button => button.text() === 'Close guessing').trigger('click');
        expect(client.close).toHaveBeenCalledWith('party');

        listener.onChange(projection('closed', [{ id: 'g1', nickname: 'Alex' }]));
        await wrapper.vm.$nextTick();
        expect(wrapper.text()).toContain('Reveal results');
        expect(wrapper.findComponent({ name: 'EventRoundResults' }).exists()).toBe(false);
        await wrapper.findAll('button').wrappers.find(button => button.text() === 'Reveal results').trigger('click');
        expect(client.reveal).toHaveBeenCalledWith('party');
        listener.onChange(projection('reveal', [{ id: 'g1', nickname: 'Alex' }]));
        await Promise.resolve();
        await wrapper.vm.$nextTick();
        expect(client.getReveal).toHaveBeenCalledWith('party');
        expect(wrapper.findComponent({ name: 'EventRoundResults' }).exists()).toBe(true);
        wrapper.destroy();
    });

    it('reports ambiguous acknowledgements without retrying a command', async () => {
        const { wrapper, client } = await readyHost();
        client.start.mockRejectedValue(new Error('timeout'));
        client.listeners[0].onChange(projection('lobby', [{ id: 'g1', nickname: 'Alex' }]));
        await wrapper.vm.$nextTick();
        await wrapper.findAll('button').wrappers.find(button => button.text() === 'Start game').trigger('click');
        await Promise.resolve();
        await wrapper.vm.$nextTick();
        expect(client.start).toHaveBeenCalledTimes(1);
        expect(wrapper.text()).toContain('We couldn’t confirm that update. Check the event status');
        wrapper.destroy();
    });

    it('clears private state and disposes immediately on logout before sign-out settles', async () => {
        const logout = deferred();
        const { wrapper, client } = await readyHost();
        client.listeners[0].onChange(projection('reveal'));
        await Promise.resolve();
        await wrapper.vm.$nextTick();
        client.signOut.mockReturnValue(logout.promise);
        await wrapper.findAll('button').wrappers.find(button => button.text() === 'Sign out').trigger('click');
        expect(client.listeners[0].dispose).toHaveBeenCalledTimes(1);
        expect(wrapper.findComponent({ name: 'EventRoundResults' }).exists()).toBe(false);
        expect(wrapper.text()).not.toContain('Alex');
        expect(wrapper.find('form').exists()).toBe(true);
        logout.resolve();
        await Promise.resolve();
        wrapper.destroy();
    });

    it('ignores stale auth, subscription, and command results across A to B to A', async () => {
        const client = makeClient({ user: { uid: 'host' } });
        const command = deferred();
        client.start.mockReturnValue(command.promise);
        const { wrapper } = await readyHost(client, 'A');
        const oldA = client.listeners[0];
        oldA.onChange(projection('lobby', [{ id: 'g1', nickname: 'Alex' }]));
        await wrapper.vm.$nextTick();
        const button = wrapper.findAll('button').wrappers.find(item => item.text() === 'Start game');
        const pendingCommand = button.trigger('click');
        await wrapper.setProps({ eventId: 'B' });
        const bRestore = client.restore.mock.results[1].value;
        await wrapper.setProps({ eventId: 'A' });
        oldA.onChange(projection('reveal', [{ id: 'stale', nickname: 'Stale' }]));
        command.resolve({ status: 'started' });
        await pendingCommand;
        await Promise.resolve();
        expect(oldA.dispose).toHaveBeenCalledTimes(1);
        expect(wrapper.text()).not.toContain('Stale');
        expect(wrapper.text()).not.toContain('Alex');
        expect(bRestore).toBeDefined();
        wrapper.destroy();
    });

    it('handles synchronous subscription errors and ignores callbacks after unmount', async () => {
        const client = makeClient({ user: { uid: 'host' } });
        const dispose = jest.fn();
        client.subscribe.mockImplementation((eventId, onChange, onError) => {
            onChange(projection());
            onError(new Error('permission-denied'));
            return dispose;
        });
        const { wrapper } = await readyHost(client);
        await wrapper.vm.$nextTick();
        expect(dispose).toHaveBeenCalledTimes(1);
        expect(wrapper.text()).toContain('The event connection was lost.');
        wrapper.destroy();
        expect(dispose).toHaveBeenCalledTimes(1);
    });
});
