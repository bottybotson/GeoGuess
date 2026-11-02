<template>
    <EventLegacyHost v-if="version === 1" :event-id="eventId" :host-client="hostClient" />
    <EventSessionHost v-else-if="version === 2" :event-id="eventId" :host-client="hostClient" />
    <main v-else class="event-host-dispatch">
        <h1>Host the birthday game</h1>
        <p role="status">{{ error || 'Checking event format…' }}</p>
        <button v-if="error" type="button" @click="detect">Reconnect</button>
    </main>
</template>

<script>
import EventLegacyHost from './EventLegacyHost.vue';
import EventSessionHost from './EventSessionHost.vue';

export default {
    name: 'EventHost',
    inheritAttrs: false,
    components: { EventLegacyHost, EventSessionHost },
    props: { eventId: { type: String, required: true }, hostClient: { type: Object, required: true } },
    data: () => ({ version: null, error: '', epoch: 0 }),
    watch: { eventId() { this.detect(); }, hostClient() { this.detect(); } },
    mounted() { this.detect(); },
    beforeDestroy() { this.epoch += 1; },
    methods: {
        async detect() {
            const epoch = ++this.epoch;
            const client = this.hostClient;
            const eventId = this.eventId;
            this.version = null;
            this.error = '';
            try {
                const version = await client.getFormatVersion(eventId);
                if (epoch !== this.epoch || client !== this.hostClient || eventId !== this.eventId) return;
                if (version !== 1 && version !== 2) throw new Error('unsupported-format');
                this.version = version;
            } catch (error) {
                if (epoch === this.epoch) this.error = 'Event format is unavailable. Reconnect to try again.';
            }
        },
    },
};
</script>

<style scoped>
.event-host-dispatch { box-sizing: border-box; min-height: 100vh; background: #fff; padding: 2rem; font: 1.2rem/1.5 Arial, sans-serif; color: #17212b; }
button { min-height: 3rem; padding: 0.5rem 1rem; font: inherit; }
</style>
