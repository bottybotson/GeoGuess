<template>
    <main class="event-host">
        <h1>Host the birthday game</h1>

        <form v-if="!authenticated" class="event-host__sign-in" @submit.prevent="signIn">
            <label for="event-host-email">Host email</label>
            <input id="event-host-email" v-model="email" type="email" autocomplete="username" required>
            <label for="event-host-password">Password</label>
            <input id="event-host-password" v-model="password" type="password" autocomplete="current-password" required>
            <button type="submit" :disabled="busy || !readyToSignIn">{{ busy ? 'Please wait…' : 'Sign in' }}</button>
        </form>

        <p v-if="message" class="event-host__message" role="status" aria-live="polite">{{ message }}</p>
        <p v-if="error" class="event-host__error" role="alert">{{ error }}</p>
        <button v-if="(error || timingError) && authenticated" type="button" :disabled="busy" @click="restore">Reconnect</button>

        <section v-if="authenticated && authorized" class="event-host__session" aria-label="Host controls">
            <button type="button" :disabled="busy" @click="signOut">Sign out</button>
            <template v-if="authorized">
                <section v-if="phase === 'guessing'" class="event-host__timing" aria-label="Round timing">
                    <EventRoundTimer :timing="timing" :now-ms="nowMs" :connected="timingConnected" />
                    <EventTimingControls
                        :timing="timing" :now-ms="nowMs" :connected="timingConnected"
                        :busy="busy" :error="timingError" :retry-available="pendingDeadlineMs !== null"
                        @request-duration="requestDuration" @retry="retryTiming"
                    />
                </section>
                <h2>{{ title }}</h2>
                <p>{{ phaseMessage }}</p>
                <p>{{ guestCount }} {{ guestCount === 1 ? 'guest' : 'guests' }} in the lobby</p>
                <ul v-if="participants.length" aria-label="Guests">
                    <li v-for="participant in participants" :key="participant.id">{{ participant.nickname }}</li>
                </ul>

                <button v-if="phase === 'lobby'" type="button" :disabled="busy || guestCount < 1" @click="runCommand('start')">
                    Start game
                </button>
                <button v-if="phase === 'guessing'" type="button" :disabled="busy" @click="runCommand('close')">
                    Close guessing
                </button>
                <button v-if="phase === 'closed'" type="button" :disabled="busy" @click="runCommand('reveal')">
                    Reveal results
                </button>
                <EventRoundResults v-if="phase === 'reveal' && reveal" :reveal="reveal" />
            </template>
        </section>
    </main>
</template>

