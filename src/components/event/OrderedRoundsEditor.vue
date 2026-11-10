<template>
    <section class="ordered-rounds" aria-labelledby="ordered-rounds-title">
        <h2 id="ordered-rounds-title">Ordered rounds</h2>
        <p>Prepare 1–20 locations in play order. Each round must be previewed and confirmed before export.</p>

        <div class="ordered-rounds__actions">
            <button type="button" :disabled="!canAdd" @click="addRound">Add round</button>
            <span role="status">{{ rounds.length }} of {{ MAX_ROUNDS }} rounds</span>
        </div>

        <ol class="ordered-rounds__list">
            <li v-for="(round, index) in rounds" :key="round.localId">
                <div class="ordered-rounds__row">
                    <button type="button" class="ordered-rounds__select" :aria-current="activeId === round.localId ? 'step' : null" @click="activeId = round.localId">
                        Round {{ index + 1 }} <span>{{ isConfirmed(round) ? 'Preview confirmed' : 'Needs preview' }}</span>
                    </button>
                    <div class="ordered-rounds__actions">
                        <button type="button" :disabled="index === 0" :aria-label="`Move round ${index + 1} up`" @click="move(index, -1)">Move up</button>
                        <button type="button" :disabled="index === rounds.length - 1" :aria-label="`Move round ${index + 1} down`" @click="move(index, 1)">Move down</button>
                        <button type="button" :disabled="!canRemove" :aria-label="`Remove round ${index + 1}`" @click="remove(index)">Remove</button>
                    </div>
                </div>
            </li>
        </ol>

        <template v-if="activeRound">
            <fieldset class="ordered-rounds__fields">
                <legend>Round {{ activeIndex + 1 }} details</legend>
                <label :for="fieldId('panoramaId')">Panorama ID</label>
                <input :id="fieldId('panoramaId')" v-model="activeRound.panoramaId" autocomplete="off" spellcheck="false">
                <label :for="fieldId('heading')">Heading (0 to less than 360)</label>
                <input :id="fieldId('heading')" v-model="activeRound.heading" inputmode="decimal" autocomplete="off">
                <label :for="fieldId('pitch')">Pitch (-90 to 90)</label>
                <input :id="fieldId('pitch')" v-model="activeRound.pitch" inputmode="decimal" autocomplete="off">
                <label :for="fieldId('answerLat')">Answer latitude (-90 to 90)</label>
                <input :id="fieldId('answerLat')" v-model="activeRound.answerLat" inputmode="decimal" autocomplete="off">
                <label :for="fieldId('answerLng')">Answer longitude (-180 to 180)</label>
                <input :id="fieldId('answerLng')" v-model="activeRound.answerLng" inputmode="decimal" autocomplete="off">
                <label :for="fieldId('difficulty')">Difficulty in meters</label>
                <input :id="fieldId('difficulty')" v-model="activeRound.difficulty" inputmode="decimal" autocomplete="off">
            </fieldset>

            <section class="ordered-rounds__preview" aria-labelledby="ordered-preview-title">
                <h3 id="ordered-preview-title">Round {{ activeIndex + 1 }} panorama preview</h3>
                <p v-if="!previewValid" role="status">Enter a valid panorama ID, heading, and pitch to preview this round.</p>
                <EventPanoramaPreview
                    v-if="previewValid"
                    :key="previewKey"
                    :panorama-id="activeRound.panoramaId"
                    :heading="values.heading"
                    :pitch="values.pitch"
                    :maps-loader="mapsLoader"
                    @choice="previewChoiceHandler"
                />
                <p v-if="previewValid && !isConfirmed(activeRound)" role="status">Confirm the successful preview for this round before export.</p>
                <p v-if="previewValid && isConfirmed(activeRound)" role="status">This round’s current panorama and answer are confirmed.</p>
            </section>
        </template>
    </section>
</template>

<script>
import EventPanoramaPreview from '@/components/event/EventPanoramaPreview.vue';
import {
    MAX_ROUNDS, createRound, confirmationKey, isConfirmed, roundValues,
    canAdd, canRemove, moveRound, removeRound,
} from '@/utils/event/orderedSetup';

