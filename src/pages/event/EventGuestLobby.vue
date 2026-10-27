<template>
    <main class="event-guest-lobby">
        <header class="event-guest-lobby__header">
            <h1>{{ title }}</h1>
            <p class="event-guest-lobby__phase">{{ phaseMessage }}</p>
            <p class="event-guest-lobby__count">{{ guestCount }} guests in the lobby</p>
        </header>

        <EventJoinForm :state="joinState" @join="join" />

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

const PHASES = {
    lobby: 'The lobby is open. The host will start the game.',
    guessing: 'The game is in progress.',
    reveal: 'The host is revealing the round.',
    complete: 'The event is complete.',
};

export default {
    name: 'EventGuestLobby',
    inheritAttrs: false,
    components: { EventJoinForm },
    props: {
        eventId: { type: String, required: true },
        lobbyClient: { type: Object, required: true },
    },
    data() {
        return {
            title: 'Birthday GeoGuess',
            phase: 'unavailable',
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
            this.guestCount = 0;
            this.joinState = 'joining';
            this.connectionError = false;
            this.retrying = isRetry;

            const current = () => epoch === this.epoch && client === this.lobbyClient && eventId === this.eventId;
            const failed = () => {
                if (!current()) return;
                subscriptionFailed = true;
                this.connectionError = true;
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
                    const publicTitle = typeof safeProjection.title === 'string'
                        ? safeProjection.title : 'Birthday GeoGuess';
                    const publicPhase = Object.prototype.hasOwnProperty.call(PHASES, safeProjection.phase)
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
</style>
