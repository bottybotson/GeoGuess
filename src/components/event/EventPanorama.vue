<template>
    <section class="event-panorama" aria-label="Street View panorama" aria-live="polite">
        <div ref="panorama" class="event-panorama__view"></div>
        <div v-if="status !== 'ready'" class="event-panorama__message" role="status">
            <p>{{ message }}</p>
            <button v-if="status === 'error'" type="button" @click="loadPanorama">
                Retry Street View
            </button>
        </div>
    </section>
</template>

<script>
const LOAD_TIMEOUT_MS = 10000;

function validRound(round) {
    return !!round && typeof round.id === 'string' && round.id.length > 0 &&
        typeof round.panoramaId === 'string' && round.panoramaId.length > 0 && round.panoramaId.length <= 512 &&
        Number.isFinite(round.heading) && round.heading >= 0 && round.heading < 360 &&
        Number.isFinite(round.pitch) && round.pitch >= -90 && round.pitch <= 90;
}

export default {
    name: 'EventPanorama',
    props: {
        round: { type: Object, required: true },
        mapsLoader: { type: Function, required: true },
    },
    data() {
        return { status: 'loading', generation: 0, panorama: null, listeners: [], statusTimeout: null };
    },
    computed: {
        message() {
            if (this.status === 'ready') return '';
            if (this.status === 'error') return 'Street View could not be loaded. Check your connection and try again.';
            if (!validRound(this.round)) return 'This round’s Street View is unavailable.';
            return 'Loading Street View…';
        },
        roundKey() {
            if (!validRound(this.round)) return '';
            return [this.round.id, this.round.panoramaId, this.round.heading, this.round.pitch].join('|');
        },
    },
    watch: {
        roundKey() {
            this.loadPanorama();
        },
    },
    mounted() {
        this.loadPanorama();
    },
    beforeDestroy() {
        this.generation += 1;
        this.disposePanorama();
    },
    methods: {
        disposePanorama() {
            clearTimeout(this.statusTimeout);
            this.statusTimeout = null;
            this.listeners.forEach((listener) => {
                if (listener && typeof listener.remove === 'function') listener.remove();
            });
            this.listeners = [];
            if (this.panorama) {
                this.panorama.setVisible(false);
                this.panorama = null;
            }
        },
        async loadPanorama() {
            const generation = ++this.generation;
            this.disposePanorama();
            if (!validRound(this.round) || typeof this.mapsLoader !== 'function') {
                this.status = 'error';
                return;
            }
            this.status = 'loading';
            let timeout;
            try {
                const maps = await Promise.race([
                    Promise.resolve().then(() => this.mapsLoader()),
                    new Promise((_, reject) => {
                        timeout = setTimeout(() => reject(new Error('Maps load timed out')), LOAD_TIMEOUT_MS);
                    }),
                ]);
                if (generation !== this.generation) return;
                if (!maps || !maps.StreetViewPanorama || !maps.event || typeof maps.event.addListener !== 'function') {
                    throw new Error('Street View API unavailable');
                }
                const round = this.round;
                const panorama = new maps.StreetViewPanorama(this.$refs.panorama, {
                    pano: round.panoramaId,
                    pov: { heading: round.heading, pitch: round.pitch },
                    visible: true,
                    addressControl: false,
                });
                this.panorama = panorama;
                const checkStatus = () => {
                    if (generation !== this.generation) return;
                    const ok = maps.StreetViewStatus ? maps.StreetViewStatus.OK : 'OK';
                    const status = panorama.getStatus();
                    if (status === ok) {
                        clearTimeout(this.statusTimeout);
                        this.statusTimeout = null;
                        this.status = 'ready';
                    }
                    else if (status === 'ZERO_RESULTS' || status === 'UNKNOWN_ERROR') {
                        this.status = 'error';
                        this.disposePanorama();
                    }
                };
                this.listeners.push(maps.event.addListener(panorama, 'status_changed', checkStatus));
                this.statusTimeout = setTimeout(() => {
                    if (generation !== this.generation) return;
                    this.status = 'error';
                    this.disposePanorama();
                }, LOAD_TIMEOUT_MS);
                checkStatus();
            } catch (error) {
                if (generation === this.generation) {
                    this.status = 'error';
                    this.disposePanorama();
                }
            } finally {
                clearTimeout(timeout);
            }
        },
    },
};
</script>

<style scoped>
.event-panorama { position: relative; min-height: 18rem; width: 100%; }
.event-panorama__view { min-height: 18rem; width: 100%; }
.event-panorama__message { position: absolute; inset: 0; display: grid; place-content: center; gap: 1rem; padding: 1rem; background: #f3f6f8; color: #17212b; text-align: center; font-size: 1.25rem; }
.event-panorama__message p { margin: 0; }
.event-panorama__message button { min-height: 3.5rem; padding: 0.5rem 1.25rem; font-size: 1.25rem; font-weight: 700; }
</style>
