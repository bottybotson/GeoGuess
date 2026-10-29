import { mount } from '@vue/test-utils';
import EventPresentation from '@/pages/event/EventPresentation.vue';

const projection = (extra = {}) => ({
    title: 'Birthday game',
    phase: 'lobby',
    participants: [{ id: 'guest_1', nickname: 'Alex' }],
    ...extra,
});

function clientWithListener() {
    const listeners = [];
    const timingListeners = [];
    return {
        listeners,
        timingListeners,
        subscribe: jest.fn((eventId, onChange, onError) => {
            const listener = { eventId, onChange, onError, dispose: jest.fn() };
            listeners.push(listener);
            return listener.dispose;
        }),
        subscribeTiming: jest.fn((eventId, onChange, onError) => {
            const listener = { eventId, onChange, onError, dispose: jest.fn() };
            timingListeners.push(listener);
            onChange({ timing: null, offsetMs: 0, connected: true });
            return listener.dispose;
        }),
    };
}

describe('EventPresentation', () => {
    it('shows loading until the public projection arrives, then renders the view and public join URL', async () => {
        const client = clientWithListener();
        const wrapper = mount(EventPresentation, {
            propsData: { eventId: 'party', lobbyClient: client,
                joinUrl: 'https://example.test/event/party/join?admin=secret#private' },
        });

        expect(wrapper.find('[role="status"]').text()).toContain('Loading the public event view');
        client.listeners[0].onChange(projection());
        await wrapper.vm.$nextTick();

        expect(wrapper.find('h1').text()).toBe('Birthday game');
        expect(wrapper.text()).toContain('1 of 50 guests');
        expect(wrapper.text()).toContain('Alex');
        expect(wrapper.text()).toContain('https://example.test/event/party/join');
        expect(wrapper.text()).not.toMatch(/secret|private/);
        expect(wrapper.find('.event-join-qr img').attributes('src')).toMatch(/^data:image\/gif;base64,/);
        wrapper.destroy();
        expect(client.listeners[0].dispose).toHaveBeenCalledTimes(1);
    });

    it('renders an accessible explicit reconnect control after errors and retries only when clicked', async () => {
        const client = clientWithListener();
        const wrapper = mount(EventPresentation, { propsData: { eventId: 'party', lobbyClient: client } });
        client.listeners[0].onError(new Error('offline'));
        await wrapper.vm.$nextTick();

        const button = wrapper.find('button');
        expect(wrapper.find('[role="status"]').text()).toContain('Presentation connection lost');
        expect(button.text()).toBe('Reconnect');
        expect(parseFloat(button.element.style.minHeight)).toBeGreaterThanOrEqual(48);
        expect(client.subscribe).toHaveBeenCalledTimes(1);

        await button.trigger('click');
        expect(client.subscribe).toHaveBeenCalledTimes(2);
        expect(client.listeners[0].dispose).toHaveBeenCalledTimes(1);
        expect(wrapper.find('[role="status"]').text()).toContain('Loading');
        wrapper.destroy();
    });

    it('does not join or call any lobby commands', async () => {
        const client = clientWithListener();
        const wrapper = mount(EventPresentation, { propsData: { eventId: 'party', lobbyClient: client } });
        client.listeners[0].onChange(projection());
        await wrapper.setProps({ joinUrl: 'https://example.test/event/party/join?admin=secret#private' });
        wrapper.destroy();

        expect(client.subscribe).toHaveBeenCalledTimes(1);
        expect(Object.keys(client)).toEqual(['listeners', 'timingListeners', 'subscribe', 'subscribeTiming']);
        expect(client.listeners[0].dispose).toHaveBeenCalledTimes(1);
    });

    it('shows the read-only countdown during guessing and cleans up timing observation', async () => {
        const lobby = clientWithListener();
        const round = clientWithListener();
        const wrapper = mount(EventPresentation, { propsData: {
            eventId: 'party', lobbyClient: lobby, roundClient: round,
        } });
        lobby.listeners[0].onChange(projection({ phase: 'guessing' }));
        await wrapper.vm.$nextTick();
        expect(round.subscribeTiming).toHaveBeenCalledWith('party', expect.any(Function), expect.any(Function));
        expect(wrapper.find('.event-round-timer').text()).toContain('No time limit');
        expect(wrapper.find('.event-presentation-page__timer').exists()).toBe(true);
        wrapper.destroy();
        expect(round.timingListeners[0].dispose).toHaveBeenCalledTimes(1);
    });

    it('omits QR and link data for a URL that is not the current public join route', async () => {
        const client = clientWithListener();
        const wrapper = mount(EventPresentation, { propsData: {
            eventId: 'party', lobbyClient: client, joinUrl: 'https://example.test/event/other/host?token=secret',
        } });
        client.listeners[0].onChange(projection());
        await wrapper.vm.$nextTick();

        expect(wrapper.text()).not.toContain('secret');
        expect(wrapper.find('.event-join-qr').exists()).toBe(false);
        wrapper.destroy();
    });

    it('projects only title, phase, participant ID and nickname from callback data', async () => {
        const client = clientWithListener();
        const wrapper = mount(EventPresentation, {
            attrs: { 'private-token': 'dom-leak' },
            propsData: { eventId: 'party', lobbyClient: client },
        });
        client.listeners[0].onChange(projection({
            adminToken: 'secret',
            answers: ['secret-answer'],
            participants: [{
                id: 'guest_1', nickname: 'Alex', score: 999, guess: 'secret-guess', privateSetup: 'secret',
            }],
        }));
        await wrapper.vm.$nextTick();

        expect(wrapper.find('li').text()).toBe('Alex');
        expect(wrapper.text()).not.toMatch(/secret|999/);
        expect(wrapper.element.hasAttribute('private-token')).toBe(false);
        expect(wrapper.element.outerHTML).not.toContain('adminToken');
        wrapper.destroy();
    });

    it('shows unavailable state for malformed or unsupported projections and retries explicitly', async () => {
        const client = clientWithListener();
        const wrapper = mount(EventPresentation, { propsData: { eventId: 'party', lobbyClient: client } });
        client.listeners[0].onChange(projection({ phase: 'constructor' }));
        await wrapper.vm.$nextTick();

        expect(wrapper.find('[role="status"]').text()).toContain('Presentation unavailable');
        await wrapper.find('button').trigger('click');
        expect(client.subscribe).toHaveBeenCalledTimes(2);
        wrapper.destroy();
    });

    it('disposes and ignores late callbacks when event or client changes, including A to B to A', async () => {
        const firstClient = clientWithListener();
        const secondClient = clientWithListener();
        const wrapper = mount(EventPresentation, { propsData: { eventId: 'A', lobbyClient: firstClient } });
        const firstA = firstClient.listeners[0];
        firstA.onChange(projection({ title: 'current A' }));
        await wrapper.vm.$nextTick();

        const changingEvent = wrapper.setProps({ eventId: 'B' });
        firstA.onChange(projection({ title: 'stale before reconnect' }));
        expect(wrapper.vm.projection.title).toBe('current A');
        await changingEvent;
        expect(firstA.dispose).toHaveBeenCalledTimes(1);
        await wrapper.setProps({ eventId: 'A', lobbyClient: secondClient });
        firstA.onChange(projection({ title: 'stale A' }));
        expect(wrapper.find('[role="status"]').exists()).toBe(true);
        secondClient.listeners[0].onChange(projection({ title: 'fresh A' }));
        await wrapper.vm.$nextTick();
        expect(wrapper.find('h1').text()).toBe('fresh A');

        await wrapper.setProps({ lobbyClient: firstClient });
        expect(secondClient.listeners[0].dispose).toHaveBeenCalledTimes(1);
        wrapper.destroy();
        expect(firstClient.listeners[1].dispose).toHaveBeenCalledTimes(1);
    });

    it('handles synchronous initial callbacks and cancellation before subscribe returns its disposer', async () => {
        const dispose = jest.fn();
        const client = {
            subscribe: jest.fn((eventId, onChange, onError) => {
                onChange(projection({ title: 'initial' }));
                onError(new Error('cancelled during registration'));
                return dispose;
            }),
        };
        const wrapper = mount(EventPresentation, { propsData: { eventId: 'party', lobbyClient: client } });
        await wrapper.vm.$nextTick();

        expect(wrapper.find('[role="status"]').text()).toContain('Presentation connection lost');
        expect(dispose).toHaveBeenCalledTimes(1);
        wrapper.destroy();
        expect(dispose).toHaveBeenCalledTimes(1);
    });

    it('shows an error if registration throws and does not schedule automatic reconnects', async () => {
        const client = { subscribe: jest.fn(() => { throw new Error('registration failed'); }) };
        const wrapper = mount(EventPresentation, { propsData: { eventId: 'party', lobbyClient: client } });
        await wrapper.vm.$nextTick();

        expect(wrapper.find('[role="status"]').text()).toContain('Presentation connection lost');
        expect(client.subscribe).toHaveBeenCalledTimes(1);
        wrapper.destroy();
    });

    it('disposes on unmount and ignores callbacks that arrive afterward', () => {
        const client = clientWithListener();
        const wrapper = mount(EventPresentation, { propsData: { eventId: 'party', lobbyClient: client } });
        const listener = client.listeners[0];
        wrapper.destroy();

        listener.onChange(projection({ title: 'too late' }));
        listener.onError(new Error('too late'));
        expect(listener.dispose).toHaveBeenCalledTimes(1);
    });
});
