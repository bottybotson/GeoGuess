import { mount } from '@vue/test-utils';
import EventJoinQr, { sanitizeJoinUrl } from '@/components/event/EventJoinQr.vue';

describe('EventJoinQr', () => {
    it('accepts only the current public HTTP(S) join route and removes query and fragment data', () => {
        expect(sanitizeJoinUrl('https://example.test/event/party/join?admin=secret#private', 'party'))
            .toBe('https://example.test/event/party/join');
        expect(sanitizeJoinUrl('https://example.test/event/other/join', 'party')).toBe('');
        expect(sanitizeJoinUrl('https://example.test/event/party/host', 'party')).toBe('');
        expect(sanitizeJoinUrl('javascript:alert(1)', 'party')).toBe('');
        expect(sanitizeJoinUrl('https://user:pass@example.test/event/party/join', 'party')).toBe('');
        expect(sanitizeJoinUrl('https://example.test/event/party/join', '../party')).toBe('');
    });

    it('renders a local QR image and updates it when the public join URL changes', async () => {
        const wrapper = mount(EventJoinQr, { propsData: {
            eventId: 'party', joinUrl: 'https://example.test/event/party/join',
        } });

        await wrapper.vm.$nextTick();
        expect(wrapper.find('img').attributes('src')).toMatch(/^data:image\/gif;base64,/);
        expect(wrapper.find('img').attributes('alt')).toContain('public guest join page');
        expect(wrapper.find('figcaption').text()).toBe('Scan to join the game');

        await wrapper.setProps({ joinUrl: 'https://example.test/event/party/join?token=secret' });
        expect(wrapper.vm.safeJoinUrl).toBe('https://example.test/event/party/join');
        expect(wrapper.find('img').exists()).toBe(true);
        expect(wrapper.html()).not.toContain('secret');
        wrapper.destroy();
    });

    it('renders no image for an invalid route and ignores invalid URL data', async () => {
        const wrapper = mount(EventJoinQr, { propsData: {
            eventId: 'party', joinUrl: 'https://example.test/event/party/host?token=secret',
        } });
        await wrapper.vm.$nextTick();

        expect(wrapper.find('img').exists()).toBe(false);
        expect(wrapper.html()).not.toContain('secret');
        wrapper.destroy();
    });
});
