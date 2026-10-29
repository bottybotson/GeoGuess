<template>
    <main class="event-setup">
        <h1>Prepare a test event</h1>
        <p>
            Enter the event details and review the panorama before downloading the configuration file.
            Drafts stay in this browser tab and are not stored or uploaded. The preview loads from Google
            using the panorama ID and camera orientation.
        </p>

        <form class="event-setup__form" @submit.prevent>
            <fieldset>
                <legend>Firebase project</legend>
                <label for="event-setup-project">Project ID</label>
                <input id="event-setup-project" v-model="draft.projectId" autocomplete="off" spellcheck="false">
                <label for="event-setup-database">Database URL</label>
                <input id="event-setup-database" v-model="draft.databaseUrl" type="url" autocomplete="off" spellcheck="false">
                <label for="event-setup-id">Event ID</label>
                <input id="event-setup-id" v-model="draft.eventId" autocomplete="off" spellcheck="false">
            </fieldset>

            <fieldset>
                <legend>Event configuration</legend>
                <label for="event-setup-host">Existing host UID</label>
                <small id="event-setup-host-help">Use the UID from the host’s Firebase Authentication account. Do not enter a password.</small>
                <input id="event-setup-host" v-model="draft.hostUid" aria-describedby="event-setup-host-help" autocomplete="off" spellcheck="false">
                <label for="event-setup-title">Event title</label>
                <input id="event-setup-title" v-model="draft.title" maxlength="120">
            </fieldset>

            <fieldset>
                <legend>First round</legend>
                <label for="event-setup-panorama">Panorama ID</label>
                <input id="event-setup-panorama" v-model="draft.panoramaId" autocomplete="off" spellcheck="false">
                <label for="event-setup-heading">Heading (0 to less than 360)</label>
                <input id="event-setup-heading" v-model="draft.heading" inputmode="decimal" autocomplete="off">
                <label for="event-setup-pitch">Pitch (-90 to 90)</label>
                <input id="event-setup-pitch" v-model="draft.pitch" inputmode="decimal" autocomplete="off">
                <label for="event-setup-lat">Answer latitude (-90 to 90)</label>
                <input id="event-setup-lat" v-model="draft.answerLat" inputmode="decimal" autocomplete="off">
                <label for="event-setup-lng">Answer longitude (-180 to 180)</label>
                <input id="event-setup-lng" v-model="draft.answerLng" inputmode="decimal" autocomplete="off">
                <label for="event-setup-difficulty">Difficulty in meters</label>
                <input id="event-setup-difficulty" v-model="draft.difficulty" inputmode="decimal" autocomplete="off">
            </fieldset>
        </form>

        <section class="event-setup__preview" aria-labelledby="event-setup-preview-title">
            <h2 id="event-setup-preview-title">Panorama preview</h2>
            <p v-if="!previewConfigurationValid" role="status">
                Enter a valid panorama ID, heading, and pitch to preview the first round.
            </p>
            <EventPanoramaPreview
                v-if="previewConfigurationValid"
                :key="previewKey"
                :panorama-id="draft.panoramaId"
                :heading="parsedHeading"
                :pitch="parsedPitch"
                :maps-loader="mapsLoader"
                @choice="recordPreviewChoice"
            />
        </section>

        <section class="event-setup__export" aria-labelledby="event-setup-export-title">
            <h2 id="event-setup-export-title">Seed JSON</h2>
            <p v-if="!validSeed" role="status">Complete all fields with valid values to prepare the seed.</p>
            <p v-else-if="!previewChoiceCurrent" role="status">Select “Use this panorama” after the preview is ready to enable export.</p>
            <p v-if="message" role="status">{{ message }}</p>
            <div class="event-setup__actions">
                <button type="button" :disabled="!canExport" @click="copySeed">Copy JSON</button>
                <button type="button" :disabled="!canExport" @click="downloadSeed">Download JSON</button>
            </div>
            <pre v-if="canExport" aria-label="Validated seed JSON">{{ seedJson }}</pre>
        </section>
    </main>
</template>

<script>
import EventPanoramaPreview from '@/components/event/EventPanoramaPreview.vue';

const blankDraft = () => ({
    projectId: '', databaseUrl: '', eventId: '', hostUid: '', title: '', panoramaId: '',
    heading: '', pitch: '', answerLat: '', answerLng: '', difficulty: '2000',
});

function strictNumber(value) {
    if (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return NaN;
    const number = Number(value);
    return Number.isFinite(number) ? number : NaN;
}

function placeholder(value) {
    return /[<>]|^(?:YOUR_|CHANGE_?ME|REPLACE_)/i.test(value);
}

function validDatabaseUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash &&
            url.pathname === '/' && /^[a-z0-9-]+\.(firebaseio\.com|(?:[a-z0-9-]+\.)?firebasedatabase\.app)$/.test(url.hostname);
    } catch (error) {
        return false;
    }
}

function validTarget(draft) {
    return /^[a-z][a-z0-9-]{4,62}$/.test(draft.projectId) && !placeholder(draft.projectId) &&
        /^[A-Za-z0-9_-]{1,80}$/.test(draft.eventId) && !placeholder(draft.eventId) && validDatabaseUrl(draft.databaseUrl);
}

function validId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) && !placeholder(value);
}

