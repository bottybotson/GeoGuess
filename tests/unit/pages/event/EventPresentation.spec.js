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

const multiProjection = (phase = 'lobby', roundId = 'r01') => projection({
    phase, formatVersion: 2, roundId, roundCount: 2, revision: 0,
});
const state = (phase, roundId, lastRevealedRoundId = null) => {
    const roundNumber = Number(roundId.slice(1));
    const revision = { lobby: 0, ready: 4 * roundNumber - 4, guessing: 4 * roundNumber - 3,
        closed: 4 * roundNumber - 2, reveal: 4 * roundNumber - 1, complete: 4 * roundNumber }[phase];
    return {
    phase, roundId, revision, roundCount: 2,
    ...(lastRevealedRoundId ? { lastRevealedRoundId } : {}),
};
};
const reveal = (roundId, answer, results) => ({ roundId, answer, results });

function sessionWithListener(getReveal = jest.fn()) {
    const stateListeners = [];
    const timingListeners = [];
    return {
        stateListeners, timingListeners,
        subscribeState: jest.fn((eventId, onChange, onError) => {
            const listener = { eventId, onChange, onError, dispose: jest.fn() };
            stateListeners.push(listener);
            return listener.dispose;
        }),
        subscribeTiming: jest.fn((eventId, roundId, onChange, onError) => {
            const listener = { eventId, roundId, onChange, onError, dispose: jest.fn() };
            timingListeners.push(listener);
            onChange({ timing: null, offsetMs: 0, connected: true });
            return listener.dispose;
        }),
        getReveal,
        getClue: jest.fn(), getOwnGuess: jest.fn(), submitGuess: jest.fn(), getHostSetup: jest.fn(),
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

    it('dispatches presenter clients to the legacy v1 view without subscribing to v2 session state', async () => {
        const lobby = clientWithListener();
        lobby.getFormatVersion = jest.fn(() => Promise.resolve(1));
        const round = clientWithListener();
        round.getReveal = jest.fn(() => Promise.resolve({ roundId: 'r1', answer: { lat: 1, lng: 2 }, results: {} }));
        const session = sessionWithListener();
        const wrapper = mount(EventPresentation, { propsData: {
            eventId: 'party', lobbyClient: lobby, roundClient: round, sessionClient: session,
        } });
        lobby.listeners[0].onChange(projection({ phase: 'reveal' }));
        await new Promise(resolve => setTimeout(resolve, 0)); await wrapper.vm.$nextTick();

        expect(lobby.getFormatVersion).toHaveBeenCalledWith('party');
        expect(session.subscribeState).not.toHaveBeenCalled();
        expect(round.getReveal).toHaveBeenCalledWith('party');
        expect(wrapper.find('.event-round-results').exists()).toBe(true);
        wrapper.destroy();
    });

    it('retries a failed legacy v1 reveal even when the presenter facade includes a v2 session client', async () => {
        const lobby = clientWithListener();
        lobby.getFormatVersion = jest.fn(() => Promise.resolve(1));
        const round = clientWithListener();
        round.getReveal = jest.fn()
            .mockRejectedValueOnce(new Error('temporary read failure'))
            .mockResolvedValue({ roundId: 'r1', answer: { lat: 1, lng: 2 }, results: {
                guest_1: { nickname: 'Alex', answered: true, points: 10, distance: 100, totalPoints: 10 },
            } });
        const session = sessionWithListener();
        const wrapper = mount(EventPresentation, { propsData: {
            eventId: 'party', lobbyClient: lobby, roundClient: round, sessionClient: session,
        } });
        lobby.listeners[0].onChange(projection({ phase: 'reveal' }));
        await new Promise(resolve => setTimeout(resolve, 0)); await wrapper.vm.$nextTick();

        expect(round.getReveal).toHaveBeenCalledTimes(1);
        expect(wrapper.find('button').text()).toBe('Reconnect');
        await wrapper.find('button').trigger('click');
        await new Promise(resolve => setTimeout(resolve, 0)); await wrapper.vm.$nextTick();

        expect(round.getReveal).toHaveBeenCalledTimes(2);
        expect(wrapper.text()).toContain('Alex');
        expect(session.subscribeState).not.toHaveBeenCalled();
        wrapper.destroy();
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

    it('projects v2 round status and observes only the active round timing without guest or private operations', async () => {
        const lobby = clientWithListener();
        const session = sessionWithListener();
        const wrapper = mount(EventPresentation, { propsData: { eventId: 'party', lobbyClient: lobby, sessionClient: session } });
        lobby.listeners[0].onChange(multiProjection('ready', 'r02'));
        session.stateListeners[0].onChange(state('ready', 'r02', 'r01'));
        await wrapper.vm.$nextTick();

        expect(wrapper.text()).toContain('Round 2 of 2');
        expect(wrapper.text()).toContain('host is preparing this round');
        expect(session.subscribeTiming).not.toHaveBeenCalled();
        expect(session.getReveal).toHaveBeenCalledWith('party', 'r01');
        expect(session.getClue).not.toHaveBeenCalled();
        expect(session.getOwnGuess).not.toHaveBeenCalled();
        expect(session.submitGuess).not.toHaveBeenCalled();
        expect(session.getHostSetup).not.toHaveBeenCalled();
        wrapper.destroy();
        expect(session.stateListeners[0].dispose).toHaveBeenCalledTimes(1);
    });

    it('shows a read-only answer map and cumulative totals only after reveal, keeps them through ready, and labels completion final', async () => {
        const lobby = clientWithListener();
        const first = reveal('r01', { lat: 10, lng: 20 }, {
            guest_1: { nickname: 'Alex', answered: true, points: 120, totalPoints: 120, distance: 1000 },
            guest_2: { nickname: 'Sam', answered: false, points: 0, totalPoints: 0 },
        });
        const second = reveal('r02', { lat: 30, lng: 40 }, {
            guest_1: { nickname: 'Alex', answered: true, points: 300, totalPoints: 420, distance: 500 },
            guest_2: { nickname: 'Sam', answered: true, points: 420, totalPoints: 420, distance: 100 },
        });
        const session = sessionWithListener(jest.fn((eventId, roundId) => Promise.resolve(roundId === 'r01' ? first : second)));
        const mapsLoader = jest.fn(() => Promise.reject(new Error('maps unavailable')));
        const wrapper = mount(EventPresentation, { propsData: { eventId: 'party', lobbyClient: lobby, sessionClient: session, mapsLoader } });
        lobby.listeners[0].onChange(multiProjection('guessing', 'r01'));
        session.stateListeners[0].onChange(state('guessing', 'r01'));
        await wrapper.vm.$nextTick();
        expect(session.subscribeTiming).toHaveBeenCalledWith('party', 'r01', expect.any(Function), expect.any(Function));
        expect(session.getReveal).not.toHaveBeenCalled();
        expect(wrapper.find('.event-guess-map').exists()).toBe(false);

        session.stateListeners[0].onChange(state('reveal', 'r01', 'r01'));
        await Promise.resolve(); await wrapper.vm.$nextTick();
        expect(session.getReveal).toHaveBeenCalledWith('party', 'r01');
        expect(wrapper.findComponent({ name: 'EventGuessMap' }).props()).toMatchObject({ answer: first.answer, selected: null, disabled: true });
        expect(wrapper.text()).toContain('Overall standings');
        expect(wrapper.text()).toContain('Alex');
        expect(wrapper.text()).toContain('120 points');
        expect(wrapper.text()).toContain('Sam');
        expect(session.getClue).not.toHaveBeenCalled();

        session.stateListeners[0].onChange(state('ready', 'r02', 'r01'));
        await wrapper.vm.$nextTick();
        expect(wrapper.text()).toContain('Overall standings');
        expect(wrapper.text()).toContain('120 points');
        expect(session.getReveal).toHaveBeenCalledTimes(1);

        session.stateListeners[0].onChange(state('complete', 'r02', 'r02'));
        await Promise.resolve(); await wrapper.vm.$nextTick();
        expect(session.getReveal).toHaveBeenCalledWith('party', 'r02');
        expect(wrapper.text()).toContain('Final standings');
        expect(wrapper.text()).toContain('420 points');
        expect(wrapper.findComponent({ name: 'EventGuessMap' }).props().answer).toEqual(second.answer);
        wrapper.destroy();
    });

    it('ignores stale reveal replies when the observed round advances', async () => {
        const lobby = clientWithListener();
        let resolveFirst;
        let resolveSecond;
        const session = sessionWithListener(jest.fn((eventId, roundId) => new Promise(resolve => {
            if (roundId === 'r01') resolveFirst = resolve;
            else resolveSecond = resolve;
        })));
        const wrapper = mount(EventPresentation, { propsData: { eventId: 'party', lobbyClient: lobby, sessionClient: session } });
        lobby.listeners[0].onChange(multiProjection('reveal', 'r01'));
        session.stateListeners[0].onChange(state('reveal', 'r01', 'r01'));
        session.stateListeners[0].onChange(state('reveal', 'r02', 'r02'));
        resolveFirst(reveal('r01', { lat: 1, lng: 2 }, { guest_1: { nickname: 'Old', points: 1, totalPoints: 1 } }));
        await Promise.resolve();
        resolveSecond(reveal('r02', { lat: 3, lng: 4 }, { guest_1: { nickname: 'New', points: 2, totalPoints: 2 } }));
        await Promise.resolve(); await wrapper.vm.$nextTick();
        expect(wrapper.text()).toContain('New');
        expect(wrapper.text()).not.toContain('Old');
        expect(wrapper.find('.event-presentation-page__map-fallback').text()).toContain('3.00000, 4.00000');
        wrapper.destroy();
    });
});
