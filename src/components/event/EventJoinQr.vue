<template>
    <figure v-if="joinUrl" class="event-join-qr" aria-label="Scan this QR code to join the game">
        <img v-if="imageUrl" class="event-join-qr__image" :src="imageUrl" alt="QR code for the public guest join page">
        <p v-else-if="error" class="event-join-qr__fallback" role="status">
            QR code unavailable. Use the join link shown on this screen.
        </p>
        <figcaption>Scan to join the game</figcaption>
    </figure>
</template>

<script>
import qrcode from 'qrcode-generator';

export function sanitizeJoinUrl(value, eventId) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(eventId || '')) return '';
    try {
        const parsed = new URL(value);
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password ||
            parsed.pathname.replace(/\/$/, '') !== `/event/${eventId}/join`) return '';
        parsed.search = '';
        parsed.hash = '';
        return parsed.href;
    } catch {
        return '';
    }
}

export default {
    name: 'EventJoinQr',
    props: {
        eventId: { type: String, required: true },
        joinUrl: { type: String, default: '' },
    },
    data() {
        return { imageUrl: '', error: false, generation: 0 };
    },
    computed: {
        safeJoinUrl() {
            return sanitizeJoinUrl(this.joinUrl, this.eventId);
        },
    },
    watch: {
        safeJoinUrl: { immediate: true, handler() { this.renderQr(); } },
    },
    beforeDestroy() {
        this.generation += 1;
    },
    methods: {
        renderQr() {
            const generation = ++this.generation;
            const value = this.safeJoinUrl;
            this.imageUrl = '';
            this.error = false;
            if (!value) return;
            try {
                const code = qrcode(0, 'M');
                code.addData(value);
                code.make();
                const imageUrl = code.createDataURL(8, 32);
                if (generation === this.generation && !this._isDestroyed && !this._isBeingDestroyed) {
                    this.imageUrl = imageUrl;
                }
            } catch {
                if (generation === this.generation && !this._isDestroyed && !this._isBeingDestroyed) {
                    this.error = true;
                }
            }
        },
    },
};
</script>

<style scoped>
.event-join-qr {
    width: min(32vw, 20rem);
    min-width: 12rem;
    margin: 1.5rem auto 0;
    padding: 0.75rem;
    border-radius: 0.5rem;
    background: #fff;
    color: #10263d;
    text-align: center;
    font-weight: 700;
}

.event-join-qr__image {
    display: block;
    width: 100%;
    height: auto;
    image-rendering: pixelated;
}

.event-join-qr figcaption { padding-top: 0.5rem; }
.event-join-qr__fallback { margin: 0.5rem; }
</style>