export default {
    name: 'EventSetup',
    components: { EventPanoramaPreview },
    props: {
        mapsLoader: { type: Function, required: true },
    },
    data() {
        return {
            draft: blankDraft(),
            previewChoice: null,
            previewRevision: 0,
            message: '',
            downloadUrl: null,
        };
    },
    computed: {
        parsedHeading() { return strictNumber(this.draft.heading); },
        parsedPitch() { return strictNumber(this.draft.pitch); },
        parsedAnswerLat() { return strictNumber(this.draft.answerLat); },
        parsedAnswerLng() { return strictNumber(this.draft.answerLng); },
        parsedDifficulty() { return strictNumber(this.draft.difficulty); },
        previewConfigurationValid() {
            return this.draft.panoramaId.length > 0 && this.draft.panoramaId.length <= 512 &&
                this.draft.panoramaId.trim() === this.draft.panoramaId && !placeholder(this.draft.panoramaId) &&
                Number.isFinite(this.parsedHeading) && this.parsedHeading >= 0 && this.parsedHeading < 360 &&
                Number.isFinite(this.parsedPitch) && this.parsedPitch >= -90 && this.parsedPitch <= 90;
        },
        previewKey() {
            return JSON.stringify([this.draft.panoramaId, this.parsedHeading, this.parsedPitch]);
        },
        validSeed() {
            const title = this.draft.title;
            return validTarget(this.draft) && validId(this.draft.hostUid) && title.length >= 1 && title.length <= 120 &&
                title.trim() === title && !placeholder(title) && this.previewConfigurationValid &&
                Number.isFinite(this.parsedAnswerLat) && this.parsedAnswerLat >= -90 && this.parsedAnswerLat <= 90 &&
                Number.isFinite(this.parsedAnswerLng) && this.parsedAnswerLng >= -180 && this.parsedAnswerLng <= 180 &&
                Number.isFinite(this.parsedDifficulty) && this.parsedDifficulty > 0;
        },
        previewChoiceCurrent() {
            return this.previewChoice && this.previewChoice.revision === this.previewRevision &&
                this.previewChoice.panoramaId === this.draft.panoramaId && this.previewChoice.heading === this.parsedHeading &&
                this.previewChoice.pitch === this.parsedPitch;
        },
        canExport() { return this.validSeed && Boolean(this.previewChoiceCurrent); },
        seed() {
            if (!this.canExport) return null;
            return {
                projectId: this.draft.projectId,
                databaseUrl: new URL(this.draft.databaseUrl).origin,
                eventId: this.draft.eventId,
                event: {
                    hostUid: this.draft.hostUid,
                    public: { title: this.draft.title, phase: 'lobby' },
                    private: {
                        round: {
                            id: 'r1', panoramaId: this.draft.panoramaId, heading: this.parsedHeading,
                            pitch: this.parsedPitch,
                            answer: { lat: this.parsedAnswerLat, lng: this.parsedAnswerLng },
                            difficulty: this.parsedDifficulty,
                        },
                    },
                },
            };
        },
        seedJson() { return this.seed ? JSON.stringify(this.seed, null, 2) : ''; },
    },
    watch: {
        draft: {
            deep: true,
            handler() {
                this.previewRevision += 1;
                this.previewChoice = null;
                this.message = '';
            },
        },
    },
    beforeDestroy() {
        this.revokeDownloadUrl();
    },
    methods: {
        recordPreviewChoice(choice) {
            if (!choice || typeof choice !== 'object' || !this.previewConfigurationValid || choice.panoramaId !== this.draft.panoramaId ||
                choice.heading !== this.parsedHeading || choice.pitch !== this.parsedPitch) return;
            this.previewChoice = { ...choice, revision: this.previewRevision };
            this.message = '';
        },
        async copySeed() {
            if (!this.canExport || !navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
                this.message = 'Copy is unavailable in this browser. You can download the JSON file instead.';
                return;
            }
            const revision = this.previewRevision;
            const json = this.seedJson;
            try {
                await navigator.clipboard.writeText(json);
                if (this._isBeingDestroyed || this._isDestroyed || revision !== this.previewRevision || !this.canExport) return;
                this.message = 'Seed JSON copied.';
            } catch (error) {
                if (this._isBeingDestroyed || this._isDestroyed || revision !== this.previewRevision || !this.canExport) return;
                this.message = 'Copy failed. You can download the JSON file instead.';
            }
        },
        downloadSeed() {
            if (!this.canExport) return;
            this.revokeDownloadUrl();
            const blob = new Blob([`${this.seedJson}\n`], { type: 'application/json' });
            this.downloadUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = this.downloadUrl;
            link.download = `${this.draft.eventId}-seed.json`;
            link.click();
            this.message = 'Seed JSON downloaded.';
        },
        revokeDownloadUrl() {
            if (this.downloadUrl) {
                URL.revokeObjectURL(this.downloadUrl);
                this.downloadUrl = null;
            }
        },
    },
};
</script>

<style scoped>
.event-setup { max-width: 54rem; margin: 0 auto; padding: 1rem; }
.event-setup__form fieldset { display: grid; gap: 0.5rem; margin: 1rem 0; padding: 1rem; }
.event-setup input { box-sizing: border-box; width: 100%; min-height: 2.75rem; padding: 0.5rem; font: inherit; }
.event-setup__preview, .event-setup__export { margin-top: 2rem; }
.event-setup button { min-height: 3rem; margin: 0.5rem 0.5rem 0.5rem 0; padding: 0.5rem 1rem; font: inherit; }
.event-setup button:disabled { cursor: not-allowed; opacity: 0.6; }
.event-setup pre { overflow: auto; padding: 1rem; background: #f2f4f5; white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