export default {
    name: 'OrderedRoundsEditor',
    components: { EventPanoramaPreview },
    props: { mapsLoader: { type: Function, required: true } },
    data() {
        const first = createRound();
        return { rounds: [first], activeId: first.localId, MAX_ROUNDS };
    },
    computed: {
        activeIndex() { return this.rounds.findIndex(round => round.localId === this.activeId); },
        activeRound() { return this.rounds[this.activeIndex] || null; },
        values() { return this.activeRound ? roundValues(this.activeRound) : {}; },
        previewValid() {
            return this.activeRound && this.values.panoramaId && this.values.panoramaId.length <= 512 &&
                this.activeRound.panoramaId.trim() === this.activeRound.panoramaId &&
                Number.isFinite(this.values.heading) && this.values.heading >= 0 && this.values.heading < 360 &&
                Number.isFinite(this.values.pitch) && this.values.pitch >= -90 && this.values.pitch <= 90;
        },
        previewKey() {
            return this.activeRound ? JSON.stringify([this.activeRound.localId, confirmationKey(this.activeRound)]) : '';
        },
        previewChoiceHandler() {
            const localId = this.activeRound && this.activeRound.localId;
            const key = this.previewKey;
            return choice => this.recordChoice(localId, key, choice);
        },
        canAdd() { return canAdd(this.rounds); },
        canRemove() { return canRemove(this.rounds); },
    },
    watch: {
        rounds: {
            deep: true,
            handler() {
                // Keep the confirmation attached to its row and invalidate it as soon as its location changes.
                this.rounds.forEach(round => {
                    if (round.confirmation && round.confirmation !== confirmationKey(round)) round.confirmation = '';
                });
                this.emitRows();
            },
        },
    },
    mounted() { this.emitRows(); },
    methods: {
        isConfirmed,
        fieldId(field) { return `ordered-round-${this.activeRound.localId}-${field}`; },
        emitRows() { this.$emit('change', this.rounds.map(round => ({ ...round }))); },
        addRound() {
            if (!this.canAdd) return;
            const round = createRound();
            this.rounds.push(round);
            this.activeId = round.localId;
            this.emitRows();
        },
        move(index, direction) {
            const moved = moveRound(this.rounds, index, direction);
            if (moved === this.rounds) return;
            const selectedId = this.activeId;
            this.rounds = moved;
            this.activeId = selectedId;
            this.emitRows();
        },
        remove(index) {
            const removed = removeRound(this.rounds, index);
            if (removed === this.rounds) return;
            this.rounds = removed;
            if (!this.rounds.some(round => round.localId === this.activeId)) {
                this.activeId = this.rounds[Math.min(index, this.rounds.length - 1)].localId;
            }
            this.emitRows();
        },
        recordChoice(localId, key, choice) {
            // A late preview event can only confirm the same row and exact configuration that requested it.
            const row = this.rounds.find(item => item.localId === localId);
            if (!row || this.activeId !== localId || key !== this.previewKey ||
                !choice || choice.panoramaId !== row.panoramaId ||
                choice.heading !== this.values.heading || choice.pitch !== this.values.pitch) return;
            row.confirmation = confirmationKey(row);
            this.emitRows();
        },
    },
};
</script>

<style scoped>
.ordered-rounds { margin-top: 1rem; }
.ordered-rounds__actions, .ordered-rounds__row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.ordered-rounds__list { padding-left: 1.5rem; }
.ordered-rounds__row { justify-content: space-between; margin: 0.5rem 0; }
.ordered-rounds__select { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center; }
.ordered-rounds__fields { display: grid; gap: 0.5rem; margin: 1rem 0; padding: 1rem; }
.ordered-rounds__fields input { box-sizing: border-box; width: 100%; min-height: 2.75rem; padding: 0.5rem; font: inherit; }
.ordered-rounds button { min-height: 3rem; padding: 0.5rem 1rem; font: inherit; }
.ordered-rounds button:disabled { cursor: not-allowed; opacity: 0.6; }
.ordered-rounds__preview { margin-top: 1.5rem; }
@media (max-width: 36rem) { .ordered-rounds__row { align-items: stretch; flex-direction: column; } .ordered-rounds__row > * { width: 100%; } }
</style>
