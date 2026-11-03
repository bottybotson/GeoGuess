<template>
    <main class="event-round-play" :class="{ 'event-round-play--mobile': mobile, 'event-round-play--reveal': phase === 'reveal', 'event-round-play--exploring': activeView === 'explore' }" :style="viewportStyle">
        <p v-if="!validRound || !knownPhase" class="event-round-play__status" role="alert">
            This round is unavailable.
        </p>
        <template v-else>
            <nav v-if="phase !== 'reveal'" class="event-round-play__views" aria-label="Choose play view">
                <button type="button" :aria-pressed="activeView === 'explore'" @click="activeView = 'explore'">Explore</button>
                <button type="button" :aria-pressed="activeView === 'guess'" @click="activeView = 'guess'">Guess</button>
            </nav>
            <p v-if="phaseOpen" class="event-round-play__instruction">{{ mobile ? (activeView === 'explore' ? 'Look around, then choose Guess.' : 'Tap the map to place your guess.') : 'Explore Street View, then tap the world map to place your guess.' }}</p>
            <div key="explore" v-if="phase !== 'reveal'" v-show="showExplore" class="event-round-play__panel event-round-play__explore">
                <EventPanorama v-if="hasPanorama" :round="round" :maps-loader="mapsLoader" :active="showExplore" :fill="mobile" />
                <p v-else class="event-round-play__status">Street View is unavailable for this round.</p>
            </div>
            <div key="guess" v-show="showGuess" class="event-round-play__panel event-round-play__guess">
                <EventGuessMap
                    :key="round.id"
                    :maps-loader="mapsLoader"
                    :disabled="!canEdit || !showGuess"
                    :selected="visibleGuess"
                    :answer="revealedAnswer"
                    :active="showGuess"
                    :fill="mobile"
                    :gesture-handling="mobile ? 'greedy' : 'auto'"
                    @select="selectGuess"
                />
            </div>
            <section v-if="phase !== 'reveal'" class="event-round-play__controls" aria-label="Submit your guess">
                <p v-if="statusMessage" class="event-round-play__status" role="status">{{ statusMessage }}</p>
                <button v-show="!mobile || activeView === 'guess'" class="event-round-play__submit" type="button" :disabled="!canSubmit" @click="submitGuess">
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
        answer: { type: Object, default: null },
    },
    data() { return { selection: null, submitLatched: false, activeView: 'explore', mobile: false, viewportHeight: null }; },
    computed: {
        showExplore() { return this.phase !== 'reveal' && (!this.mobile || this.activeView === 'explore'); },
        showGuess() { return this.phase === 'reveal' || !this.mobile || this.activeView === 'guess'; },
        viewportStyle() { return this.mobile && this.viewportHeight ? { '--play-height': `${this.viewportHeight}px` } : {}; },
        validRound() {
            return !!this.round && typeof this.round.id === 'string' && this.round.id.length > 0 &&
                (this.phase === 'reveal' || hasPanorama(this.round));
        },
        knownPhase() { return ['lobby', 'guessing', 'closed', 'reveal', 'complete'].includes(this.phase); },
        phaseOpen() { return this.phase === 'guessing'; },
        canEdit() {
            return this.validRound && this.phaseOpen && !this.submitLatched &&
                ['idle', 'error'].includes(this.submissionState);
        },
        canSubmit() { return this.canEdit && !this.submitLatched && validCoords(this.visibleGuess); },
        visibleGuess() {
            if (validCoords(this.submittedGuess)) return this.submittedGuess;
            return this.phase === 'reveal' ? null : this.selection;
        },
        revealedAnswer() { return this.phase === 'reveal' && validCoords(this.answer) ? this.answer : null; },
        hasPanorama() { return hasPanorama(this.round); },
        statusMessage() {
            if (this.submissionState === 'accepted') return 'Your guess is saved.';
            if (this.submissionState === 'submitting') return 'Saving your guess…';
            if (this.submissionState === 'error') return 'Your guess was not confirmed. Check your connection, then retry.';
            if (this.submitLatched) return 'Submitting your guess…';
            if (!this.phaseOpen) return 'This round is closed for guesses.';
            if (this.mobile && this.activeView === 'explore') return validCoords(this.visibleGuess) ? 'Your selected pin is kept on Guess.' : 'No guess saved yet.';
            return validCoords(this.visibleGuess) ? 'Guess selected. Review the pin, then submit.' : 'Tap the map to place your guess.';
        },
    },
    watch: {
        'round.id'() { this.selection = null; this.submitLatched = false; this.activeView = 'explore'; },
        phase(value) {
            if (value !== 'guessing') this.submitLatched = false;
            this.$nextTick(this.updateViewport);
        },
        submissionState(value) {
            if (value === 'idle' || value === 'error') this.submitLatched = false;
            this.$nextTick(this.updateViewport);
        },
    },
    mounted() {
        this.updateViewport();
        window.addEventListener('resize', this.updateViewport);
        if (window.visualViewport) window.visualViewport.addEventListener('resize', this.updateViewport);
    },
    beforeDestroy() {
        window.removeEventListener('resize', this.updateViewport);
        if (window.visualViewport) window.visualViewport.removeEventListener('resize', this.updateViewport);
    },
    methods: {
        updateViewport() {
            this.mobile = window.matchMedia ? window.matchMedia('(max-width: 800px), (max-width: 1000px) and (max-height: 500px)').matches : false;
            const viewport = window.visualViewport;
            const bottom = viewport ? viewport.height + viewport.offsetTop : window.innerHeight;
            this.viewportHeight = Math.max(160, Math.floor(bottom - this.$el.getBoundingClientRect().top - 8));
        },
        selectGuess(coords) {
            if (this.showGuess && this.canEdit && validCoords(coords)) this.selection = { lat: coords.lat, lng: coords.lng };
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
.event-round-play { display: grid; gap: 1rem; color: #17212b; font-family: Arial, sans-serif; font-size: 1.25rem; line-height: 1.45; min-width: 0; }
.event-round-play__views { display: none; }
.event-round-play__instruction, .event-round-play__status { margin: 0; }
.event-round-play__panel { min-width: 0; }
.event-round-play__controls { display: grid; justify-items: center; gap: 0.75rem; padding: 0.5rem; }
.event-round-play button { min-height: 3.5rem; padding: 0.5rem 1.5rem; border: 0; border-radius: 0.4rem; background: #145b9e; color: #fff; font: inherit; font-weight: 700; cursor: pointer; }
.event-round-play button:disabled { background: #66727d; cursor: default; }
.event-round-play button:focus-visible { outline: 3px solid #111; outline-offset: 2px; }
.event-round-play--mobile { height: var(--play-height, 75dvh); box-sizing: border-box; grid-template-rows: auto auto minmax(0, 1fr) auto; gap: 0.4rem; padding-bottom: env(safe-area-inset-bottom, 0px); font-size: 1rem; }
.event-round-play--mobile .event-round-play__views { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
.event-round-play--mobile .event-round-play__views button { min-height: 48px; border: 2px solid #145b9e; background: #fff; color: #145b9e; }
.event-round-play--mobile .event-round-play__views button[aria-pressed="true"] { background: #145b9e; color: #fff; text-decoration: underline; text-underline-offset: 0.2rem; }
.event-round-play--mobile .event-round-play__panel { min-height: 0; grid-row: 3; }
.event-round-play--mobile .event-round-play__controls { grid-row: 4; gap: 0.35rem; padding: 0; text-align: center; }
.event-round-play--mobile .event-round-play__submit { width: 100%; min-height: 48px; }
.event-round-play--mobile.event-round-play--reveal { height: min(60dvh, 32rem); grid-template-rows: minmax(0, 1fr); }
.event-round-play--mobile.event-round-play--reveal .event-round-play__panel { grid-row: 1; }
@media (max-height: 500px) and (max-width: 1000px) {
    .event-round-play--mobile { grid-template-rows: auto minmax(0, 1fr) auto; gap: 0.25rem; }
    .event-round-play--mobile .event-round-play__instruction { display: none; }
    .event-round-play--mobile .event-round-play__panel { grid-row: 2; }
    .event-round-play--mobile .event-round-play__controls { grid-row: 3; grid-template-columns: minmax(0, 1fr) minmax(10rem, 1fr); text-align: left; gap: 0.5rem; }
    .event-round-play--mobile.event-round-play--exploring .event-round-play__controls { grid-template-columns: 1fr; }
    .event-round-play--mobile.event-round-play--reveal { grid-template-rows: minmax(0, 1fr); }
    .event-round-play--mobile.event-round-play--reveal .event-round-play__panel { grid-row: 1; }
}
</style>
