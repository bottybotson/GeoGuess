<template>
    <main class="event-guest-lobby" :class="{ 'event-guest-lobby--playing': joinState === 'joined' && ['guessing', 'closed', 'reveal'].includes(phase) }">
        <header class="event-guest-lobby__header">
            <h1>{{ title }}</h1>
            <p class="event-guest-lobby__phase">{{ phaseMessage }}</p>
            <p class="event-guest-lobby__count">{{ guestCount }} guests in the lobby</p>
        </header>

        <EventGuestSession
            v-if="joinState === 'joined' && sessionClient && sessionState"
            :event-id="eventId" :state="sessionState" :session-client="sessionClient" :maps-loader="mapsLoader"
        />
        <EventGuestRound
            v-else-if="joinState === 'joined' && formatVersion === 1 && roundClient && ['guessing', 'closed', 'reveal'].includes(phase)"
            :event-id="eventId" :phase="phase" :round-client="roundClient" :maps-loader="mapsLoader"
        />
        <EventJoinForm v-else :state="joinState" @join="join" />

        <p v-if="connectionError" class="event-guest-lobby__connection" role="status" aria-live="polite">
            We couldn’t connect to the lobby. Check your connection and retry.
        </p>
        <button
            v-if="connectionError || joinState === 'error'"
            class="event-guest-lobby__retry"
            type="button"
            :disabled="retrying"
            @click="retry"
        >
            {{ retrying ? 'Reconnecting…' : 'Retry connection' }}
        </button>
    </main>
</template>

<script>
import EventJoinForm from '@/components/event/EventJoinForm.vue';
import EventGuestRound from './EventGuestRound.vue';
import EventGuestSession from './EventGuestSession.vue';
import { validSessionState } from '@/event/version';

const PHASES = {
    lobby: 'The lobby is open. The host will start the game.',
    ready: 'The next round is ready. Wait for the host to start.',
    guessing: 'The game is in progress.',
    closed: 'Guessing is closed. The host will reveal the results.',
    reveal: 'The host is revealing the round.',
    complete: 'The event is complete.',
};

