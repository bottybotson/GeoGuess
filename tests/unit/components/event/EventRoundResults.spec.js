import { mount } from '@vue/test-utils';
import EventRoundResults from '@/components/event/EventRoundResults.vue';

const reveal = {
    roundId: 'r1',
    answer: { lat: 51.5, lng: -0.12 },
    results: {
        z_guest: { nickname: 'Zoe', answered: true, points: 900, distance: 1200 },
        no_answer: { nickname: 'No pin', answered: false, points: 200, distance: 4 },
        b_guest: { nickname: 'Bea', answered: true, points: 900, distance: 2000 },
        a_guest: { nickname: 'Ari', answered: true, points: 0 },
    },
};

describe('EventRoundResults', () => {
    it('ranks cumulative points and preserves previous points for an unanswered final round', () => {
        const wrapper = mount(EventRoundResults, { propsData: {
            cumulative: true, final: true,
            reveal: { ...reveal, results: {
                first: { nickname: 'Earlier leader', answered: false, points: 0, totalPoints: 8000 },
                second: { nickname: 'Round winner', answered: true, points: 5000, totalPoints: 6000, distance: 0 },
            } },
        } });
        expect(wrapper.find('h1').text()).toBe('Final standings');
        const rows = wrapper.findAll('li');
        expect(rows.at(0).text()).toContain('Earlier leader');
        expect(rows.at(0).text()).toContain('8000 total points');
        expect(rows.at(0).text()).toContain('No answer · 0 points');
        expect(rows.at(1).text()).toContain('5000 points this round');
        wrapper.destroy();
    });

    it('does not invent cumulative totals when they are absent or invalid', () => {
        const wrapper = mount(EventRoundResults, { propsData: {
            cumulative: true,
            reveal: { ...reveal, results: {
                invalid: { nickname: 'Unknown total', answered: true, points: 5000, totalPoints: -1 },
                valid: { nickname: 'Known total', answered: false, points: 0, totalPoints: 0 },
            } },
        } });
        expect(wrapper.findAll('li').at(0).text()).toContain('Known total');
        expect(wrapper.findAll('li').at(1).text()).toContain('Total unavailable');
        wrapper.destroy();
    });

    it('shows the revealed location and sorts points descending with UID tie breaks', () => {
        const wrapper = mount(EventRoundResults, { propsData: { reveal } });
        expect(wrapper.text()).toContain('51.5');
        expect(wrapper.text()).toContain('-0.12');
        expect(wrapper.find('details summary').text()).toBe('Location coordinates');
        expect(wrapper.find('details').attributes('open')).toBeUndefined();
        expect(wrapper.findAll('.event-round-results__nickname').wrappers.map(item => item.text())).toEqual([
            'Bea', 'Zoe', 'Ari', 'No pin',
        ]);
        expect(wrapper.findAll('ol li').at(0).text()).toContain('900 points');
        expect(wrapper.findAll('ol li').at(1).text()).toContain('1.2 km away');
        wrapper.destroy();
    });

    it('marks no-answer entries clearly with zero points and supports the current guest', () => {
        const wrapper = mount(EventRoundResults, { propsData: { reveal, currentUid: 'no_answer' } });
        const noAnswer = wrapper.findAll('ol li').wrappers.find(item => item.text().includes('No pin'));
        expect(noAnswer.text()).toContain('No answer · 0 points');
        expect(noAnswer.classes()).toContain('is-current');
        wrapper.destroy();
    });

    it('renders supplied text safely and shows an unavailable state for malformed reveal data', () => {
        const safe = mount(EventRoundResults, {
            propsData: {
                reveal: {
                    roundId: 'r2', answer: { lat: 0, lng: 0 },
                    results: { guest: { nickname: '<img src=x onerror=alert(1)>', answered: true, points: 1 } },
                },
            },
        });
        expect(safe.find('li').text()).toContain('<img src=x onerror=alert(1)>');
        expect(safe.find('img').exists()).toBe(false);
        safe.destroy();

        const malformed = mount(EventRoundResults, {
            propsData: { reveal: { roundId: 'r3', answer: { lat: 999, lng: 0 }, results: {} } },
        });
        expect(malformed.text()).toContain('Round results are unavailable.');
        expect(malformed.find('ol').exists()).toBe(false);
        malformed.destroy();
    });

    it('does not render arbitrary fields such as host setup or guesses', () => {
        const wrapper = mount(EventRoundResults, {
            propsData: {
                reveal: { ...reveal, secretAnswer: 'secret', adminToken: 'token' },
            },
        });
        expect(wrapper.text()).not.toContain('secret');
        expect(wrapper.text()).not.toContain('token');
        expect(wrapper.emitted()).toEqual({});
        wrapper.destroy();
    });
});