<script>
import EventRoundResults from '@/components/event/EventRoundResults.vue';
import EventRoundTimer from '@/components/event/EventRoundTimer.vue';
import EventTimingControls from '@/components/event/EventTimingControls.vue';
import timingView from '@/event/timing-view';
import { deadlineAfter, validTiming } from '@/event/timing';

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
    name: 'EventHost',
    inheritAttrs: false,
    mixins: [timingView],
    components: { EventRoundResults, EventRoundTimer, EventTimingControls },
    props: {
        eventId: { type: String, required: true },
        hostClient: { type: Object, required: true },
    },
    data() {
        return {
            email: '',
            password: '',
            authenticated: false,
            authorized: false,
            title: 'Birthday GeoGuess',
            phase: 'unavailable',
            participants: [],
            privateSetup: null,
            reveal: null,
            error: '',
            message: 'Checking for a saved host session…',
            busy: false,
            epoch: 0,
            disposer: null,
            connectScheduled: false,
            destroyed: false,
            pendingDeadlineMs: null,
            timingError: '',
        };
    },
    computed: {
        guestCount() { return this.participants.length; },
        readyToSignIn() { return this.email.trim().length > 0 && this.password.length > 0; },
        phaseMessage() {
            return {
                lobby: 'The lobby is open.',
                guessing: 'Guests are guessing.',
                closed: 'Guessing is closed. You can reveal the results.',
                reveal: 'The results are revealed.',
                complete: 'The event is complete.',
            }[this.phase] || 'Event status is unavailable.';
        },
    },
    watch: {
        eventId() { this.scheduleReconnect(); },
        hostClient() { this.scheduleReconnect(); },
        phase(value) {
            if (value !== 'guessing') {
                this.pendingDeadlineMs = null;
                this.timingError = '';
                this.observeTiming(this.hostClient, this.eventId, false);
            } else if (this.authorized) this.observeTiming(this.hostClient, this.eventId);
        },
    },
    mounted() { this.restore(); },
    beforeDestroy() {
        this.destroyed = true;
        this.pendingDeadlineMs = null;
        this.invalidateSession();
    },
    methods: {
        isCurrent(epoch, client, eventId) {
            return !this.destroyed && this.epoch === epoch && this.hostClient === client && this.eventId === eventId;
        },
        clearPrivateState() {
            this.authenticated = false;
            this.authorized = false;
            this.privateSetup = null;
            this.reveal = null;
            this.participants = [];
            this.title = 'Birthday GeoGuess';
            this.phase = 'unavailable';
            this.pendingDeadlineMs = null;
            this.timingError = '';
        },
        stopSubscription() {
            const dispose = this.disposer;
            this.disposer = null;
            if (dispose) {
                try { dispose(); } catch (error) { /* cleanup is best effort */ }
            }
        },
        invalidateSession() {
            this.epoch += 1;
            this.stopSubscription();
            this.observeTiming(this.hostClient, this.eventId, false);
            this.pendingDeadlineMs = null;
            this.timingError = '';
            this.clearPrivateState();
            this.busy = false;
        },
        scheduleReconnect() {
            this.pendingDeadlineMs = null;
            this.timingError = '';
            this.invalidateSession();
            this.password = '';
            this.error = '';
            this.message = 'Checking for a saved host session…';
            if (this.connectScheduled) return;
            this.connectScheduled = true;
            this.$nextTick(() => {
                this.connectScheduled = false;
                if (!this.destroyed) this.restore();
            });
        },
        async restore() {
            this.invalidateSession();
            const epoch = this.epoch;
            const client = this.hostClient;
            const eventId = this.eventId;
            this.busy = true;
            this.error = '';
            this.message = 'Checking for a saved host session…';
            try {
                const user = await client.restore();
                if (!this.isCurrent(epoch, client, eventId)) return;
                if (!user) {
                    this.message = 'Sign in with the host account to manage this event.';
                    return;
                }
                this.authenticated = true;
                await this.authorizeAndSubscribe(epoch, client, eventId);
            } catch (error) {
                if (this.isCurrent(epoch, client, eventId)) {
                    this.clearPrivateState();
                    this.error = 'We couldn’t restore the host session. Sign in to continue.';
                    this.message = '';
                }
            } finally {
                if (this.isCurrent(epoch, client, eventId)) this.busy = false;
            }
        },
        async authorizeAndSubscribe(epoch, client, eventId) {
            // This server read is the authorization check. No controls are
            // rendered until it succeeds for the current host session.
            const setup = await client.getHostSetup(eventId);
            if (!this.isCurrent(epoch, client, eventId)) return;
            this.privateSetup = setup;
            this.authorized = true;
            this.message = 'Host controls are ready.';
            this.subscribe(epoch, client, eventId);
            if (this.phase === 'guessing') this.observeTiming(client, eventId);
        },
        subscribe(epoch, client, eventId) {
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
                try { disposeOnce(); } catch (error) { /* cleanup is best effort */ }
            };
            const current = () => !cancelled && this.isCurrent(epoch, client, eventId);
            const onChange = value => {
                if (!current()) return;
                const projection = safeProjection(value);
                if (!projection) {
                    this.phase = 'unavailable';
                    this.participants = [];
                    this.reveal = null;
                    this.error = 'Event status is unavailable. Reconnect to try again.';
                    return;
                }
                this.error = '';
                this.title = projection.title;
                this.phase = projection.phase;
                this.participants = projection.participants;
                if (projection.phase === 'reveal') this.loadReveal(epoch, client, eventId);
                else this.reveal = null;
            };
            const onError = () => {
                if (!current()) return;
                cancelled = true;
                this.phase = 'unavailable';
                this.participants = [];
                this.reveal = null;
                this.error = 'The event connection was lost. Reconnect to try again.';
                try { disposeOnce(); } catch (error) { /* cleanup is best effort */ }
                if (this.disposer === cancel) this.disposer = null;
            };
            this.disposer = cancel;
            try {
                returnedDisposer = client.subscribe(eventId, onChange, onError);
                if (cancelled) disposeOnce();
            } catch (error) {
                if (current()) {
                    cancelled = true;
                    this.phase = 'unavailable';
                    this.participants = [];
                    this.reveal = null;
                    this.error = 'The event connection was lost. Reconnect to try again.';
                    if (this.disposer === cancel) this.disposer = null;
                    disposeOnce();
                }
            }
        },
        async loadReveal(epoch, client, eventId) {
            if (this.reveal) return;
            try {
                const value = await client.getReveal(eventId);
                if (!this.isCurrent(epoch, client, eventId) || this.phase !== 'reveal') return;
                this.reveal = value;
            } catch (error) {
                if (this.isCurrent(epoch, client, eventId) && this.phase === 'reveal') {
                    this.error = 'The revealed results are unavailable. Reconnect to try again.';
                }
            }
        },
        async signIn() {
            if (this.busy || !this.readyToSignIn) return;
            this.invalidateSession();
            const currentEpoch = this.epoch;
            const client = this.hostClient;
            const eventId = this.eventId;
            const email = this.email.trim();
            const password = this.password;
            this.password = '';
            this.busy = true;
            this.error = '';
            this.message = 'Signing in…';
            try {
                await client.signIn(email, password);
                if (!this.isCurrent(currentEpoch, client, eventId)) return;
                this.authenticated = true;
                await this.authorizeAndSubscribe(currentEpoch, client, eventId);
            } catch (error) {
                if (this.isCurrent(currentEpoch, client, eventId)) {
                    this.clearPrivateState();
                    this.error = 'We couldn’t sign in or load host access. Check the details and try again.';
                    this.message = '';
                }
            } finally {
                if (this.isCurrent(currentEpoch, client, eventId)) this.busy = false;
            }
        },
        async signOut() {
            const client = this.hostClient;
            this.pendingDeadlineMs = null;
            this.invalidateSession();
            const epoch = this.epoch;
            this.password = '';
            this.error = '';
            this.message = 'Signing out…';
            this.busy = true;
            try {
                await client.signOut();
                if (this.isCurrent(epoch, client, this.eventId)) this.message = 'You are signed out.';
            } catch (error) {
                if (this.isCurrent(epoch, client, this.eventId)) {
                    this.error = 'We couldn’t confirm sign-out. Host controls remain locked.';
                    this.message = '';
                }
            } finally {
                if (this.isCurrent(epoch, client, this.eventId)) this.busy = false;
            }
        },
        async runCommand(command) {
            if (!this.authorized || this.busy) return;
            const epoch = this.epoch;
            const client = this.hostClient;
            const eventId = this.eventId;
            this.busy = true;
            this.error = '';
            this.message = 'Waiting for confirmation…';
            try {
                const result = await client[command](eventId);
                if (!this.isCurrent(epoch, client, eventId)) return;
                if (!result || !['started', 'already-started', 'closed', 'already-closed', 'revealed', 'already-revealed'].includes(result.status)) {
                    throw new Error('uncertain');
                }
                this.message = 'The event update was acknowledged.';
            } catch (error) {
                if (this.isCurrent(epoch, client, eventId)) {
                    this.error = 'We couldn’t confirm that update. Check the event status before trying again.';
                    this.message = '';
                }
            } finally {
                if (this.isCurrent(epoch, client, eventId)) this.busy = false;
            }
        },
        async requestDuration(request) {
            if (!this.authorized || this.busy || this.phase !== 'guessing' || !this.timingConnected ||
                !Number.isSafeInteger(this.serverNowMs) || this.pendingDeadlineMs !== null ||
                !request || !Number.isSafeInteger(request.durationMs)) return;
            const epoch = this.epoch;
            const client = this.hostClient;
            const eventId = this.eventId;
            this.busy = true;
            this.timingError = '';
            this.error = '';
            try {
                const serverTime = await client.getServerTime(eventId);
                if (!this.isCurrent(epoch, client, eventId) || this.phase !== 'guessing') return;
                if (!serverTime || !Number.isSafeInteger(serverTime.nowMs)) throw new Error('unavailable');
                this.pendingDeadlineMs = deadlineAfter(serverTime.nowMs, request.durationMs,
                    validTiming(this.timing) ? this.timing.deadlineMs : null);
                await this.writePendingDeadline(epoch, client, eventId);
            } catch (error) {
                if (this.isCurrent(epoch, client, eventId)) {
                    this.timingError = 'The timing update was not confirmed. Check the event status before retrying.';
                }
            } finally {
                if (this.isCurrent(epoch, client, eventId)) this.busy = false;
            }
        },
        async retryTiming() {
            if (!this.authorized || this.busy || this.phase !== 'guessing' || !this.timingConnected ||
                this.pendingDeadlineMs === null) return;
            const epoch = this.epoch;
            const client = this.hostClient;
            const eventId = this.eventId;
            this.busy = true;
            this.timingError = '';
            try {
                await this.writePendingDeadline(epoch, client, eventId);
            } catch (error) {
                if (this.isCurrent(epoch, client, eventId)) {
                    this.timingError = 'The timing update was not confirmed. Check the event status before retrying.';
                }
            } finally {
                if (this.isCurrent(epoch, client, eventId)) this.busy = false;
            }
        },
        onTimingViewError() {
            this.timingError = 'Timing connection lost. Reconnect to continue.';
            this.error = 'The event connection was lost. Reconnect to try again.';
            this.message = '';
        },
        async writePendingDeadline(epoch, client, eventId) {
            const target = this.pendingDeadlineMs;
            const result = await client.setDeadline(eventId, target);
            if (!this.isCurrent(epoch, client, eventId) || this.phase !== 'guessing') return;
            if (!result || !['set', 'already-set'].includes(result.status)) throw new Error('unconfirmed');
            this.pendingDeadlineMs = null;
            this.timingError = '';
            this.message = 'The timing update was acknowledged.';
        },
    },
};
</script>

<style scoped>
.event-host { box-sizing: border-box; max-width: 54rem; min-height: 100vh; margin: 0 auto; padding: clamp(1rem, 4vw, 3rem); color: #17212b; font-family: Arial, sans-serif; font-size: 1.2rem; line-height: 1.45; }
.event-host h1 { font-size: clamp(2rem, 5vw, 3rem); }
.event-host__sign-in { display: grid; gap: 0.6rem; max-width: 32rem; }
.event-host input, .event-host button { box-sizing: border-box; min-height: 3rem; padding: 0.5rem 0.75rem; font: inherit; }
.event-host button { margin: 0.5rem 0.5rem 0.5rem 0; cursor: pointer; }
.event-host button:focus-visible, .event-host input:focus-visible { outline: 3px solid #145b9e; outline-offset: 2px; }
.event-host__error { color: #8b1e1e; }
.event-host ul { display: grid; gap: 0.25rem; padding-left: 1.5rem; }
</style>
