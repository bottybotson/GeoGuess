import { validTiming } from './timing';

/** Shared read-only timing subscription and local display clock for event views. */
export default {
    data() {
        return {
            timing: null,
            timingKnown: false,
            timingConnected: false,
            timingOffsetMs: null,
            nowMs: null,
            timingDisposer: null,
            timingInterval: null,
            timingEpoch: 0,
            timingClientIdentity: null,
            timingEventIdentity: null,
        };
    },
    computed: {
        serverNowMs() {
            return this.timingConnected && Number.isSafeInteger(this.nowMs) ? this.nowMs : null;
        },
    },
    beforeDestroy() {
        this.stopTimingView();
    },
    methods: {
        clearTimingSnapshot() {
            this.timing = null;
            this.timingKnown = false;
            this.timingConnected = false;
            this.timingOffsetMs = null;
            this.nowMs = null;
        },
        stopTimingView() {
            this.timingEpoch += 1;
            if (this.timingInterval !== null) clearInterval(this.timingInterval);
            this.timingInterval = null;
            const dispose = this.timingDisposer;
            this.timingDisposer = null;
            if (dispose) {
                try { dispose(); } catch (error) { /* cleanup is best effort */ }
            }
            this.timingClientIdentity = null;
            this.timingEventIdentity = null;
            this.clearTimingSnapshot();
        },
        observeTiming(client, eventId, enabled = true) {
            if (enabled && this.timingClientIdentity === client && this.timingEventIdentity === eventId &&
                (this.timingDisposer || this.timingInterval !== null)) return;
            this.stopTimingView();
            if (!enabled || !client || typeof client.subscribeTiming !== 'function') return;

            const epoch = this.timingEpoch;
            this.timingClientIdentity = client;
            this.timingEventIdentity = eventId;
            let cancelled = false;
            let returnedDisposer = null;
            let disposed = false;
            const disposeOnce = () => {
                if (!disposed && typeof returnedDisposer === 'function') {
                    disposed = true;
                    returnedDisposer();
                }
            };
            const current = () => !cancelled && this.timingEpoch === epoch &&
                this.timingClientIdentity === client && this.timingEventIdentity === eventId;
            const cancel = () => {
                cancelled = true;
                try { disposeOnce(); } catch (error) { /* cleanup is best effort */ }
            };
            const onChange = snapshot => {
                if (!current()) return;
                if (!snapshot || typeof snapshot !== 'object' || typeof snapshot.connected !== 'boolean' ||
                    !(snapshot.timing === null || validTiming(snapshot.timing)) ||
                    !(snapshot.offsetMs === null || Number.isSafeInteger(snapshot.offsetMs))) {
                    this.clearTimingSnapshot();
                    return;
                }
                this.timing = snapshot.timing;
                this.timingConnected = snapshot.connected && Number.isSafeInteger(snapshot.offsetMs) &&
                    Number.isSafeInteger(Date.now() + snapshot.offsetMs);
                this.timingKnown = this.timingConnected;
                this.timingOffsetMs = this.timingConnected ? snapshot.offsetMs : null;
                this.nowMs = this.timingConnected ? Date.now() + this.timingOffsetMs : null;
            };
            const onError = () => {
                if (!current()) return;
                this.clearTimingSnapshot();
                cancelled = true;
                if (this.timingInterval !== null) clearInterval(this.timingInterval);
                this.timingInterval = null;
                this.timingClientIdentity = null;
                this.timingEventIdentity = null;
                this.timingEpoch += 1;
                try { disposeOnce(); } catch (error) { /* cleanup is best effort */ }
                if (this.timingDisposer === cancel) this.timingDisposer = null;
                if (typeof this.onTimingViewError === 'function') this.onTimingViewError();
            };
            this.timingDisposer = cancel;
            this.timingInterval = setInterval(() => {
                if (current() && this.timingConnected) {
                    const nowMs = Date.now() + this.timingOffsetMs;
                    this.nowMs = Number.isSafeInteger(nowMs) ? nowMs : null;
                    if (this.nowMs === null) this.timingConnected = false;
                }
            }, 500);
            try {
                returnedDisposer = client.subscribeTiming(eventId, onChange, onError);
                if (cancelled) disposeOnce();
            } catch (error) {
                if (current()) {
                    this.clearTimingSnapshot();
                    cancelled = true;
                    if (this.timingInterval !== null) clearInterval(this.timingInterval);
                    this.timingInterval = null;
                    this.timingClientIdentity = null;
                    this.timingEventIdentity = null;
                    this.timingEpoch += 1;
                    try { disposeOnce(); } catch (disposeError) { /* cleanup is best effort */ }
                    if (this.timingDisposer === cancel) this.timingDisposer = null;
                    if (typeof this.onTimingViewError === 'function') this.onTimingViewError();
                }
            }
        },
    },
};
