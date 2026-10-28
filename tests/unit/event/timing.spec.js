import { deadlineAfter, remainingMs, validTiming, MAX_WINDOW_MS } from '../../../src/event/timing';

test('computes one bounded absolute target and preserves time when extending', () => {
    expect(deadlineAfter(100000, 60000)).toBe(160000);
    expect(deadlineAfter(100000, 60000, 180000)).toBe(240000);
    expect(deadlineAfter(200000, 60000, 180000)).toBe(260000);
    for (const args of [[0, 1000], [100000, 999], [100000, Infinity], [100000, 1000.1],
        [100000, MAX_WINDOW_MS + 1], [100000, 60000, -1], [100000, 1000, 100000 + MAX_WINDOW_MS]]) {
        expect(() => deadlineAfter(...args)).toThrow('invalid-duration');
    }
});

test('countdown treats the exact deadline as expired and preserves untimed state', () => {
    const timing = { roundId: 'r1', deadlineMs: 160000 };
    expect(remainingMs(null, 100000)).toBeNull();
    expect(remainingMs(timing, 159999)).toBe(1);
    expect(remainingMs(timing, 160000)).toBe(0);
    expect(remainingMs(timing, 160001)).toBe(0);
    expect(validTiming({ ...timing, extra: true })).toBe(false);
    expect(validTiming({ ...timing, roundId: 'r2' })).toBe(false);
    expect(() => remainingMs({ deadlineMs: 10 }, 100000)).toThrow('invalid-timing');
});
