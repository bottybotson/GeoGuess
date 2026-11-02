jest.mock('@/pages/Home', () => ({ render: h => h('div') }));
jest.mock('@/pages/HistoryPage', () => ({ render: h => h('div') }));
jest.mock('@/pages/MedalsPage', () => ({ render: h => h('div') }));
jest.mock('@/event/runtime', () => ({
    getEventLobbyClient: jest.fn(() => ({ kind: 'guest-lobby' })),
    getEventRoundClient: jest.fn(() => ({ kind: 'guest-round' })),
    getEventSessionClient: jest.fn(() => ({ kind: 'guest-session' })),
    getEventHostClient: jest.fn(() => ({ kind: 'host' })),
    getEventPresenterClient: jest.fn(() => ({
        lobby: { kind: 'public-lobby' }, round: { kind: 'public-round' }, session: { kind: 'public-session' },
    })),
}));

import router from '@/router';
import * as runtime from '@/event/runtime';

const route = name => router.options.routes.find(value => value.name === name);
const location = { params: { eventId: 'synthetic-event' } };

describe('event route client boundaries', () => {
    beforeEach(() => jest.clearAllMocks());

    it('injects only public clients into the spectator route', () => {
        const props = route('event-present').props(location);
        expect(props).toMatchObject({ eventId: 'synthetic-event',
            lobbyClient: { kind: 'public-lobby' }, roundClient: { kind: 'public-round' },
            sessionClient: { kind: 'public-session' }, mapsLoader: expect.any(Function) });
        expect(props.joinUrl).toContain('/event/synthetic-event/join');
        expect(runtime.getEventPresenterClient).toHaveBeenCalledTimes(1);
        expect(runtime.getEventLobbyClient).not.toHaveBeenCalled();
        expect(runtime.getEventRoundClient).not.toHaveBeenCalled();
        expect(runtime.getEventSessionClient).not.toHaveBeenCalled();
        expect(runtime.getEventHostClient).not.toHaveBeenCalled();
    });

    it('provides both protocols to guests without requesting host or spectator clients', () => {
        const props = route('event-join').props(location);
        expect(props).toMatchObject({ lobbyClient: { kind: 'guest-lobby' },
            roundClient: { kind: 'guest-round' }, sessionClient: { kind: 'guest-session' } });
        expect(runtime.getEventHostClient).not.toHaveBeenCalled();
        expect(runtime.getEventPresenterClient).not.toHaveBeenCalled();
    });

    it('keeps the host route separate and validates event identifiers', () => {
        expect(route('event-host').props(location).hostClient).toEqual({ kind: 'host' });
        expect(runtime.getEventLobbyClient).not.toHaveBeenCalled();
        for (const name of ['event-host', 'event-join', 'event-present']) {
            const next = jest.fn();
            route(name).beforeEnter({ params: { eventId: '../other' } }, {}, next);
            expect(next).toHaveBeenCalledWith('/');
        }
    });
});