export default {
    name: 'EventGuestLobby',
    inheritAttrs: false,
    components: { EventJoinForm, EventGuestRound, EventGuestSession },
    props: {
        eventId: { type: String, required: true },
        lobbyClient: { type: Object, required: true },
        roundClient: { type: Object, default: null },
        sessionClient: { type: Object, default: null },
        mapsLoader: { type: Function, default: null },
    },
    data() {
        return {
            title: 'Birthday GeoGuess',
            phase: 'unavailable',
            formatVersion: null,
            sessionState: null,
            guestCount: 0,
            joinState: 'joining',
            connectionError: false,
            retrying: false,
            epoch: 0,
            unsubscribe: null,
            connectPending: false,
            destroyed: false,
        };
    },
    computed: {
        phaseMessage() {
            return Object.prototype.hasOwnProperty.call(PHASES, this.phase)
                ? PHASES[this.phase]
                : 'Event status is unavailable.';
        },
    },
    watch: {
        eventId() { this.scheduleConnect(); },
        lobbyClient() { this.scheduleConnect(); },
    },
    mounted() { this.connect(); },
    beforeDestroy() {
        this.destroyed = true;
        this.connectPending = false;
        this.dispose();
    },
    methods: {
        dispose() {
            this.epoch += 1;
            if (this.unsubscribe) {
                const disposeSubscription = this.unsubscribe;
                this.unsubscribe = null;
                disposeSubscription();
            }
        },
        scheduleConnect() {
            // Invalidate callbacks and release the old listener at the prop
            // change boundary, before the coalesced reconnect runs.
            this.dispose();
            this.sessionState = null;
            this.formatVersion = null;
            this.phase = 'unavailable';
            if (this.connectPending || this.destroyed) return;
            this.connectPending = true;
            this.$nextTick(() => {
                if (this.destroyed) return;
                this.connectPending = false;
                this.connect();
            });
        },
        connect(isRetry = false) {
            this.dispose();
            const epoch = this.epoch;
            const client = this.lobbyClient;
            const eventId = this.eventId;
            let disposeSubscription = null;
            let subscriptionFailed = false;
            this.title = 'Birthday GeoGuess';
            this.phase = 'unavailable';
            this.formatVersion = null;
            this.sessionState = null;
            this.guestCount = 0;
            this.joinState = 'joining';
            this.connectionError = false;
            this.retrying = isRetry;

            const current = () => epoch === this.epoch && client === this.lobbyClient && eventId === this.eventId;
            const failed = () => {
                if (!current()) return;
                subscriptionFailed = true;
                this.connectionError = true;
                this.sessionState = null;
                this.phase = 'unavailable';
                this.joinState = 'error';
                this.retrying = false;
                // Invalidate the in-flight read-only probe and any callbacks
                // that captured this connection generation.
                this.epoch += 1;
                if (disposeSubscription) {
                    disposeSubscription();
                    if (this.unsubscribe === disposeSubscription) this.unsubscribe = null;
                }
            };
            try {
                const unsubscribe = client.subscribe(eventId, projection => {
                    if (!current() || this.connectionError) return;
                    const safeProjection = projection && typeof projection === 'object' ? projection : {};
                    if (safeProjection.formatVersion === 2) {
                        const { phase, roundId, revision, roundCount, lastRevealedRoundId } = safeProjection;
                        const state = { phase, roundId, revision,
                            ...(lastRevealedRoundId === undefined ? {} : { lastRevealedRoundId }) };
                        this.formatVersion = 2;
                        if (!validSessionState(state, roundCount) || !Array.isArray(safeProjection.participants) ||
                            safeProjection.participants.length > 50 || safeProjection.participants.some(participant =>
                                !participant || typeof participant.id !== 'string' || typeof participant.nickname !== 'string')) {
                            this.sessionState = null;
                            this.phase = 'unavailable';
                            this.guestCount = 0;
                            return;
                        }
                        if (this.sessionState && revision < this.sessionState.revision) return;
                        this.sessionState = { ...state, roundCount };
                        this.title = typeof safeProjection.title === 'string' ? safeProjection.title : 'Birthday GeoGuess';
                        this.phase = phase;
                        this.guestCount = safeProjection.participants.length;
                        return;
                    }
                    this.sessionState = null;
                    this.formatVersion = safeProjection.formatVersion === undefined || safeProjection.formatVersion === 1 ? 1 : null;
                    const publicTitle = typeof safeProjection.title === 'string'
                        ? safeProjection.title : 'Birthday GeoGuess';
                    const publicPhase = this.formatVersion === 1 && safeProjection.phase !== 'ready' && Object.prototype.hasOwnProperty.call(PHASES, safeProjection.phase)
                        ? safeProjection.phase : 'unavailable';
                    const participants = Array.isArray(safeProjection.participants)
                        ? safeProjection.participants : [];
                    this.title = publicTitle;
                    this.phase = publicPhase;
                    this.guestCount = Math.min(50, participants.length);
                }, failed);
                disposeSubscription = typeof unsubscribe === 'function' ? unsubscribe : null;
                if (subscriptionFailed) {
                    if (disposeSubscription) disposeSubscription();
                    return;
                }
                this.unsubscribe = disposeSubscription;
            } catch (error) {
                failed();
                return;
            }
            this.probe(epoch, client, eventId, isRetry);
        },
        async probe(epoch, client, eventId, isRetry) {
            try {
                const result = await client.join(eventId, undefined);
                if (epoch !== this.epoch || client !== this.lobbyClient || eventId !== this.eventId || this.connectionError) return;
                this.retrying = false;
                switch (result && result.status) {
                    case 'rejoined':
                    case 'joined':
                        this.joinState = 'joined';
                        break;
                    case 'invalid-nickname':
                        this.joinState = 'idle';
                        break;
                    case 'started':
                        this.joinState = 'started';
                        break;
                    case 'full':
                        this.joinState = 'full';
                        break;
                    default:
                        this.joinState = 'error';
                }
            } catch (error) {
                if (epoch !== this.epoch || client !== this.lobbyClient || eventId !== this.eventId) return;
                this.retrying = false;
                if (error && error.code === 'invalid-nickname' && !this.connectionError) {
                    this.joinState = 'idle';
                    return;
                }
                this.joinState = 'error';
                if (isRetry) this.connectionError = true;
            }
        },
        async join(payload) {
            if (this.connectionError || (this.joinState !== 'idle' && this.joinState !== 'error')) return;
            const epoch = this.epoch;
            const client = this.lobbyClient;
            const eventId = this.eventId;
            this.joinState = 'joining';
            this.connectionError = false;
            try {
                const result = await client.join(eventId, payload.nickname);
                if (epoch !== this.epoch || client !== this.lobbyClient || eventId !== this.eventId || this.connectionError) return;
                this.joinState = result && ['joined', 'rejoined', 'full', 'started'].includes(result.status)
                    ? (result.status === 'rejoined' ? 'joined' : result.status)
                    : 'error';
            } catch (error) {
                if (epoch !== this.epoch || client !== this.lobbyClient || eventId !== this.eventId) return;
                this.joinState = 'error';
            }
        },
        retry() {
            if (this.retrying) return;
            this.connect(true);
        },
    },
};
</script>

<style scoped>
.event-guest-lobby {
    min-height: 100vh;
    padding: 1rem;
    color: #10263d;
    font-family: Arial, sans-serif;
}
.event-guest-lobby__header {
    max-width: 34rem;
    margin: 0 auto;
    padding: 1rem clamp(1rem, 5vw, 2rem) 0;
}
.event-guest-lobby__header h1 { font-size: clamp(1.75rem, 7vw, 2.25rem); overflow-wrap: anywhere; }
.event-guest-lobby__phase, .event-guest-lobby__count { font-size: 1.125rem; }
.event-guest-lobby__connection, .event-guest-lobby__retry { display: block; max-width: 34rem; margin: 1rem auto; }
.event-guest-lobby__retry { min-height: 48px; padding: 0.5rem 1rem; font: inherit; }
@media (max-width: 800px), (max-width: 1000px) and (max-height: 500px) {
    .event-guest-lobby { padding: 0.5rem; min-height: 100dvh; box-sizing: border-box; }
    .event-guest-lobby--playing .event-guest-lobby__header { max-width: 72rem; padding: 0; }
    .event-guest-lobby--playing .event-guest-lobby__header h1 { margin: 0; font-size: 1.125rem; line-height: 1.3; }
    .event-guest-lobby--playing .event-guest-lobby__phase,
    .event-guest-lobby--playing .event-guest-lobby__count { display: none; }
}
</style>
