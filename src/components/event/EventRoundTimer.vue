<template>
    <section class="event-round-timer" aria-label="Round time">
        <p class="event-round-timer__value" aria-live="off">{{ message }}</p>
    </section>
</template>

<script>
import { validTiming } from '@/event/timing';

export default {
    name: 'EventRoundTimer',
    props: {
        timing: { type: Object, default: null },
        roundId: { type: String, default: 'r1' },
        nowMs: { type: Number, default: null },
        connected: { type: Boolean, default: false },
    },
    computed: {
        message() {
            if (!this.connected || !Number.isSafeInteger(this.nowMs) || this.nowMs <= 0) {
                return 'Waiting for connection';
            }
            if (this.timing === null) return 'No time limit';
            if (!validTiming(this.timing, this.roundId)) return 'Waiting for connection';
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
