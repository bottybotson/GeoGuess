<template>
    <section>
        <div class="event-guess-map-shell">
            <div ref="map" class="event-guess-map" role="application" :aria-label="hasAnswer ? 'Round result map: correct location and saved guess' : 'Choose your guess on the world map'"></div>
            <div v-if="status === 'loading'" class="map-message" role="status" aria-live="polite">
                Loading the guess map…
            </div>
            <div v-else-if="status === 'error'" class="map-message map-error" role="alert">
                <p>The guess map could not be loaded.</p>
                <p>If this keeps happening, reload this page.</p>
                <button type="button" class="map-retry" @click="retry">Try again</button>
            </div>
        </div>
        <p v-if="hasAnswer" class="event-guess-map-legend" aria-label="Map legend">
            A — Correct location · {{ hasGuess ? 'G — Your saved guess' : 'No saved guess' }}
        </p>
    </section>
</template>

<script>
const WORLD_CENTER = { lat: 15, lng: 0 };
const LOAD_TIMEOUT_MS = 15000;

function validCoords(value) {
    return !!value && Number.isFinite(value.lat) && Number.isFinite(value.lng) &&
        value.lat >= -90 && value.lat <= 90 && value.lng >= -180 && value.lng <= 180;
}

export default {
    name: 'EventGuessMap',
    props: {
        mapsLoader: { type: Function, required: true },
        disabled: { type: Boolean, default: false },
        selected: { type: Object, default: null },
        answer: { type: Object, default: null },
    },
    data() {
        return {
            map: null,
            marker: null,
            answerMarker: null,
            clickListener: null,
            generation: 0,
            mapsApi: null,
            status: 'loading',
            timeoutId: null,
        };
    },
    computed: {
        hasAnswer() { return validCoords(this.answer); },
        hasGuess() { return validCoords(this.selected); },
    },
    watch: {
        selected(value) { this.updateMarker(value); this.fitReveal(); },
        answer() { this.updateAnswer(); },
        mapsLoader() { this.createMap(); },
    },
    mounted() {
        this.createMap();
    },
    beforeDestroy() {
        this.generation += 1;
        this.disposeMap();
    },
    methods: {
        async createMap() {
            const generation = ++this.generation;
            this.disposeMap();
            this.status = 'loading';
            try {
                const maps = await Promise.race([
                    this.mapsLoader(),
                    new Promise((resolve, reject) => {
                        this.timeoutId = setTimeout(() => reject(new Error('Map load timed out')), LOAD_TIMEOUT_MS);
                    }),
                ]);
                if (generation !== this.generation) return;
                if (!maps || typeof maps.Map !== 'function' || typeof maps.Marker !== 'function' ||
                    !maps.event || typeof maps.event.addListener !== 'function') {
                    throw new Error('Invalid Maps API');
                }
                const map = new maps.Map(this.$refs.map, {
                    center: WORLD_CENTER,
                    zoom: 2,
                    mapTypeId: 'roadmap',
                    streetViewControl: false,
                    clickableIcons: false,
                    fullscreenControl: false,
                });
                this.map = map;
                this.mapsApi = maps;
                this.status = 'ready';
                this.clickListener = maps.event.addListener(map, 'click', (event) => {
                    if (this.disabled || this.hasAnswer || generation !== this.generation || !event || !event.latLng) return;
                    const lat = typeof event.latLng.lat === 'function' ? event.latLng.lat() : NaN;
                    const lng = typeof event.latLng.lng === 'function' ? event.latLng.lng() : NaN;
                    const coords = { lat, lng };
                    if (!validCoords(coords)) return;
                    this.updateMarker(coords, maps);
                    this.$emit('select', { lat, lng });
                });
                this.updateMarker(this.selected, maps);
                this.updateAnswer();
            } catch (error) {
                if (generation === this.generation) {
                    this.disposeMap();
                    this.status = 'error';
                    this.$emit('map-error');
                }
            } finally {
                if (generation === this.generation && this.timeoutId) {
                    clearTimeout(this.timeoutId);
                    this.timeoutId = null;
                }
            }
        },
        retry() {
            if (this.status !== 'error') return;
            this.createMap();
        },
        disposeMap() {
            if (this.timeoutId) {
                clearTimeout(this.timeoutId);
                this.timeoutId = null;
            }
            if (this.clickListener && typeof this.clickListener.remove === 'function') {
                try { this.clickListener.remove(); } catch (error) { /* Provider listener may already be disposed. */ }
            }
            this.clickListener = null;
            if (this.marker && typeof this.marker.setMap === 'function') {
                try { this.marker.setMap(null); } catch (error) { /* Provider map may already be disposed. */ }
            }
            this.marker = null;
            if (this.answerMarker && typeof this.answerMarker.setMap === 'function') {
                try { this.answerMarker.setMap(null); } catch (error) { /* Provider map may already be disposed. */ }
            }
            this.answerMarker = null;
            this.map = null;
            this.mapsApi = null;
        },
        updateAnswer() {
            if (!this.map) return;
            if (!this.hasAnswer) {
                if (this.answerMarker) this.answerMarker.setMap(null);
                this.answerMarker = null;
                if (typeof this.map.setOptions === 'function') this.map.setOptions({ maxZoom: null });
                return;
            }
            const position = { lat: this.answer.lat, lng: this.answer.lng };
            if (!this.answerMarker) {
                this.answerMarker = new this.mapsApi.Marker({ map: this.map, position,
                    title: 'Correct location (A)', label: { text: 'A', color: '#fff', fontWeight: 'bold' } });
            } else {
                this.answerMarker.setPosition(position);
            }
            this.fitReveal();
        },
        fitReveal() {
            if (!this.map || !this.hasAnswer) return;
            const bounds = new this.mapsApi.LatLngBounds();
            bounds.extend({ lat: this.answer.lat, lng: this.answer.lng });
            if (this.hasGuess) bounds.extend({ lat: this.selected.lat, lng: this.selected.lng });
            // Bound the zoom for coincident pins and unanswered rounds, too.
            this.map.setOptions({ maxZoom: 16 });
            this.map.fitBounds(bounds, { top: 56, right: 56, bottom: 56, left: 56 });
        },
        updateMarker(value, api) {
            if (!this.map) return;
            if (!validCoords(value)) {
                if (this.marker) this.marker.setMap(null);
                this.marker = null;
                return;
            }
            if (!this.marker) {
                const maps = api || this.mapsApi;
                if (!maps || !maps.Marker) return;
                this.marker = new maps.Marker({
                    map: this.map, position: { lat: value.lat, lng: value.lng },
                    title: 'Your guess (G)', label: { text: 'G', color: '#fff', fontWeight: 'bold' },
                    icon: { path: 'M -1,0 a 1,1 0 1,0 2,0 a 1,1 0 1,0 -2,0',
                        scale: 12, fillColor: '#145b9e', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
                });
            } else {
                this.marker.setPosition({ lat: value.lat, lng: value.lng });
                this.marker.setMap(this.map);
            }
        },
    },
};
</script>

<style scoped>
.event-guess-map-shell { position: relative; width: 100%; min-height: 18rem; height: 42vh; background: #eef2f5; }
.event-guess-map { width: 100%; height: 100%; min-height: 18rem; }
.map-message { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.75rem; padding: 1rem; text-align: center; background: rgba(238, 242, 245, 0.94); font-size: 1rem; }
.map-message p { margin: 0; }
.event-guess-map-legend { margin: 0.5rem 0 0; font: inherit; }
.map-retry { min-height: 3rem; padding: 0.65rem 1.25rem; border: 0; border-radius: 0.25rem; background: #174ea6; color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
.map-retry:focus { outline: 3px solid #111; outline-offset: 2px; }
</style>
