<template>
    <section class="event-round-timer" aria-label="Round time">
        <p class="event-round-timer__value" aria-live="off">{{ message }}</p>
    </section>
</template>

<script>
function validTiming(timing) {
    return !!timing && typeof timing === 'object' && timing.roundId === 'r1' &&
        Number.isSafeInteger(timing.deadlineMs) && timing.deadlineMs > 0;
}

export default {
    name: 'EventRoundTimer',
    props: {
        timing: { type: Object, default: null },
        nowMs: { type: Number, default: null },
        connected: { type: Boolean, default: false },
    },
    computed: {
        message() {
            if (!this.connected || !Number.isSafeInteger(this.nowMs) || this.nowMs <= 0) {
                return 'Waiting for connection';
            }
            if (this.timing === null) return 'No time limit';
            if (!validTiming(this.timing)) return 'Waiting for connection';
            const remaining = Math.max(0, this.timing.deadlineMs - this.nowMs);
            if (remaining === 0) return 'Time is up—waiting for host';
            const totalSeconds = Math.ceil(remaining / 1000);
            const minutes = Math.floor(totalSeconds / 60);
            const seconds = totalSeconds % 60;
            return `Time remaining: ${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        },
    },
};
</script>

<style scoped>
.event-round-timer { color: #17212b; font: 700 1.5rem/1.4 Arial, sans-serif; }
.event-round-timer__value { margin: 0; }
</style>
