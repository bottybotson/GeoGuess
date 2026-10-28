<template>
    <main class="event-round-results" aria-live="polite">
        <h1>Round results</h1>
        <section v-if="validReveal" class="event-round-results__answer" aria-label="Correct location">
            <h2>Correct location</h2>
            <p>Latitude: {{ reveal.answer.lat }} · Longitude: {{ reveal.answer.lng }}</p>
        </section>
        <p v-else class="event-round-results__status" role="status">Round results are unavailable.</p>
        <section v-if="validReveal" class="event-round-results__list" aria-label="Player results">
            <h2>Players</h2>
            <p v-if="sortedResults.length === 0">No submitted results.</p>
            <ol v-else>
                <li v-for="result in sortedResults" :key="result.uid" :class="{ 'is-current': result.uid === currentUid }">
                    <span class="event-round-results__nickname">{{ result.nickname }}</span>
                    <span v-if="!result.answered" class="event-round-results__no-answer">No answer · 0 points</span>
                    <span v-else class="event-round-results__points">{{ result.points }} points</span>
                    <span v-if="result.answered && result.distance !== null" class="event-round-results__distance">{{ result.distance }} km away</span>
                </li>
            </ol>
        </section>
    </main>
</template>

<script>
function validCoords(value) {
    return !!value && Number.isFinite(value.lat) && Number.isFinite(value.lng) &&
        value.lat >= -90 && value.lat <= 90 && value.lng >= -180 && value.lng <= 180;
}

export default {
    name: 'EventRoundResults',
    props: {
        reveal: { type: Object, required: true },
        currentUid: { type: String, default: '' },
    },
    computed: {
        validReveal() {
            return !!this.reveal && typeof this.reveal.roundId === 'string' &&
                validCoords(this.reveal.answer) && !!this.reveal.results &&
                typeof this.reveal.results === 'object' && !Array.isArray(this.reveal.results);
        },
        sortedResults() {
            if (!this.validReveal) return [];
            return Object.keys(this.reveal.results).map((uid) => {
                const item = this.reveal.results[uid];
                if (!item || typeof item !== 'object') return null;
                const answered = item.answered === true;
                return {
                    uid,
                    nickname: typeof item.nickname === 'string' ? item.nickname : 'Guest',
                    answered,
                    points: answered && Number.isFinite(item.points) && item.points >= 0 ? item.points : 0,
                    distance: answered && Number.isFinite(item.distance) && item.distance >= 0
                        ? (item.distance / 1000).toFixed(1)
                        : null,
                };
            }).filter(Boolean).sort((a, b) => b.points - a.points || (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
        },
    },
};
</script>

<style scoped>
.event-round-results { box-sizing: border-box; padding: clamp(1rem, 4vw, 3rem); color: #17212b; font-family: Arial, sans-serif; font-size: 1.25rem; line-height: 1.45; }
.event-round-results h1 { margin: 0 0 1rem; font-size: clamp(2rem, 5vw, 3rem); }
.event-round-results h2 { margin: 0 0 0.5rem; font-size: 1.5rem; }
.event-round-results__answer, .event-round-results__list { margin: 0 auto 1.5rem; max-width: 60rem; }
.event-round-results__answer p { margin: 0; overflow-wrap: anywhere; }
.event-round-results ol { display: grid; gap: 0.5rem; margin: 0; padding-left: 2rem; }
.event-round-results li { padding: 0.5rem; border-bottom: 1px solid #8a969f; }
.event-round-results li.is-current { border: 3px solid #145b9e; border-radius: 0.4rem; }
.event-round-results__nickname { font-weight: 700; }
.event-round-results__points, .event-round-results__no-answer, .event-round-results__distance { display: inline-block; margin-left: 1rem; }
</style>
