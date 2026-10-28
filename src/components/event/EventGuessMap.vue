<template>
    <div ref="map" class="event-guess-map" role="application" aria-label="Choose your guess on the world map"></div>
</template>

<script>
const WORLD_CENTER = { lat: 15, lng: 0 };

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
    },
    data() {
        return { map: null, marker: null, clickListener: null, generation: 0, mapsApi: null };
    },
    watch: {
        selected(value) { this.updateMarker(value); },
    },
    mounted() {
        this.createMap();
    },
    beforeDestroy() {
        this.generation += 1;
        if (this.clickListener && typeof this.clickListener.remove === 'function') this.clickListener.remove();
        this.clickListener = null;
        if (this.marker) this.marker.setMap(null);
        this.marker = null;
        this.map = null;
        this.mapsApi = null;
    },
    methods: {
        async createMap() {
            const generation = ++this.generation;
            try {
                const maps = await this.mapsLoader();
                if (generation !== this.generation) return;
                if (!maps || !maps.Map || !maps.Marker || !maps.event || typeof maps.event.addListener !== 'function') return;
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
                this.clickListener = maps.event.addListener(map, 'click', (event) => {
                    if (this.disabled || generation !== this.generation || !event || !event.latLng) return;
                    const lat = typeof event.latLng.lat === 'function' ? event.latLng.lat() : NaN;
                    const lng = typeof event.latLng.lng === 'function' ? event.latLng.lng() : NaN;
                    const coords = { lat, lng };
                    if (!validCoords(coords)) return;
                    this.updateMarker(coords, maps);
                    this.$emit('select', { lat, lng });
                });
                this.updateMarker(this.selected, maps);
            } catch (error) {
                if (generation === this.generation) this.$emit('map-error');
            }
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
                this.marker = new maps.Marker({ map: this.map, position: { lat: value.lat, lng: value.lng } });
            } else {
                this.marker.setPosition({ lat: value.lat, lng: value.lng });
                this.marker.setMap(this.map);
            }
        },
    },
};
</script>

<style scoped>
.event-guess-map { width: 100%; min-height: 18rem; height: 42vh; background: #eef2f5; }
</style>
