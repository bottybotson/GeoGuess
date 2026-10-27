import { mount } from '@vue/test-utils';
import EventGuestLobby from '@/pages/event/EventGuestLobby.vue';

const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
};
const failure = code => Object.assign(new Error('private backend detail'), { code });

describe('EventGuestLobby', () => {
    let client;
    let subscriptions;
    let joins;

    const makeClient = () => {
        subscriptions = [];
        joins = [];
        return {
            subscribe: jest.fn((eventId, onChange, onError) => {
                const subscription = { eventId, onChange, onError, dispose: jest.fn() };
                subscriptions.push(subscription);
                return subscription.dispose;
            }),
            join: jest.fn((eventId, nickname) => {
                const request = { eventId, nickname, deferred: deferred() };
                joins.push(request);
                return request.deferred.promise;
            }),
        };
    };
    const mountPage = (eventId = 'party', lobbyClient = client) => mount(EventGuestLobby, {
        propsData: { eventId, lobbyClient },
    });
    const finishProbe = async (wrapper, result) => {
        joins[joins.length - 1].deferred.resolve(result);
        await wrapper.vm.$nextTick();
        await Promise.resolve();
        await wrapper.vm.$nextTick();
    };

    beforeEach(() => { client = makeClient(); });

    it('subscribes and performs a read-only probe; invalid nickname returns to the normal form', async () => {
        const wrapper = mountPage();
        expect(client.subscribe).toHaveBeenCalledWith('party', expect.any(Function), expect.any(Function));
        expect(client.join).toHaveBeenCalledWith('party', undefined);
        expect(wrapper.find('input').element.disabled).toBe(true);
        joins[0].deferred.reject(failure('invalid-nickname'));
        await Promise.resolve();
        await wrapper.vm.$nextTick();
        expect(wrapper.find('input').element.disabled).toBe(false);
        expect(wrapper.find('[role="status"]').text()).toContain('Enter a nickname');
    });

    it('does not leak attributes supplied to the page component', () => {
        const wrapper = mount(EventGuestLobby, {
            propsData: { eventId: 'party', lobbyClient: client },
            attrs: { 'private-token': 'should-not-leak' },
        });
        expect(wrapper.element.hasAttribute('private-token')).toBe(false);
        expect(wrapper.attributes('private-token')).toBeUndefined();
    });

    it('detaches a subscription that reports an error before subscribe returns and skips the probe', async () => {
        const dispose = jest.fn();
        client.subscribe.mockImplementation((eventId, onChange, onError) => {
            onError(failure('permission-denied'));
            return dispose;
        });
        const wrapper = mountPage();
        await wrapper.vm.$nextTick();
        expect(dispose).toHaveBeenCalledTimes(1);
        expect(client.join).not.toHaveBeenCalled();
        expect(wrapper.text()).toContain('We couldn’t connect to the lobby.');
        wrapper.destroy();
        expect(dispose).toHaveBeenCalledTimes(1);
    });

    it('invalidates a pending probe and detaches on an asynchronous subscription error', async () => {
        const wrapper = mountPage();
        const request = joins[0];
        subscriptions[0].onError(failure('unavailable'));
        request.deferred.resolve({ status: 'rejoined' });
        await Promise.resolve();
        await wrapper.vm.$nextTick();
        expect(subscriptions[0].dispose).toHaveBeenCalledTimes(1);
        expect(wrapper.text()).toContain('We couldn’t connect to the lobby.');
        expect(wrapper.text()).toContain('We couldn’t join just now.');
    });

    it('handles null and malformed projections without throwing or exposing extra fields', async () => {
        const wrapper = mountPage();
        subscriptions[0].onChange(null);
        await wrapper.vm.$nextTick();
        expect(wrapper.text()).toContain('Birthday GeoGuess');
        expect(wrapper.text()).toContain('0 guests in the lobby');
        subscriptions[0].onChange({ phase: 'private-phase', participants: 'private-roster', answer: 'secret' });
        await wrapper.vm.$nextTick();
        expect(wrapper.text()).toContain('Event status is unavailable.');
        expect(wrapper.text()).not.toContain('secret');
    });

    it('restores existing membership as joined and shows only safe projection fields', async () => {
        const wrapper = mountPage();
        subscriptions[0].onChange({
            title: '<img src=x onerror=alert(1)> Party', phase: 'lobby',
            participants: [{ id: 'private-id', nickname: 'Private Name', token: 'secret' }],
            adminToken: 'hidden', answer: 'hidden',
        });
        await finishProbe(wrapper, { status: 'rejoined', participant: { nickname: 'Old Name' } });
        expect(wrapper.text()).toContain('<img src=x onerror=alert(1)> Party');
        expect(wrapper.find('img').exists()).toBe(false);
        expect(wrapper.text()).toContain('1 guests in the lobby');
        expect(wrapper.text()).toContain('You’re in the lobby.');
        expect(wrapper.text()).not.toContain('Private Name');
        expect(wrapper.text()).not.toContain('secret');
    });

    it.each([
        [{ status: 'started' }, 'The game has already started.'],
        [{ status: 'full' }, 'This lobby is full.'],
    ])('maps probe status %s to fixed UI', async (result, copy) => {
        const wrapper = mountPage();
        await finishProbe(wrapper, result);
        expect(wrapper.text()).toContain(copy);
    });

    it('treats invalid nickname error as a new visitor, then submits exactly once', async () => {
        client.join.mockImplementation((eventId, nickname) => {
            if (nickname === undefined) return Promise.reject(failure('invalid-nickname'));
            const request = { eventId, nickname, deferred: deferred() };
            joins.push(request);
            return request.deferred.promise;
        });
        const wrapper = mountPage();
        await Promise.resolve();
        await wrapper.vm.$nextTick();
        expect(wrapper.find('input').element.disabled).toBe(false);
        await wrapper.find('input').setValue('Alex');
        const form = wrapper.find('form');
        form.element.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        form.element.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        expect(client.join).toHaveBeenCalledTimes(2);
        expect(client.join).toHaveBeenLastCalledWith('party', 'Alex');
        joins[0].deferred.resolve({ status: 'joined', participant: { nickname: 'Alex' } });
        await wrapper.vm.$nextTick();
        await Promise.resolve();
        expect(wrapper.text()).toContain('You’re in the lobby.');
    });

    it('maps unexpected statuses and errors to fixed retryable copy', async () => {
        const wrapper = mountPage();
        await finishProbe(wrapper, { status: 'mystery', privateData: 'no' });
        expect(wrapper.text()).toContain('We couldn’t join just now.');
        expect(wrapper.text()).toContain('Retry connection');
        expect(wrapper.text()).not.toContain('private backend detail');
    });

    it('keeps a subscription failure visible when a probe later succeeds', async () => {
        const wrapper = mountPage();
        subscriptions[0].onError(failure('permission-denied'));
        await finishProbe(wrapper, { status: 'rejoined' });
        expect(wrapper.text()).toContain('We couldn’t connect to the lobby.');
        expect(wrapper.text()).toContain('We couldn’t join just now.');
    });

    it('retry reattaches and probes again without requiring a nickname', async () => {
        const wrapper = mountPage();
        await finishProbe(wrapper, { status: 'mystery' });
        await wrapper.find('.event-guest-lobby__retry').trigger('click');
        expect(subscriptions).toHaveLength(2);
        expect(subscriptions[0].dispose).toHaveBeenCalledTimes(1);
        expect(client.join).toHaveBeenLastCalledWith('party', undefined);
        await finishProbe(wrapper, { status: 'rejoined' });
        expect(wrapper.text()).toContain('You’re in the lobby.');
    });

    it('disposes the exact subscription and ignores stale probe and events across A to B to A', async () => {
        const wrapper = mountPage('A');
        const oldJoin = joins[0];
        const oldSubscription = subscriptions[0];
        await wrapper.setProps({ eventId: 'B' });
        const bJoin = joins[1];
        await wrapper.setProps({ eventId: 'A' });
        expect(oldSubscription.dispose).toHaveBeenCalledTimes(1);
        oldJoin.deferred.resolve({ status: 'joined' });
        oldSubscription.onChange({ title: 'Stale', phase: 'lobby', participants: [] });
        bJoin.deferred.resolve({ status: 'full' });
        await wrapper.vm.$nextTick();
        await Promise.resolve();
        expect(wrapper.text()).not.toContain('Stale');
        expect(wrapper.text()).toContain('Joining the lobby.');
        wrapper.destroy();
        expect(subscriptions[2].dispose).toHaveBeenCalledTimes(1);
    });

    it('restarts cleanly when the client changes and ignores its late callbacks', async () => {
        const wrapper = mountPage();
        const old = subscriptions[0];
        const replacement = makeClient();
        await wrapper.setProps({ lobbyClient: replacement });
        expect(old.dispose).toHaveBeenCalledTimes(1);
        joins[0].deferred.resolve({ status: 'joined' });
        old.onError(failure('unavailable'));
        await Promise.resolve();
        expect(wrapper.text()).toContain('Joining the lobby.');
        wrapper.destroy();
        expect(replacement.subscribe.mock.results[0].value).toHaveBeenCalledTimes(1);
    });

    it('coalesces simultaneous event and client changes into one reconnect', async () => {
        const wrapper = mountPage('party');
        const previousSubscription = subscriptions[0];
        const replacement = makeClient();
        await wrapper.setProps({ eventId: 'new-party', lobbyClient: replacement });
        await wrapper.vm.$nextTick();

        expect(previousSubscription.dispose).toHaveBeenCalledTimes(1);
        expect(replacement.subscribe).toHaveBeenCalledTimes(1);
        expect(replacement.subscribe).toHaveBeenCalledWith('new-party', expect.any(Function), expect.any(Function));
        expect(replacement.join).toHaveBeenCalledTimes(1);
        expect(replacement.join).toHaveBeenCalledWith('new-party', undefined);
        wrapper.destroy();
    });

    it('ignores a late join result after unmount', async () => {
        const wrapper = mountPage();
        wrapper.destroy();
        joins[0].deferred.resolve({ status: 'rejoined' });
        await Promise.resolve();
        expect(subscriptions[0].dispose).toHaveBeenCalledTimes(1);
    });
});
