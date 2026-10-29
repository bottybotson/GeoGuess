<template>
    <section class="event-timing-controls" aria-label="Round timing controls">
        <button
            v-if="timing === null"
            type="button"
            :disabled="!canRequest"
            @click="requestDuration(120000)"
        >Start 2 minute timer</button>
        <button
            v-else
            type="button"
            :disabled="!canRequest"
            @click="requestDuration(60000)"
        >Add 1 minute</button>
        <button
            v-if="retryAvailable"
            type="button"
            :disabled="!connected || busy || retryLatched"
            @click="retry"
        >Retry timing update</button>
        <p v-if="statusMessage" class="event-timing-controls__status" role="status">{{ statusMessage }}</p>
    </section>
</template>

<script>
function validTiming(timing) {
    return !!timing && typeof timing === 'object' && timing.roundId === 'r1' &&
        Number.isSafeInteger(timing.deadlineMs) && timing.deadlineMs > 0;
}

export default {
    name: 'EventTimingControls',
    props: {
        timing: { type: Object, default: null },
        nowMs: { type: Number, default: null },
        connected: { type: Boolean, default: false },
        busy: { type: Boolean, default: false },
        error: { type: String, default: '' },
        retryAvailable: { type: Boolean, default: false },
    },
    data() {
        return { requestLatched: false, retryLatched: false, sawBusy: false };
    },
    computed: {
        clockKnown() { return Number.isSafeInteger(this.nowMs) && this.nowMs > 0; },
        expired() {
            return validTiming(this.timing) && this.clockKnown && this.timing.deadlineMs <= this.nowMs;
        },
        canRequest() {
            return this.connected && this.clockKnown && !this.busy && !this.requestLatched &&
                !this.retryAvailable && (this.timing === null || validTiming(this.timing));
        },
        statusMessage() {
            if (this.error) return 'Timing update was not confirmed. You can retry the same update.';
            if (!this.connected || !this.clockKnown) return 'Waiting for connection';
            if (this.busy || this.requestLatched) return 'Saving timing update…';
            if (this.expired) return 'Time is up. Add time when you are ready.';
            return '';
        },
    },
    watch: {
        busy(value) {
            if (value) this.sawBusy = true;
            else if (this.sawBusy) {
                this.sawBusy = false;
                this.requestLatched = false;
                this.retryLatched = false;
            }
        },
        error(value, previous) {
            if (value && value !== previous) {
                this.requestLatched = false;
                this.retryLatched = false;
            }
        },
        'timing.deadlineMs'(value, previous) {
            if (value !== previous) this.requestLatched = false;
        },
    },
    methods: {
        requestDuration(durationMs) {
            if (!this.canRequest) return;
            this.requestLatched = true;
            this.$emit('request-duration', { durationMs });
        },
        retry() {
            if (!this.retryAvailable || !this.connected || this.busy || this.retryLatched) return;
            this.retryLatched = true;
            this.$emit('retry');
        },
    },
};
</script>

<style scoped>
.event-timing-controls { display: grid; gap: 0.75rem; justify-items: start; color: #17212b; font: 1.15rem/1.4 Arial, sans-serif; }
.event-timing-controls button { min-height: 3.5rem; min-width: 13rem; padding: 0.5rem 1rem; border: 0; border-radius: 0.4rem; background: #145b9e; color: #fff; font: 700 1.2rem Arial, sans-serif; }
.event-timing-controls button:disabled { background: #66727d; }
.event-timing-controls__status { margin: 0; }
</style>
