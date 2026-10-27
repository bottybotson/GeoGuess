import { mount } from '@vue/test-utils';
import EventJoinForm from '@/components/event/EventJoinForm.vue';

describe('EventJoinForm', () => {
    const input = (wrapper) => wrapper.find('input[name="nickname"]');
    const button = (wrapper) => wrapper.find('button[type="submit"]');

    it('renders a labeled nickname field, instructions, live count, and semantic form', () => {
        const wrapper = mount(EventJoinForm);

        expect(wrapper.find('form').exists()).toBe(true);
        expect(wrapper.find('label[for="event-join-nickname"]').text()).toBe('Nickname');
        expect(input(wrapper).attributes('aria-describedby')).toBe(
            'event-join-instructions event-join-count'
        );
        expect(wrapper.find('#event-join-instructions').text()).toContain('1–20 characters');
        expect(wrapper.find('#event-join-count').text()).toBe('0 of 20 characters');
        expect(input(wrapper).attributes('maxlength')).toBeUndefined();
        expect(button(wrapper).text()).toBe('Join');
        expect(wrapper.find('[role="status"]').attributes('aria-live')).toBe('polite');
        expect(wrapper.emitted()).toEqual({});
    });

    it('emits one trimmed nickname payload while preserving internal spaces', async () => {
        const wrapper = mount(EventJoinForm);
        await input(wrapper).setValue('  Alex Guest  ');

        await wrapper.find('form').trigger('submit');

        expect(wrapper.emitted('join')).toEqual([[{ nickname: 'Alex Guest' }]]);
        expect(Object.keys(wrapper.emitted())).toEqual(['join']);
    });

    it.each([
        ['one code point', 'A', '1 of 20 characters', true],
        ['twenty code points including emoji', '😀'.repeat(10) + 'abcdefghij', '20 of 20 characters', true],
        ['twenty-one code points including emoji', '😀'.repeat(11) + 'abcdefghij', '21 of 20 characters', false],
        ['trimmed Unicode whitespace', ' \t\n ', '0 of 20 characters', false],
    ])('validates %s by trimmed Unicode code points', async (description, value, count, valid) => {
        const wrapper = mount(EventJoinForm);
        await input(wrapper).setValue(value);

        expect(wrapper.find('#event-join-count').text()).toBe(count);
        expect(button(wrapper).element.disabled).toBe(!valid);
        await wrapper.find('form').trigger('submit');
        expect(wrapper.emitted('join') || []).toHaveLength(valid ? 1 : 0);
    });

    it('blocks invalid empty and overlength submissions even when the form is submitted directly', async () => {
        const wrapper = mount(EventJoinForm);

        await wrapper.find('form').trigger('submit');
        await input(wrapper).setValue('x'.repeat(21));
        await wrapper.find('form').trigger('submit');

        expect(wrapper.emitted()).toEqual({});
    });

    it('uses the same submit path for keyboard form submission and button activation', async () => {
        const wrapper = mount(EventJoinForm);
        await input(wrapper).setValue('Taylor');

        // Enter submits the semantic form; activating the button submits that same form.
        await wrapper.find('form').trigger('submit');
        await button(wrapper).trigger('click');

        expect(wrapper.emitted('join')).toEqual([[{ nickname: 'Taylor' }]]);
    });

    it('latches immediately across submit paths until the parent reports a retryable state', async () => {
        const wrapper = mount(EventJoinForm);
        await input(wrapper).setValue('Jordan');

        wrapper.find('form').element.dispatchEvent(
            new Event('submit', { bubbles: true, cancelable: true })
        );
        button(wrapper).element.dispatchEvent(
            new MouseEvent('click', { bubbles: true, cancelable: true })
        );
        wrapper.find('form').element.dispatchEvent(
            new Event('submit', { bubbles: true, cancelable: true })
        );

        expect(wrapper.emitted('join')).toHaveLength(1);
        await wrapper.vm.$nextTick();
        expect(input(wrapper).element.disabled).toBe(true);
        expect(button(wrapper).element.disabled).toBe(true);

        await wrapper.setProps({ state: 'joining' });
        await wrapper.setProps({ state: 'error' });
        expect(input(wrapper).element.disabled).toBe(false);
        expect(button(wrapper).element.disabled).toBe(false);
        await button(wrapper).trigger('click');
        expect(wrapper.emitted('join')).toEqual([
            [{ nickname: 'Jordan' }],
            [{ nickname: 'Jordan' }],
        ]);

        await wrapper.setProps({ state: 'joining' });
        await wrapper.setProps({ state: 'idle' });
        await wrapper.find('form').trigger('submit');
        expect(wrapper.emitted('join')).toHaveLength(3);
    });

    it.each([
        ['idle', 'Enter a nickname and join when you’re ready.', false],
        ['joining', 'Joining the lobby. Please wait.', true],
        ['joined', 'You’re in the lobby. Please wait for the host.', true],
        ['full', 'This lobby is full. Please ask the host for help.', true],
        ['started', 'The game has already started. Please ask the host for help.', true],
        ['error', 'We couldn’t join just now. Check your connection and try again.', false],
        ['new-state', 'Joining is unavailable right now.', true],
    ])('shows safe %s state copy and disables noneditable controls', async (state, copy, disabled) => {
        const wrapper = mount(EventJoinForm, { propsData: { state } });
        await input(wrapper).setValue('Morgan');

        expect(wrapper.find('[role="status"]').text()).toBe(copy);
        expect(input(wrapper).element.disabled).toBe(disabled);
        expect(button(wrapper).element.disabled).toBe(disabled);
        await wrapper.find('form').trigger('submit');
        expect(wrapper.emitted('join') || []).toHaveLength(disabled ? 0 : 1);
    });

    it.each(['full', 'started', 'new-state'])('keeps %s nonretryable until idle/error', async (state) => {
        const wrapper = mount(EventJoinForm, { propsData: { state } });
        await wrapper.find('form').trigger('submit');
        expect(wrapper.emitted()).toEqual({});

        await wrapper.setProps({ state: 'idle' });
        await input(wrapper).setValue('Riley');
        await wrapper.find('form').trigger('submit');

        expect(wrapper.emitted('join')).toEqual([[{ nickname: 'Riley' }]]);
    });

    it('renders user text as escaped text and drops unexpected attributes', async () => {
        const wrapper = mount(EventJoinForm, {
            attrs: { 'private-token': 'must-not-leak' },
        });
        const nickname = '<b>Guest</b>';
        await input(wrapper).setValue(nickname);
        await wrapper.find('form').trigger('submit');

        expect(wrapper.find('b').exists()).toBe(false);
        expect(wrapper.element.hasAttribute('private-token')).toBe(false);
        expect(wrapper.emitted('join')).toEqual([[{ nickname }]]);
    });

    it('emits nothing on mount, state changes, or unmount', async () => {
        const wrapper = mount(EventJoinForm);
        await wrapper.setProps({ state: 'joining' });
        await wrapper.setProps({ state: 'error' });
        wrapper.destroy();

        expect(wrapper.emitted()).toEqual({});
    });
});
