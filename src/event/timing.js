export const MAX_WINDOW_MS = 2 * 60 * 60 * 1000;
export const MIN_DURATION_MS = 1000;

export function validDeadline(value) {
    return Number.isSafeInteger(value) && value > 0;
}

export function validTiming(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value) &&
        Object.keys(value).length === 2 && Object.prototype.hasOwnProperty.call(value, 'roundId') &&
        Object.prototype.hasOwnProperty.call(value, 'deadlineMs') && value.roundId === 'r1' && validDeadline(value.deadlineMs);
}

/** Compute once per user action; preserve the returned absolute target on retry. */
export function deadlineAfter(serverNowMs, durationMs, currentDeadlineMs = null) {
    if (!validDeadline(serverNowMs) || !Number.isSafeInteger(durationMs) ||
        durationMs < MIN_DURATION_MS || durationMs > MAX_WINDOW_MS ||
        (currentDeadlineMs !== null && !validDeadline(currentDeadlineMs))) {
        throw Object.assign(new Error('invalid-duration'), { code: 'invalid-duration' });
    }
    const target = Math.max(serverNowMs, currentDeadlineMs || 0) + durationMs;
    if (!validDeadline(target) || target > serverNowMs + MAX_WINDOW_MS) {
        throw Object.assign(new Error('invalid-duration'), { code: 'invalid-duration' });
    }
    return target;
}

/** Zero is expired; null is untimed. Server Rules independently enforce expiry. */
export function remainingMs(timing, serverNowMs) {
    if (timing === null) return null;
    if (!validTiming(timing) || !validDeadline(serverNowMs)) {
        throw Object.assign(new Error('invalid-timing'), { code: 'invalid-timing' });
    }
    return Math.max(0, timing.deadlineMs - serverNowMs);
}
