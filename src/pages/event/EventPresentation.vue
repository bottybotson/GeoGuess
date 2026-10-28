<template>
    <div class="event-presentation-page" aria-live="polite">
        <section v-if="status === 'loading'" class="event-presentation-page__message" role="status">
            <h1>Connecting to the presentation</h1>
            <p>Loading the public event view…</p>
        </section>

        <section v-else-if="status === 'error'" class="event-presentation-page__message" role="status">
            <h1>Presentation connection lost</h1>
            <p>{{ errorMessage }}</p>
            <button type="button" class="event-presentation-page__retry" style="min-height: 48px" @click="retry">
                Reconnect
            </button>
        </section>

        <section v-else-if="status === 'unavailable'" class="event-presentation-page__message" role="status">
            <h1>Presentation unavailable</h1>
            <p>The public event details are unavailable right now.</p>
            <button type="button" class="event-presentation-page__retry" style="min-height: 48px" @click="retry">
                Reconnect
            </button>
        </section>

        <section v-else-if="roundClient && projection.phase === 'reveal'" class="event-presentation-page__results">
            <EventRoundResults v-if="publicReveal" :reveal="publicReveal" />
            <p v-else role="status">{{ revealError ? 'Results could not be loaded.' : 'Loading results…' }}</p>
            <button v-if="revealError" type="button" class="event-presentation-page__retry" @click="retry">Reconnect</button>
        </section>
        <EventLobbyPresentation
            v-else
            :title="projection.title"
            :phase="projection.phase"
            :participants="projection.participants"
            :join-url="joinUrl"
        />
    </div>
</template>

<script>
import EventLobbyPresentation from '@/components/event/EventLobbyPresentation.vue';
import EventRoundResults from '@/components/event/EventRoundResults.vue';

const PHASES = new Set(['lobby', 'guessing', 'closed', 'reveal', 'complete']);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function safeProjection(value) {
    if (!isRecord(value) || typeof value.title !== 'string' || !PHASES.has(value.phase) ||
        !Array.isArray(value.participants)) return null;

    const participants = [];
    for (const participant of value.participants) {
        if (!isRecord(participant) || typeof participant.id !== 'string' ||
            typeof participant.nickname !== 'string') return null;
        participants.push({ id: participant.id, nickname: participant.nickname });
    }
    return { title: value.title, phase: value.phase, participants };
}

export default {
    name: 'EventPresentation',
    inheritAttrs: false,
    components: { EventLobbyPresentation, EventRoundResults },
    props: {
        eventId: { type: String, required: true },
        lobbyClient: { type: Object, required: true },
        joinUrl: { type: String, default: '' },
        roundClient: { type: Object, default: null },
    },
    data() {
        return {
            status: 'loading',
            errorMessage: 'Check the connection and reconnect when ready.',
            projection: null,
            epoch: 0,
            disposer: null,
            connectScheduled: false,
            publicReveal: null,
            revealError: false,
            revealLoading: false,
        };
    },
    watch: {
        eventId() { this.scheduleConnect(); },
        lobbyClient() { this.scheduleConnect(); },
        roundClient() { this.scheduleConnect(); },
    },
    mounted() {
        this.connect();
    },
    beforeDestroy() {
        this.epoch += 1;
        this.stopSubscription();
    },
    methods: {
        scheduleConnect() {
            if (this.connectScheduled) return;
            this.connectScheduled = true;
            this.$nextTick(() => {
                this.connectScheduled = false;
                if (this._isDestroyed || this._isBeingDestroyed) return;
                this.connect();
            });
        },
        stopSubscription() {
            const dispose = this.disposer;
            this.disposer = null;
            if (dispose) dispose();
        },
        connect() {
            const client = this.lobbyClient;
            const eventId = this.eventId;
            const epoch = this.epoch + 1;
            this.epoch = epoch;
            this.stopSubscription();
            this.status = 'loading';
            this.projection = null;
            this.publicReveal = null;
            this.revealError = false;
            this.revealLoading = false;

            let cancelled = false;
            let returnedDisposer = null;
            let disposed = false;
            const disposeOnce = () => {
                if (disposed || typeof returnedDisposer !== 'function') return;
                disposed = true;
                returnedDisposer();
            };
            const cancel = () => {
                cancelled = true;
                disposeOnce();
            };
            const current = () => !cancelled && this.epoch === epoch &&
                this.lobbyClient === client && this.eventId === eventId;
            const onChange = value => {
                if (!current()) return;
                const safe = safeProjection(value);
                if (!safe) {
                    this.status = 'unavailable';
                    this.projection = null;
                    return;
                }
                this.projection = safe;
                this.status = 'ready';
                if (safe.phase === 'reveal' && this.roundClient) this.loadReveal(epoch);
            };
            const onError = () => {
                if (!current()) return;
                cancelled = true;
                this.status = 'error';
                this.projection = null;
                disposeOnce();
                if (this.disposer === cancel) this.disposer = null;
            };

            this.disposer = cancel;
            try {
                returnedDisposer = client.subscribe(eventId, onChange, onError);
                if (cancelled) disposeOnce();
            } catch {
                if (current()) {
                    cancelled = true;
                    this.status = 'error';
                    this.projection = null;
                    disposeOnce();
                    if (this.disposer === cancel) this.disposer = null;
                }
            }
        },
        retry() {
            this.connect();
        },
        async loadReveal(epoch) {
            if (this.publicReveal || this.revealLoading) return;
            const client = this.roundClient;
            this.revealLoading = true;
            try {
                const value = await client.getReveal(this.eventId);
                if (epoch !== this.epoch || client !== this.roundClient || this.status !== 'ready' || this.projection.phase !== 'reveal') return;
                if (!value) throw new Error('Reveal unavailable');
                this.publicReveal = value;
            } catch {
                if (epoch === this.epoch && client === this.roundClient && this.status === 'ready') this.revealError = true;
            } finally {
                if (epoch === this.epoch && client === this.roundClient) this.revealLoading = false;
            }
        },
    },
};
</script>

<style scoped>
.event-presentation-page {
    min-height: 100vh;
    background: #10263d;
    color: #fff;
    font-family: Arial, sans-serif;
}
.event-presentation-page__results { min-height: 100vh; padding: clamp(1rem, 4vw, 3rem); background: #fff; color: #17212b; }
.event-presentation-page__results .event-round-results { font-size: clamp(1.25rem, 2.4vw, 2rem); }

.event-presentation-page__message {
    box-sizing: border-box;
    max-width: 70rem;
    min-height: 100vh;
    margin: 0 auto;
    padding: clamp(1.5rem, 5vw, 4rem);
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: flex-start;
    font-size: clamp(1.25rem, 2.4vw, 2rem);
    line-height: 1.4;
}

.event-presentation-page__message h1 {
    margin: 0 0 1rem;
    font-size: clamp(2rem, 5vw, 4rem);
}

.event-presentation-page__retry {
    min-width: 9rem;
    min-height: 3rem;
    margin-top: 1rem;
    padding: 0.5rem 1.25rem;
    border: 2px solid #fff;
    border-radius: 0.35rem;
    background: #fff;
    color: #10263d;
    font: inherit;
    font-weight: 700;
    cursor: pointer;
}

.event-presentation-page__retry:focus-visible {
    outline: 4px solid #ffd166;
    outline-offset: 3px;
}
</style>
