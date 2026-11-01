<template>
    <section class="event-guest-round">
        <p v-if="loading" role="status">Loading the round…</p>
        <p v-if="error" role="alert">We couldn’t confirm the round. Check your connection and retry.</p>
        <button v-if="error" type="button" @click="refresh">Retry connection</button>
        <EventRoundTimer v-if="phase === 'guessing'" :timing="timing" :now-ms="nowMs" :connected="timingConnected" />
        <EventRoundPlay
            v-if="activeRound"
            :round="activeRound" :phase="effectivePhase" :maps-loader="mapsLoader"
            :submission-state="submissionState" :submitted-guess="submittedGuess"
            :answer="authorizedReveal ? authorizedReveal.answer : null"
            @submit="submit"
        />
        <EventRoundResults v-if="authorizedReveal" :reveal="authorizedReveal" />
    </section>
</template>

<script>
import EventRoundPlay from '@/components/event/EventRoundPlay.vue';
import EventRoundResults from '@/components/event/EventRoundResults.vue';
import EventRoundTimer from '@/components/event/EventRoundTimer.vue';
import timingView from '@/event/timing-view';

export default {
    name: 'EventGuestRound',
    inheritAttrs: false,
    mixins: [timingView],
    components: { EventRoundPlay, EventRoundResults, EventRoundTimer },
    props: {
        eventId: { type: String, required: true },
        phase: { type: String, required: true },
        roundClient: { type: Object, required: true },
        mapsLoader: { type: Function, required: true },
    },
    data() {
        return { round: null, reveal: null, submittedGuess: null, submissionState: 'submitting',
            loading: false, error: false, epoch: 0, scheduled: false, gone: false,
            scopeEventId: null, scopeClient: null };
    },
    computed: {
        activeRound() {
            return this.scopeEventId === this.eventId && this.scopeClient === this.roundClient ? this.round : null;
        },
        authorizedReveal() {
            return this.phase === 'reveal' && this.activeRound && this.reveal &&
                this.reveal.roundId === this.activeRound.id ? this.reveal : null;
        },
        timingExpired() {
            return !!this.timing && Number.isSafeInteger(this.nowMs) && this.timing.deadlineMs <= this.nowMs;
        },
        effectivePhase() {
            if (this.phase === 'guessing' && (!this.timingConnected || !this.timingKnown ||
                !Number.isSafeInteger(this.nowMs) || this.timingExpired)) return 'closed';
            return this.phase;
        },
    },
    watch: {
        eventId() { this.observeTiming(this.roundClient, this.eventId, this.phase === 'guessing'); this.schedule(); },
        phase(value) { if (value !== 'reveal') this.reveal = null; this.observeTiming(this.roundClient, this.eventId, value === 'guessing'); this.schedule(); },
        roundClient() { this.observeTiming(this.roundClient, this.eventId, this.phase === 'guessing'); this.schedule(); },
    },
    mounted() { this.refresh(); },
    beforeDestroy() { this.gone = true; this.epoch += 1; },
    methods: {
        schedule() {
            this.epoch += 1;
            if (this.scheduled) return;
            this.scheduled = true;
            this.$nextTick(() => { this.scheduled = false; if (!this.gone) this.refresh(); });
        },
        async refresh() {
            const epoch = ++this.epoch;
            const client = this.roundClient;
            const eventId = this.eventId;
            const phase = this.phase;
            this.observeTiming(client, eventId, phase === 'guessing');
            const current = () => !this.gone && epoch === this.epoch && client === this.roundClient && eventId === this.eventId && phase === this.phase;
            if (this.scopeEventId !== eventId || this.scopeClient !== client) {
                this.round = null;
                this.reveal = null;
                this.submittedGuess = null;
                this.scopeEventId = eventId;
                this.scopeClient = client;
            }
            this.loading = true;
            this.error = false;
            this.submissionState = 'submitting';
            if (phase === 'reveal') {
                try {
                    const [result, ownGuess] = await Promise.allSettled([
                        client.getReveal(eventId), client.getOwnGuess(eventId, 'r1'),
                    ]);
                    if (!current()) return;
                    const reveal = result.status === 'fulfilled' ? result.value : null;
                    if (!reveal || typeof reveal.roundId !== 'string' || !reveal.roundId ||
                        (this.round && reveal.roundId !== this.round.id)) throw new Error('Reveal unavailable');
                    this.round = this.round || { id: reveal.roundId };
                    this.reveal = reveal;
                    if (ownGuess.status === 'fulfilled') {
                        this.submittedGuess = ownGuess.value;
                        this.submissionState = ownGuess.value ? 'accepted' : 'idle';
                    } else {
                        this.error = true;
                        this.submissionState = this.submittedGuess ? 'accepted' : 'error';
                    }
                } catch {
                    if (current()) this.error = true;
                } finally {
                    if (current()) this.loading = false;
                }
                return;
            }
            try {
                const [round, guess] = await Promise.all([client.getRound(eventId), client.getOwnGuess(eventId, 'r1')]);
                if (!current()) return;
                if (!round) throw new Error('Round unavailable');
                this.round = round;
                this.submittedGuess = guess;
                this.submissionState = guess ? 'accepted' : 'idle';
            } catch {
                if (current()) { this.error = true; this.submissionState = 'error'; }
            } finally {
                if (current()) this.loading = false;
            }
        },
        async submit(payload) {
            if (this.loading || this.phase !== 'guessing' || !['idle', 'error'].includes(this.submissionState) ||
                !this.timingConnected || !this.timingKnown || !Number.isSafeInteger(this.nowMs) || this.timingExpired ||
                !this.activeRound || !payload || payload.roundId !== this.activeRound.id) return;
            const epoch = this.epoch;
            const client = this.roundClient;
            const eventId = this.eventId;
            this.submissionState = 'submitting';
            this.error = false;
            try {
                const result = await client.submitGuess(eventId, payload.roundId, payload.guess);
                if (this.gone || epoch !== this.epoch || client !== this.roundClient || eventId !== this.eventId || this.phase !== 'guessing') return;
                if (!result || !['submitted', 'already-submitted'].includes(result.status)) throw new Error('Unconfirmed guess');
                this.submittedGuess = result.guess;
                this.submissionState = 'accepted';
            } catch {
                if (!this.gone && epoch === this.epoch && eventId === this.eventId && client === this.roundClient) {
                    this.submissionState = 'error';
                    this.error = true;
                }
            }
        },
        onTimingViewError() { this.error = true; },
    },
};
</script>

<style scoped>
.event-guest-round { max-width: 72rem; margin: 1rem auto; }
.event-guest-round > button { min-height: 48px; padding: 0.75rem 1rem; font: inherit; }
</style>
