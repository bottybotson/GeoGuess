<template>
    <section class="event-guest-session" :class="{ 'event-guest-session--playing': ['guessing', 'closed', 'reveal'].includes(phase) }" aria-live="polite">
        <template v-if="currentState">
            <div class="event-guest-session__heading">
                <h2>Round {{ roundNumber }} of {{ currentState.roundCount }}</h2>
                <EventRoundTimer
                    v-if="phase === 'guessing'" :round-id="currentState.roundId"
                    :timing="timing" :now-ms="nowMs" :connected="timingConnected"
                />
            </div>
            <p v-if="phase === 'lobby'" role="status">You’re ready. The host will start the first round.</p>
            <p v-else-if="phase === 'ready'" role="status">The next round is ready. Wait for the host to start.</p>
            <p v-else-if="phase === 'complete'" role="status">The game is complete. Here are the final standings.</p>
            <p v-if="loading" role="status">Loading the round…</p>
            <p v-if="error" role="alert">We couldn’t confirm the round. Check your connection and retry.</p>
            <button v-if="error" type="button" @click="refresh">Retry connection</button>
            <EventRoundPlay
                v-if="activeRound" :key="playKey" :round="activeRound" :phase="effectivePhase"
                :maps-loader="mapsLoader" :submission-state="submissionState" :submitted-guess="submittedGuess"
                :answer="authorizedReveal ? authorizedReveal.answer : null" @submit="submit"
            />
            <EventRoundResults v-if="authorizedReveal" :reveal="authorizedReveal" :cumulative="true" :final="phase === 'complete'" />
        </template>
        <p v-else role="status">Event status is unavailable.</p>
    </section>
</template>

<script>
import EventRoundPlay from '@/components/event/EventRoundPlay.vue';
import EventRoundResults from '@/components/event/EventRoundResults.vue';
import EventRoundTimer from '@/components/event/EventRoundTimer.vue';
import timingView from '@/event/timing-view';
import { validSessionState } from '@/event/version';

const coords = value => !!value && Number.isFinite(value.lat) && value.lat >= -90 && value.lat <= 90 &&
    Number.isFinite(value.lng) && value.lng >= -180 && value.lng <= 180;
const clueValid = (value, id) => !!value && value.id === id && typeof value.panoramaId === 'string' &&
    value.panoramaId.length > 0 && value.panoramaId.length <= 512 && Number.isFinite(value.heading) &&
    value.heading >= 0 && value.heading < 360 && Number.isFinite(value.pitch) && value.pitch >= -90 && value.pitch <= 90;

