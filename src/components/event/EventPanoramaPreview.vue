<template>
    <section class="event-panorama-preview" aria-label="Panorama configuration preview">
        <p v-if="!isValid" class="event-panorama-preview__message" role="alert">
            Enter a panorama ID, a heading from 0 to less than 360, and a pitch from -90 to 90.
        </p>
        <template v-else>
            <EventPanorama
                ref="preview"
                :round="previewRound"
                :maps-loader="mapsLoader"
            />
            <button
                class="event-panorama-preview__choice"
                type="button"
                :disabled="previewStatus !== 'ready'"
                @click="selectPreview"
            >
                Use this panorama
            </button>
            <p v-if="choiceMessage" class="event-panorama-preview__message" role="status">
                {{ choiceMessage }}
            </p>
        </template>
    </section>
</template>

<script>
import EventPanorama from './EventPanorama.vue';

function validConfiguration(panoramaId, heading, pitch) {
    return typeof panoramaId === 'string' && panoramaId.length > 0 && panoramaId.length <= 512 &&
        panoramaId.trim() === panoramaId && Number.isFinite(heading) && heading >= 0 && heading < 360 &&
        Number.isFinite(pitch) && pitch >= -90 && pitch <= 90;
}

export default {
    name: 'EventPanoramaPreview',
    components: { EventPanorama },
    props: {
        panoramaId: { type: String, default: '' },
        heading: { type: Number, default: NaN },
        pitch: { type: Number, default: NaN },
        mapsLoader: { type: Function, required: true },
    },
    data() {
        return { previewStatus: '', choiceMessage: '', stopWatchingPreview: null };
    },
    computed: {
        isValid() {
            return validConfiguration(this.panoramaId, this.heading, this.pitch);
        },
        previewRound() {
            if (!this.isValid) return null;
            return {
                id: 'configuration-preview',
                panoramaId: this.panoramaId,
                heading: this.heading,
                pitch: this.pitch,
            };
        },
        configurationKey() {
            return JSON.stringify([this.panoramaId, this.heading, this.pitch]);
        },
    },
    watch: {
        configurationKey: {
            sync: true,
            handler() {
                this.previewStatus = 'loading';
                this.choiceMessage = '';
            },
        },
        isValid() {
            this.$nextTick(this.watchPreviewStatus);
        },
    },
    mounted() {
        this.$nextTick(this.watchPreviewStatus);
    },
    beforeDestroy() {
        if (this.stopWatchingPreview) this.stopWatchingPreview();
    },
    methods: {
        watchPreviewStatus() {
            if (this._isBeingDestroyed || this._isDestroyed) return;
            if (this.stopWatchingPreview) {
                this.stopWatchingPreview();
                this.stopWatchingPreview = null;
            }
            const preview = this.$refs.preview;
            if (!preview) {
                this.previewStatus = '';
                return;
            }
            const updateStatus = (status) => {
                this.previewStatus = status || '';
                this.choiceMessage = '';
            };
            updateStatus(preview.status);
            this.stopWatchingPreview = preview.$watch('status', updateStatus);
        },
        selectPreview() {
            const preview = this.$refs.preview;
            const previewRound = preview && preview.round;
            const matchesConfiguration = previewRound && previewRound.panoramaId === this.panoramaId &&
                previewRound.heading === this.heading && previewRound.pitch === this.pitch;
            if (!this.isValid || this.previewStatus !== 'ready' || !preview || preview.status !== 'ready' || !matchesConfiguration) return;
            this.$emit('choice', {
                panoramaId: this.panoramaId,
                heading: this.heading,
                pitch: this.pitch,
            });
            this.choiceMessage = 'Panorama choice selected.';
        },
    },
};
</script>

<style scoped>
.event-panorama-preview__choice { min-height: 3.5rem; margin-top: 1rem; padding: 0.5rem 1.25rem; font-size: 1.25rem; font-weight: 700; }
.event-panorama-preview__choice:disabled { cursor: not-allowed; opacity: 0.65; }
.event-panorama-preview__message { margin: 0.75rem 0 0; color: #17212b; }
</style>
