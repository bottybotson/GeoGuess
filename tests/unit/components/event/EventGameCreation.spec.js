import { mount } from '@vue/test-utils';
import EventGameCreation from '@/components/event/EventGameCreation.vue';
import { readPendingCreation } from '@/event/game-creation';

const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};
const result = { status: 'created', eventId: 'new-party', links: {
    host: '/event/new-party/host', join: '/event/new-party/join', presenter: '/event/new-party/present',
} };
const flush = async wrapper => { for (let i = 0; i < 12; i++) await Promise.resolve(); await wrapper.vm.$nextTick(); };
const mountCreation = (hostClient, createRequest = jest.fn().mockResolvedValue(result), props = {}) => mount(EventGameCreation, {
    propsData: { sourceEventId: 'party', hostUid: 'host-1', hostClient, createRequest, ...props },
});

beforeEach(() => window.sessionStorage.clear());

describe('authorized host New game action', () => {
    it('uses the real default HTTP client without requiring an injected creation handler', async () => {
        const originalFetch = global.fetch;
        global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 201, json: async () => result });
        let wrapper;
        try {
            wrapper = mount(EventGameCreation, { propsData: {
                sourceEventId: 'party', hostUid: 'host-1', hostClient: { getIdToken: jest.fn().mockResolvedValue('host-token') },
            } });
            await wrapper.find('button').trigger('click');
            await flush(wrapper);
            expect(global.fetch).toHaveBeenCalledWith('/api/event-creations', expect.objectContaining({ method: 'POST' }));
            expect(wrapper.text()).toContain('New game created.');
            expect(wrapper.find('a').attributes('href')).toBe('http://localhost/event/new-party/host');
        } finally { if (wrapper) wrapper.destroy(); global.fetch = originalFetch; }
    });

    it('writes one attempt before sending and ignores a double click while pending', async () => {
        const pending = deferred(), request = jest.fn(() => pending.promise);
        const client = { getIdToken: jest.fn().mockResolvedValue('host-token') };
        const wrapper = mountCreation(client, request);
        await wrapper.find('button').trigger('click');
        const attempt = JSON.parse(window.sessionStorage.getItem('geoguess:event-creation:host-1:party'));
        await wrapper.vm.begin();
        expect(request).toHaveBeenCalledTimes(1);
        expect(request).toHaveBeenCalledWith({ sourceEventId: 'party', requestId: attempt.requestId, token: 'host-token' });
        expect(attempt.requestId).toMatch(/^[a-f0-9]{32}$/);
        expect(wrapper.find('button').element.disabled).toBe(true);
        pending.resolve(result);
        await flush(wrapper);
        expect(window.sessionStorage.getItem('geoguess:event-creation:host-1:party')).toBeNull();
        expect(wrapper.text()).toContain('Open new host page');
        expect(wrapper.find('a').attributes('href')).toBe('http://localhost/event/new-party/host');
        expect(wrapper.text()).toContain('Guest join page');
        expect(wrapper.text()).toContain('Presenter page');
        wrapper.destroy();
    });

    it('restores a saved same-key attempt after refresh and offers explicit retry', async () => {
        const client = { getIdToken: jest.fn().mockResolvedValue('host-token') };
        const firstRequest = jest.fn().mockRejectedValue(new Error('offline'));
        const first = mountCreation(client, firstRequest);
        await first.find('button').trigger('click');
        await flush(first);
        const saved = JSON.parse(window.sessionStorage.getItem('geoguess:event-creation:host-1:party'));
        expect(saved).toEqual({ hostUid: 'host-1', sourceEventId: 'party', requestId: expect.stringMatching(/^[a-f0-9]{32}$/) });
        expect(readPendingCreation(window.sessionStorage, 'host-1', 'party')).toEqual(saved);
        expect(first.text()).toContain('Check creation again');
        first.destroy();

        const retry = jest.fn().mockResolvedValue({ ...result, status: 'already-created' });
        expect(readPendingCreation(window.sessionStorage, 'host-1', 'party')).toEqual(saved);
        const refreshed = mountCreation(client, retry);
        expect(refreshed.vm.pending).toEqual(saved);
        await flush(refreshed);
        expect(refreshed.text()).toContain('Check creation again');
        await refreshed.find('button').trigger('click');
        await flush(refreshed);
        expect(retry).toHaveBeenCalledWith({ sourceEventId: 'party', requestId: saved.requestId, token: 'host-token' });
        expect(refreshed.text()).toContain('already has a new game');
        expect(window.sessionStorage.getItem('geoguess:event-creation:host-1:party')).toBeNull();
        refreshed.destroy();
    });

    it('checks identity after token retrieval and never submits across account/source changes', async () => {
        const token = deferred(), request = jest.fn();
        const client = { getIdToken: jest.fn(() => token.promise) };
        const wrapper = mountCreation(client, request);
        await wrapper.find('button').trigger('click');
        await wrapper.setProps({ hostUid: 'host-2' });
        token.resolve('old-account-token');
        await flush(wrapper);
        expect(request).not.toHaveBeenCalled();
        expect(window.sessionStorage.getItem('geoguess:event-creation:host-1:party')).not.toBeNull();
        wrapper.destroy();

        const nextToken = deferred(), requestAfterSourceChange = jest.fn();
        const client2 = { getIdToken: jest.fn(() => nextToken.promise) };
        const wrapper2 = mountCreation(client2, requestAfterSourceChange);
        await wrapper2.find('button').trigger('click');
        await wrapper2.setProps({ sourceEventId: 'other-party' });
        nextToken.resolve('old-source-token');
        await flush(wrapper2);
        expect(requestAfterSourceChange).not.toHaveBeenCalled();
        wrapper2.destroy();
    });

    it('discards late creation responses after sign-out and restores the original host attempt', async () => {
        const pending = deferred(), request = jest.fn(() => pending.promise);
        const client = { getIdToken: jest.fn().mockResolvedValue('host-token') };
        const wrapper = mountCreation(client, request);
        await wrapper.find('button').trigger('click');
        await flush(wrapper);
        const attempt = readPendingCreation(window.sessionStorage, 'host-1', 'party');
        await wrapper.setProps({ hostUid: '' });
        pending.resolve(result);
        await flush(wrapper);
        expect(wrapper.find('a').exists()).toBe(false);
        expect(readPendingCreation(window.sessionStorage, 'host-1', 'party')).toEqual(attempt);
        await wrapper.setProps({ hostUid: 'host-1' });
        expect(wrapper.vm.pending).toEqual(attempt);
        expect(request).toHaveBeenCalledTimes(1);
        wrapper.destroy();
    });

    it('generates a fresh key only when the host explicitly creates another game after success', async () => {
        const request = jest.fn().mockResolvedValue(result);
        const wrapper = mountCreation({ getIdToken: jest.fn().mockResolvedValue('host-token') }, request);
        await wrapper.find('button').trigger('click');
        await flush(wrapper);
        const firstKey = request.mock.calls[0][0].requestId;
        expect(wrapper.find('button').text()).toContain('Create another new game');
        expect(request).toHaveBeenCalledTimes(1);
        await wrapper.find('button').trigger('click');
        await flush(wrapper);
        expect(request).toHaveBeenCalledTimes(2);
        expect(request.mock.calls[1][0].requestId).not.toBe(firstKey);
        wrapper.destroy();
    });

    it('handles disabled session storage safely and never sends an unpersisted attempt', async () => {
        const original = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
        Object.defineProperty(window, 'sessionStorage', { configurable: true, get() { throw new Error('private storage detail'); } });
        try {
            const request = jest.fn(), client = { getIdToken: jest.fn() };
            const wrapper = mountCreation(client, request);
            await wrapper.find('button').trigger('click');
            await flush(wrapper);
            expect(request).not.toHaveBeenCalled();
            expect(client.getIdToken).not.toHaveBeenCalled();
            expect(wrapper.text()).toContain('Enable session storage');
            expect(wrapper.text()).not.toContain('private storage detail');
            wrapper.destroy();
        } finally { Object.defineProperty(window, 'sessionStorage', original); }
    });

    it('keeps the attempt on token failure and displays a safe sign-in message', async () => {
        const client = { getIdToken: jest.fn().mockRejectedValue(new Error('secret token detail')) };
        const wrapper = mountCreation(client);
        await wrapper.find('button').trigger('click');
        await flush(wrapper);
        expect(wrapper.text()).toContain('Check creation again');
        expect(wrapper.text()).toContain('could not confirm creation');
        expect(wrapper.text()).not.toContain('secret token detail');
        expect(window.sessionStorage.getItem('geoguess:event-creation:host-1:party')).not.toBeNull();
        wrapper.destroy();
    });
});
