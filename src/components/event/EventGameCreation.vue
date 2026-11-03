<template>
    <section class="event-game-creation" aria-label="Create a new game with these rounds">
        <h2>New game with these rounds</h2>
        <p>Keep this game available and create a fresh lobby from its configured rounds.</p>
        <button v-if="!pending" type="button" :disabled="busy || !hostUid" @click="begin">
            {{ result ? 'Create another new game with these rounds' : 'Create new game with these rounds' }}
        </button>
        <button v-else-if="pending && !result" type="button" :disabled="busy || !hostUid" @click="checkAgain">
            {{ busy ? 'Checking creation…' : 'Check creation again' }}
        </button>
        <p v-if="pending && !busy && !error" role="status">A creation attempt is saved for this host and game. Check its status to reuse the same attempt.</p>
        <p v-if="busy" role="status" aria-live="polite">{{ waitingMessage }}</p>
        <p v-if="error" role="alert" class="event-game-creation__error">{{ error }}</p>
        <div v-if="result" class="event-game-creation__result" role="status">
            <p>{{ result.status === 'created' ? 'New game created.' : 'This creation attempt already has a new game.' }}</p>
            <a class="event-game-creation__open" :href="result.links.host">Open new host page</a>
            <ul aria-label="New game links">
                <li><a :href="result.links.host">Host page</a></li>
                <li><a :href="result.links.join">Guest join page</a></li>
                <li><a :href="result.links.presenter">Presenter page</a></li>
            </ul>
        </div>
    </section>
</template>

<script>
import {
    absoluteCreationLinks, clearPendingCreation, createGameFromHost, GameCreationError,
    newRequestId, readPendingCreation, writePendingCreation,
} from '@/event/game-creation';

export default {
    name: 'EventGameCreation',
    props: {
        sourceEventId: { type: String, required: true },
        hostUid: { type: String, default: '' },
        hostClient: { type: Object, required: true },
        createRequest: { type: Function, default: createGameFromHost },
    },
    data: () => ({ pending: null, result: null, busy: false, error: '', generation: 0, destroyed: false }),
    computed: { waitingMessage() { return 'Waiting for the creation service. If the reply is delayed, check creation again to reuse this attempt.'; } },
    watch: {
        sourceEventId() { this.resetForIdentityChange(); },
        hostUid() { this.resetForIdentityChange(); },
        hostClient() { this.resetForIdentityChange(); },
    },
    mounted() { this.loadPending(); },
    beforeDestroy() { this.destroyed = true; this.generation += 1; },
    methods: {
        current(generation, uid, source, client) {
            return !this.destroyed && this.generation === generation && this.hostUid === uid &&
                this.sourceEventId === source && this.hostClient === client;
        },
        resetForIdentityChange() {
            this.generation += 1;
            this.pending = null;
            this.result = null;
            this.busy = false;
            this.error = '';
            this.loadPending();
        },
        loadPending() {
            try { this.pending = this.hostUid ? readPendingCreation(window.sessionStorage, this.hostUid, this.sourceEventId) : null; }
            catch (error) { this.pending = null; }
        },
        async begin() {
            if (this.busy || this.pending || !this.hostUid) return;
            let attempt;
            try {
                attempt = { hostUid: this.hostUid, sourceEventId: this.sourceEventId, requestId: newRequestId() };
                writePendingCreation(window.sessionStorage, attempt);
            } catch (error) {
                this.error = error instanceof GameCreationError ? error.message :
                    'This browser could not save a safe retry key. Enable session storage and try again.';
                return;
            }
            this.pending = attempt;
            this.result = null;
            this.error = '';
            await this.send(attempt);
        },
        async checkAgain() {
            if (!this.busy && this.pending && this.hostUid === this.pending.hostUid && this.sourceEventId === this.pending.sourceEventId) {
                await this.send(this.pending);
            }
        },
        async send(attempt) {
            if (this.busy || !attempt || attempt.hostUid !== this.hostUid || attempt.sourceEventId !== this.sourceEventId) return;
            const generation = this.generation, uid = this.hostUid, source = this.sourceEventId, client = this.hostClient;
            this.busy = true;
            this.error = '';
            try {
                const token = await client.getIdToken(uid);
                if (!this.current(generation, uid, source, client)) return;
                const value = await this.createRequest({ sourceEventId: source, requestId: attempt.requestId, token });
                if (!this.current(generation, uid, source, client) || this.pending !== attempt) return;
                this.result = { status: value.status, eventId: value.eventId, links: absoluteCreationLinks(value.links) };
                try { clearPendingCreation(window.sessionStorage, attempt); } catch (error) { /* storage may become unavailable after confirmation */ }
                this.pending = null;
            } catch (error) {
                if (!this.current(generation, uid, source, client)) return;
                if (error instanceof GameCreationError) this.error = error.message;
                else if (error && error.code === 'host-identity-changed') this.error = 'The host account changed. Sign in again, then check creation again to reuse this attempt.';
                else this.error = 'We could not confirm creation. Check creation again to reuse this attempt.';
            } finally {
                if (this.current(generation, uid, source, client)) this.busy = false;
            }
        },
    },
};
</script>

<style scoped>
.event-game-creation { margin-top: 2rem; padding: 1rem; border: 2px solid #52677a; border-radius: 0.4rem; }
.event-game-creation button, .event-game-creation__open { display: inline-block; box-sizing: border-box; min-height: 3rem; padding: 0.65rem 1rem; font: inherit; }
.event-game-creation a { overflow-wrap: anywhere; }
.event-game-creation__error { color: #8b1e1e; }
</style>