export default {
    name: 'EventGuestSession',
    inheritAttrs: false,
    mixins: [timingView],
    components: { EventRoundPlay, EventRoundResults, EventRoundTimer },
    props: {
        eventId: { type: String, required: true },
        state: { type: Object, required: true },
        sessionClient: { type: Object, required: true },
        mapsLoader: { type: Function, default: null },
    },
    data() {
        return { round: null, reveal: null, submittedGuess: null, submissionState: 'submitting',
            loading: false, error: false, epoch: 0, scheduled: false, gone: false,
            scopeEventId: null, scopeClient: null, scopeRoundId: null, playKey: 0 };
    },
    computed: {
        currentState() {
            if (!this.state) return null;
            const { roundCount, ...state } = this.state;
            return validSessionState(state, roundCount) ? this.state : null;
        },
        phase() { return this.currentState ? this.currentState.phase : 'unavailable'; },
        roundNumber() { return this.currentState ? Number(this.currentState.roundId.slice(1)) : null; },
        activeRound() {
            return this.currentState && this.scopeEventId === this.eventId && this.scopeClient === this.sessionClient &&
                this.scopeRoundId === this.currentState.roundId && !['lobby', 'ready'].includes(this.phase) ? this.round : null;
        },
        authorizedReveal() {
            return ['reveal', 'complete'].includes(this.phase) && this.activeRound && this.reveal &&
                this.reveal.roundId === this.currentState.roundId ? this.reveal : null;
        },
        timingExpired() {
            return !!this.timing && Number.isSafeInteger(this.nowMs) && this.timing.deadlineMs <= this.nowMs;
        },
        effectivePhase() {
            if (this.phase === 'guessing' && (!this.timingConnected || !this.timingKnown ||
                !Number.isSafeInteger(this.nowMs) || this.timingExpired)) return 'closed';
            return this.phase === 'complete' ? 'reveal' : this.phase;
        },
    },
    watch: {
        eventId() { this.schedule(); },
        state: { deep: true, handler() { this.schedule(); } },
        sessionClient() { this.schedule(); },
    },
    mounted() { this.refresh(); },
    beforeDestroy() { this.gone = true; this.epoch += 1; },
    methods: {
        observeCurrentTiming() {
            this.observeTiming(this.sessionClient, this.eventId, this.phase === 'guessing',
                this.currentState ? this.currentState.roundId : null);
        },
        schedule() {
            this.epoch += 1;
            this.observeCurrentTiming();
            if (this.scheduled) return;
            this.scheduled = true;
            this.$nextTick(() => { this.scheduled = false; if (!this.gone) this.refresh(); });
        },
        async refresh() {
            const epoch = ++this.epoch;
            const client = this.sessionClient;
            const eventId = this.eventId;
            const state = this.currentState;
            this.error = false;
            this.loading = false;
            this.observeCurrentTiming();
            if (!state) return;
            const { roundId, phase, revision } = state;
            const current = () => !this.gone && epoch === this.epoch && client === this.sessionClient &&
                eventId === this.eventId && this.currentState && roundId === this.currentState.roundId &&
                revision === this.currentState.revision && phase === this.phase;
            if (this.scopeEventId !== eventId || this.scopeClient !== client || this.scopeRoundId !== roundId) {
                this.round = null;
                this.reveal = null;
                this.submittedGuess = null;
                this.submissionState = 'submitting';
                this.scopeEventId = eventId;
                this.scopeClient = client;
                this.scopeRoundId = roundId;
                this.playKey += 1;
            }
            if (['lobby', 'ready'].includes(phase)) return;
            this.loading = true;
            this.submissionState = this.submittedGuess ? 'accepted' : 'submitting';
            const showReveal = ['reveal', 'complete'].includes(phase);
            // Ready/lobby never prefetch a clue. Reveal refreshes need only the
            // published answer and the guest's own immutable saved guess.
            try {
                const publicRead = showReveal ? (this.reveal ? Promise.resolve(this.reveal) : client.getReveal(eventId, roundId)) :
                    (this.round ? Promise.resolve(this.round) : client.getClue(eventId, roundId));
                const [publicResult, ownResult] = await Promise.allSettled([publicRead, client.getOwnGuess(eventId, roundId)]);
                if (!current()) return;
                if (publicResult.status === 'fulfilled') {
                    const value = publicResult.value;
                    if (showReveal) {
                        if (!value || value.roundId !== roundId || !coords(value.answer) || !value.results ||
                            typeof value.results !== 'object' || Array.isArray(value.results)) throw new Error('Reveal unavailable');
                        this.round = this.round || { id: roundId };
                        this.reveal = value;
                    } else {
                        if (!clueValid(value, roundId)) throw new Error('Clue unavailable');
                        this.round = value;
                    }
                } else this.error = true;
                if (ownResult.status === 'fulfilled' && (ownResult.value === null || coords(ownResult.value))) {
                    // An acknowledged pin is immutable, including across retries.
                    if (!this.submittedGuess && ownResult.value) this.submittedGuess = { lat: ownResult.value.lat, lng: ownResult.value.lng };
                    this.submissionState = this.submittedGuess ? 'accepted' : 'idle';
                } else {
                    this.error = true;
                    this.submissionState = this.submittedGuess ? 'accepted' : 'error';
                }
            } catch {
                if (current()) { this.error = true; this.submissionState = this.submittedGuess ? 'accepted' : 'error'; }
            } finally {
                if (current()) this.loading = false;
            }
        },
        async submit(payload) {
            if (this.loading || this.phase !== 'guessing' || !['idle', 'error'].includes(this.submissionState) ||
                this.effectivePhase !== 'guessing' || !this.activeRound || !payload ||
                payload.roundId !== this.currentState.roundId || !coords(payload.guess)) return;
            const epoch = this.epoch;
            const client = this.sessionClient;
            const eventId = this.eventId;
            const { roundId, revision } = this.currentState;
            const current = () => !this.gone && epoch === this.epoch && client === this.sessionClient &&
                eventId === this.eventId && this.currentState && roundId === this.currentState.roundId &&
                revision === this.currentState.revision && this.phase === 'guessing';
            this.submissionState = 'submitting';
            this.error = false;
            try {
                const result = await client.submitGuess(eventId, roundId, { lat: payload.guess.lat, lng: payload.guess.lng });
                if (!current()) return;
                if (!result || !['submitted', 'already-submitted'].includes(result.status) || !coords(result.guess)) throw new Error('Unconfirmed guess');
                this.submittedGuess = { lat: result.guess.lat, lng: result.guess.lng };
                this.submissionState = 'accepted';
            } catch {
                if (current()) { this.submissionState = 'error'; this.error = true; }
            }
        },
        onTimingViewError() { this.error = true; },
    },
};
</script>

<style scoped>
.event-guest-session { max-width: 72rem; margin: 1rem auto; }
.event-guest-session > button { min-height: 48px; padding: 0.75rem 1rem; font: inherit; }
@media (max-width: 800px), (max-width: 1000px) and (max-height: 500px) {
    .event-guest-session--playing { margin: 0.25rem auto 0; }
    .event-guest-session--playing .event-guest-session__heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.25rem 0.5rem; margin-bottom: 0.25rem; }
    .event-guest-session--playing h2 { margin: 0; font-size: 1rem; line-height: 1.4; }
    .event-guest-session--playing .event-round-timer { font-size: 1rem; }
}
</style>
