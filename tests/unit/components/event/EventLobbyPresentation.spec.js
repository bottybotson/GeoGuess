import { mount } from '@vue/test-utils';
import EventLobbyPresentation from '@/components/event/EventLobbyPresentation.vue';

describe('EventLobbyPresentation', () => {
    it('renders the default title, empty lobby copy, and guest count', () => {
        const wrapper = mount(EventLobbyPresentation, {
            propsData: { phase: 'lobby' },
        });

        expect(wrapper.find('h1').text()).toBe('Birthday GeoGuess');
        expect(wrapper.find('.event-presentation__count').text()).toBe('0 of 50 guests');
        expect(wrapper.find('.event-presentation__empty').text()).toBe(
            'Guests are welcome and waiting for the host.'
        );
        expect(wrapper.find('.event-presentation__status').text()).toContain(
            'The lobby is open. The host will start the game.'
        );
    });

    it('renders populated guest names and the public join URL as plain text', () => {
        const wrapper = mount(EventLobbyPresentation, {
            propsData: {
                title: 'Maya\'s Birthday',
                phase: 'lobby',
                joinUrl: 'https://example.test/event/demo/join',
                participants: [
                    { id: 'guest_1', nickname: 'Alex' },
                    { id: 'guest_2', nickname: 'Jordan' },
                ],
            },
        });

        expect(wrapper.find('h1').text()).toBe('Maya\'s Birthday');
        expect(wrapper.find('.event-presentation__count').text()).toBe('2 of 50 guests');
        expect(wrapper.findAll('.event-presentation__guests li').wrappers.map((item) => item.text())).toEqual([
            'Alex',
            'Jordan',
        ]);
        expect(wrapper.find('.event-presentation__join-url').text()).toBe(
            'https://example.test/event/demo/join'
        );
        expect(wrapper.find('.event-presentation__join').element.tagName).toBe('DIV');
        expect(wrapper.find('.event-presentation__join a').exists()).toBe(false);
        expect(wrapper.find('.event-presentation__join button').exists()).toBe(false);
    });

    it.each([
        ['guessing', 'Guessing is in progress. Results will be shown after the host reveals them.'],
        ['reveal', 'The host is revealing the round. Round results are not available yet.'],
        ['complete', 'The event is complete. Final results are not available yet.'],
    ])('shows the %s status and hides the join prompt', (phase, expectedMessage) => {
        const wrapper = mount(EventLobbyPresentation, {
            propsData: {
                phase,
                joinUrl: 'https://example.test/join',
            },
        });

        expect(wrapper.find('.event-presentation__status').text()).toContain(expectedMessage);
        expect(wrapper.find('.event-presentation__join').exists()).toBe(false);
    });

    it.each([undefined, 'starting-soon', 'constructor', '__proto__'])(
        'uses an unavailable status for phase %s',
        (phase) => {
            const propsData = { joinUrl: 'https://example.test/join' };
            if (phase !== undefined) propsData.phase = phase;

            const wrapper = mount(EventLobbyPresentation, { propsData });

            expect(wrapper.find('.event-presentation__status').text()).toBe(
                'Event status is unavailable.'
            );
            expect(wrapper.find('.event-presentation__join').exists()).toBe(false);
            expect(wrapper.find('.event-presentation__empty').text()).toBe(
                'Guest list is unavailable.'
            );
        }
    );

    it.each(['guessing', 'reveal', 'complete'])(
        'does not invite guests to join during the %s phase',
        (phase) => {
            const wrapper = mount(EventLobbyPresentation, { propsData: { phase } });

            expect(wrapper.find('.event-presentation__empty').text()).toBe(
                'No guests are currently listed.'
            );
        }
    );

    it('reacts to changed props and keeps duplicate nicknames as separate guests', async () => {
        const wrapper = mount(EventLobbyPresentation, {
            propsData: {
                phase: 'lobby',
                participants: [
                    { id: 'guest_1', nickname: 'Sam' },
                    { id: 'guest_2', nickname: 'Sam' },
                ],
            },
        });
        const originalGuestOne = wrapper.findAll('.event-presentation__guests li').at(0).element;
        const originalGuestTwo = wrapper.findAll('.event-presentation__guests li').at(1).element;

        await wrapper.setProps({
            title: 'Updated Birthday',
            phase: 'guessing',
            joinUrl: 'https://example.test/new-join',
            participants: [
                { id: 'guest_2', nickname: 'Sam' },
                { id: 'guest_1', nickname: 'Sam' },
                { id: 'guest_3', nickname: 'Taylor' },
            ],
        });

        const guests = wrapper.findAll('.event-presentation__guests li');
        expect(wrapper.find('h1').text()).toBe('Updated Birthday');
        expect(wrapper.find('.event-presentation__count').text()).toBe('3 of 50 guests');
        expect(wrapper.find('.event-presentation__status').text()).toContain('Guessing is in progress.');
        expect(wrapper.find('.event-presentation__join').exists()).toBe(false);
        expect(guests.wrappers.map((item) => item.text())).toEqual(['Sam', 'Sam', 'Taylor']);
        expect(guests.at(0).element).toBe(originalGuestTwo);
        expect(guests.at(1).element).toBe(originalGuestOne);
    });

    it('renders supplied strings as text and does not inherit unknown attributes', () => {
        const wrapper = mount(EventLobbyPresentation, {
            attrs: { 'private-token': 'must-not-leak' },
            propsData: {
                title: '<img src=x onerror=alert(1)>',
                phase: 'lobby',
                joinUrl: '<script>alert(1)</script>',
                participants: [{ id: 'guest_1', nickname: '<b>Guest</b>' }],
            },
        });

        expect(wrapper.find('h1').text()).toBe('<img src=x onerror=alert(1)>');
        expect(wrapper.find('.event-presentation__join-url').text()).toBe('<script>alert(1)</script>');
        expect(wrapper.find('.event-presentation__guests li').text()).toBe('<b>Guest</b>');
        expect(wrapper.find('img').exists()).toBe(false);
        expect(wrapper.find('script').exists()).toBe(false);
        expect(wrapper.find('b').exists()).toBe(false);
        expect(wrapper.element.hasAttribute('private-token')).toBe(false);
        expect(wrapper.element.getAttribute('private-token')).toBeNull();
    });

    it('emits no commands on mount, prop updates, or unmount', async () => {
        const wrapper = mount(EventLobbyPresentation, { propsData: { phase: 'lobby' } });

        await wrapper.setProps({ phase: 'guessing', title: 'Updated' });
        wrapper.destroy();

        expect(wrapper.emitted()).toEqual({});
    });
});
