<template>
    <main class="event-round-play" aria-live="polite">
        <p v-if="!validRound || !knownPhase" class="event-round-play__status" role="alert">
            This round is unavailable.
        </p>
        <template v-else>
            <EventPanorama v-if="hasPanorama" :round="round" :maps-loader="mapsLoader" />
            <p v-else class="event-round-play__status">Street View is unavailable for this round.</p>
            <p class="event-round-play__instruction">Explore Street View, then tap the world map to place your guess.</p>
            <EventGuessMap
                :maps-loader="mapsLoader"
                :disabled="!canEdit"
                :selected="visibleGuess"
                @select="selectGuess"
            />
            <section class="event-round-play__controls" aria-label="Submit your guess">
                <p v-if="statusMessage" class="event-round-play__status" role="status">{{ statusMessage }}</p>
                <button type="button" :disabled="!canSubmit" @click="submitGuess">
                    {{ submissionState === 'submitting' ? 'Submitting…' : 'Submit my guess' }}
                </button>
            </section>
        </template>
    </main>
</template>

<script>
import EventPanorama from './EventPanorama.vue';
import EventGuessMap from './EventGuessMap.vue';

const STATES = ['idle', 'submitting', 'accepted', 'error'];
function validCoords(value) {
    return !!value && Number.isFinite(value.lat) && Number.isFinite(value.lng) &&
        value.lat >= -90 && value.lat <= 90 && value.lng >= -180 && value.lng <= 180;
}
function hasPanorama(round) {
    return !!round && typeof round.panoramaId === 'string' && round.panoramaId.length > 0 &&
        round.panoramaId.length <= 512 && Number.isFinite(round.heading) &&
        round.heading >= 0 && round.heading < 360 && Number.isFinite(round.pitch) &&
        round.pitch >= -90 && round.pitch <= 90;
}

export default {
    name: 'EventRoundPlay',
    components: { EventPanorama, EventGuessMap },
    props: {
        round: { type: Object, required: true },
        phase: { type: String, required: true },
        mapsLoader: { type: Function, required: true },
        submissionState: { type: String, default: 'idle' },
        submittedGuess: { type: Object, default: null },
    },
    data() { return { selection: null, submitLatched: false }; },
    computed: {
        validRound() {
            return !!this.round && typeof this.round.id === 'string' && this.round.id.length > 0 &&
                hasPanorama(this.round);
        },
        knownPhase() { return ['lobby', 'guessing', 'closed', 'reveal', 'complete'].includes(this.phase); },
        phaseOpen() { return this.phase === 'guessing'; },
        canEdit() {
            return this.validRound && this.phaseOpen && !this.submitLatched &&
                ['idle', 'error'].includes(this.submissionState);
        },
        canSubmit() { return this.canEdit && !this.submitLatched && validCoords(this.visibleGuess); },
        visibleGuess() { return validCoords(this.submittedGuess) ? this.submittedGuess : this.selection; },
        hasPanorama() { return hasPanorama(this.round); },
        statusMessage() {
            if (this.submissionState === 'accepted') return 'Your guess is saved.';
            if (this.submissionState === 'submitting') return 'Saving your guess…';
            if (this.submissionState === 'error') return 'Your guess was not confirmed. Check your connection, then retry.';
            if (this.submitLatched) return 'Submitting your guess…';
            if (!this.phaseOpen) return 'This round is closed for guesses.';
            return validCoords(this.visibleGuess) ? 'Guess selected. Review the pin, then submit.' : 'Tap the map to place your guess.';
        },
    },
    watch: {
        'round.id'() { this.selection = null; this.submitLatched = false; },
        phase(value) {
            if (value !== 'guessing') this.submitLatched = false;
        },
        submissionState(value) {
            if (value === 'idle' || value === 'error') this.submitLatched = false;
        },
    },
    methods: {
        selectGuess(coords) {
            if (this.canEdit && validCoords(coords)) this.selection = { lat: coords.lat, lng: coords.lng };
        },
        submitGuess() {
            if (!this.canSubmit) return;
            this.submitLatched = true;
            this.$emit('submit', {
                roundId: this.round.id,
                guess: { lat: this.visibleGuess.lat, lng: this.visibleGuess.lng },
            });
        },
    },
    beforeMount() {
        if (!STATES.includes(this.submissionState)) this.submitLatched = true;
    },
};
</script>

<style scoped>
.event-round-play { display: grid; gap: 1rem; color: #17212b; font-family: Arial, sans-serif; font-size: 1.25rem; line-height: 1.45; }
.event-round-play__instruction, .event-round-play__status { margin: 0; }
.event-round-play__controls { display: grid; justify-items: center; gap: 0.75rem; padding: 0.5rem; }
.event-round-play__controls button { min-height: 3.5rem; padding: 0.5rem 1.5rem; border: 0; border-radius: 0.4rem; background: #145b9e; color: #fff; font-size: 1.25rem; font-weight: 700; }
.event-round-play__controls button:disabled { background: #66727d; }
</style>
