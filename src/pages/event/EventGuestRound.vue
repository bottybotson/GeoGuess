<template>
    <section class="event-guest-round">
        <p v-if="loading" role="status">Loading the round…</p>
        <p v-if="error" role="alert">We couldn’t confirm the round. Check your connection and retry.</p>
        <button v-if="error" type="button" @click="refresh">Retry connection</button>
        <EventRoundResults v-if="phase === 'reveal' && reveal" :reveal="reveal" />
        <EventRoundPlay
            v-else-if="round && phase !== 'reveal'"
            :round="round" :phase="phase" :maps-loader="mapsLoader"
            :submission-state="submissionState" :submitted-guess="submittedGuess"
            @submit="submit"
        />
    </section>
</template>

<script>
import EventRoundPlay from '@/components/event/EventRoundPlay.vue';
import EventRoundResults from '@/components/event/EventRoundResults.vue';

export default {
    name: 'EventGuestRound',
    inheritAttrs: false,
    components: { EventRoundPlay, EventRoundResults },
    props: {
        eventId: { type: String, required: true },
        phase: { type: String, required: true },
        roundClient: { type: Object, required: true },
        mapsLoader: { type: Function, required: true },
    },
    data() {
        return { round: null, reveal: null, submittedGuess: null, submissionState: 'submitting',
            loading: false, error: false, epoch: 0, scheduled: false, gone: false };
    },
    watch: {
        eventId() { this.schedule(); },
        phase() { this.schedule(); },
        roundClient() { this.schedule(); },
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
            const current = () => !this.gone && epoch === this.epoch && client === this.roundClient && eventId === this.eventId && phase === this.phase;
            this.loading = true;
            this.error = false;
            this.submissionState = 'submitting';
            if (phase === 'reveal') {
                try {
                    const reveal = await client.getReveal(eventId);
                    if (!current()) return;
                    if (!reveal) throw new Error('Reveal unavailable');
                    this.reveal = reveal;
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
                !this.round || !payload || payload.roundId !== this.round.id) return;
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
    },
};
</script>

<style scoped>
.event-guest-round { max-width: 72rem; margin: 1rem auto; }
.event-guest-round > button { min-height: 48px; padding: 0.75rem 1rem; font: inherit; }
</style>
