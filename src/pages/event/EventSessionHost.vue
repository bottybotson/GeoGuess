<template>
    <main class="event-host">
        <h1>Host the birthday game</h1>
        <form v-if="!authenticated" class="event-host__sign-in" @submit.prevent="signIn">
            <label for="event-host-email">Host email</label>
            <input id="event-host-email" v-model="email" type="email" autocomplete="username" required>
            <label for="event-host-password">Password</label>
            <input id="event-host-password" v-model="password" type="password" autocomplete="current-password" required>
            <button type="submit" :disabled="busy || authError || !email.trim() || !password">Sign in</button>
        </form>
        <p v-if="message" role="status" aria-live="polite">{{ message }}</p>
        <p v-if="error" class="event-host__error" role="alert">{{ error }}</p>
        <button v-if="authenticated" type="button" :disabled="busy" @click="signOut">Sign out</button>
        <button v-if="authError || (authenticated && (error || timingError))" type="button" :disabled="busy" @click="observeAuth">Reconnect</button>
        <section v-if="authenticated && state" aria-label="Event status">
            <h2>{{ title }}</h2>
            <p>Round {{ roundNumber }} of {{ roundCount }} · {{ phaseMessage }}</p>
            <p>{{ participants.length }} guests joined</p>
            <ul aria-label="Guests"><li v-for="guest in participants" :key="guest.id">{{ guest.nickname }}</li></ul>
        </section>
        <section v-if="authorized && state" class="event-host__session" aria-label="Host controls">
            <section v-if="state.phase === 'guessing'" aria-label="Round timing">
                <EventRoundTimer :round-id="state.roundId" :timing="timing" :now-ms="nowMs" :connected="timingConnected" />
                <EventTimingControls
                    :key="state.roundId" :round-id="state.roundId" :timing="timing" :now-ms="nowMs"
                    :connected="timingConnected" :busy="busy || !!pendingCommand" :error="timingError"
                    :retry-available="!!pendingTiming" @request-duration="requestDuration" @retry="retryTiming"
                />
            </section>
            <p v-if="!timingConnected">Waiting for connection before changing the event.</p>
            <button v-if="command" type="button" :disabled="!canCommand" @click="runCommand(command)">{{ commandLabel }}</button>
            <button v-if="pendingCommand" type="button" :disabled="busy || !timingConnected" @click="retryCommand">Retry {{ pendingCommand.command }}</button>
            <p v-if="state.phase === 'ready'">Prepare this round together. Start round publishes the next clue.</p>
            <EventRoundResults v-if="reveal" :reveal="reveal" :cumulative="true" :final="state.phase === 'complete'" />
        </section>
    </main>
</template>

<script>
import EventRoundResults from '@/components/event/EventRoundResults.vue';
import EventRoundTimer from '@/components/event/EventRoundTimer.vue';
import EventTimingControls from '@/components/event/EventTimingControls.vue';
import timingView from '@/event/timing-view';
import { deadlineAfter, validTiming } from '@/event/timing';

const phases = ['lobby', 'ready', 'guessing', 'closed', 'reveal', 'complete'];
const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
const roundValid = value => typeof value === 'string' && /^r(0[1-9]|1[0-9]|20)$/.test(value);
function projection(value) {
    if (!record(value) || value.formatVersion !== 2 || !phases.includes(value.phase) || !roundValid(value.roundId) ||
        !Number.isSafeInteger(value.revision) || value.revision < 0 || !Number.isInteger(value.roundCount) ||
        value.roundCount < 1 || value.roundCount > 20 || Number(value.roundId.slice(1)) > value.roundCount ||
        typeof value.title !== 'string' || !Array.isArray(value.participants) ||
        value.participants.some(guest => !record(guest) || typeof guest.id !== 'string' || typeof guest.nickname !== 'string') ||
        (value.lastRevealedRoundId !== undefined && !roundValid(value.lastRevealedRoundId))) return null;
    const index = Number(value.roundId.slice(1));
    const revision = { lobby: 0, ready: 4 * index - 4, guessing: 4 * index - 3, closed: 4 * index - 2, reveal: 4 * index - 1, complete: 4 * index }[value.phase];
    const last = ['reveal', 'complete'].includes(value.phase) ? value.roundId : index > 1 ? `r${String(index - 1).padStart(2, '0')}` : undefined;
    if (value.revision !== revision || (value.phase === 'lobby' && index !== 1) ||
        (value.phase === 'ready' && index === 1) || (value.phase === 'complete' && index !== value.roundCount) ||
        value.lastRevealedRoundId !== last) return null;
    return {
        title: value.title, roundCount: value.roundCount,
        participants: value.participants.map(({ id, nickname }) => ({ id, nickname })),
        state: { phase: value.phase, roundId: value.roundId, revision: value.revision,
            ...(value.lastRevealedRoundId ? { lastRevealedRoundId: value.lastRevealedRoundId } : {}) },
    };
}
function setupValid(value, roundId) {
    return record(value) && value.id === roundId && typeof value.panoramaId === 'string' && value.panoramaId.length > 0 &&
        Number.isFinite(value.heading) && value.heading >= 0 && value.heading < 360 &&
        Number.isFinite(value.pitch) && value.pitch >= -90 && value.pitch <= 90 && record(value.answer) &&
        Number.isFinite(value.answer.lat) && Math.abs(value.answer.lat) <= 90 &&
        Number.isFinite(value.answer.lng) && Math.abs(value.answer.lng) <= 180 &&
        Number.isFinite(value.difficulty) && value.difficulty > 0;
}
const statuses = { start: 'started', close: 'closed', reveal: 'revealed', next: 'advanced', complete: 'completed' };

export default {
    name: 'EventSessionHost',
    inheritAttrs: false,
    mixins: [timingView],
    components: { EventRoundResults, EventRoundTimer, EventTimingControls },
    props: { eventId: { type: String, required: true }, hostClient: { type: Object, required: true } },
    data: () => ({
        email: '', password: '', authenticated: false, authorized: false, privateSetup: null,
        state: null, title: 'Birthday GeoGuess', roundCount: 0, participants: [], reveal: null,
        error: '', message: '', timingError: '', busy: false, pendingCommand: null, pendingTiming: null,
        epoch: 0, scope: 0, disposer: null, destroyed: false, setupRoundId: null, revealRequest: 0,
        authUid: undefined, authError: false, authDisposer: null, authEpoch: 0,
    }),
    computed: {
        roundNumber() { return this.state ? Number(this.state.roundId.slice(1)) : 0; },
        phaseMessage() {
            return this.state ? ({ lobby: 'Lobby open', ready: 'Ready to start', guessing: 'Guests are guessing',
                closed: 'Guessing closed', reveal: 'Results revealed', complete: 'Event complete' })[this.state.phase] : '';
        },
        command() {
            if (!this.state) return null;
            return ({ lobby: 'start', ready: 'start', guessing: 'close', closed: 'reveal',
                reveal: this.roundNumber < this.roundCount ? 'next' : 'complete' })[this.state.phase] || null;
        },
        commandLabel() { return ({ start: 'Start round', close: 'Close guessing', reveal: 'Reveal results', next: 'Next round', complete: 'Finish event' })[this.command]; },
        canCommand() {
            return this.authorized && this.timingConnected && !this.busy && !this.pendingCommand && !this.pendingTiming &&
                (this.command !== 'start' || this.participants.length > 0);
        },
    },
    watch: { eventId() { this.observeAuth(); }, hostClient() { this.observeAuth(); } },
    mounted() { this.observeAuth(); },
    beforeDestroy() { this.destroyed = true; this.stopAuth(); this.invalidate(); },
    methods: {
        stopAuth() {
            this.authEpoch += 1;
            const dispose = this.authDisposer;
            this.authDisposer = null;
            if (dispose) { try { dispose(); } catch (error) { /* best effort */ } }
        },
        observeAuth() {
            this.stopAuth();
            this.invalidate();
            this.authUid = undefined;
            this.authError = false;
            this.error = '';
            this.message = 'Checking for a saved host session…';
            this.busy = true;
            const authEpoch = this.authEpoch, client = this.hostClient, eventId = this.eventId;
            let cancelled = false, returned, disposed = false;
            const release = () => { if (!disposed && typeof returned === 'function') { disposed = true; returned(); } };
            const cancel = () => { cancelled = true; try { release(); } catch (error) { /* best effort */ } };
            const current = () => !cancelled && !this.destroyed && authEpoch === this.authEpoch &&
                client === this.hostClient && eventId === this.eventId;
            const fail = () => {
                if (!current()) return;
                cancel();
                this.invalidate();
                this.authUid = undefined;
                this.authError = true;
                this.message = '';
                this.error = 'Host account status is unavailable. Reconnect to check host access.';
            };
            this.authDisposer = cancel;
            try {
                returned = client.subscribeAuth(user => {
                    if (!current()) return;
                    if (user !== null && (!record(user) || typeof user.uid !== 'string' || !user.uid)) { fail(); return; }
                    const uid = user ? user.uid : null;
                    if (uid === this.authUid) return;
                    this.authUid = uid;
                    // Cross-tab account changes invalidate private state and all
                    // pending responses before the next authorization read.
                    this.invalidate();
                    this.error = '';
                    if (uid === null) this.message = 'Sign in with the host account to manage this event.';
                    else this.restore();
                }, fail);
                if (cancelled) release();
            } catch (error) { fail(); }
        },
        current(epoch, client, eventId) {
            return !this.destroyed && epoch === this.epoch && client === this.hostClient && eventId === this.eventId;
        },
        invalidate() {
            this.epoch += 1;
            this.scope += 1;
            const dispose = this.disposer;
            this.disposer = null;
            if (dispose) { try { dispose(); } catch (error) { /* best effort */ } }
            this.stopTimingView();
            this.password = '';
            this.authenticated = false;
            this.authorized = false;
            this.privateSetup = null;
            this.setupRoundId = null;
            this.state = null;
            this.participants = [];
            this.reveal = null;
            this.pendingCommand = null;
            this.pendingTiming = null;
            this.timingError = '';
            this.busy = false;
            this.revealRequest += 1;
        },
        async restore() {
            this.invalidate();
            const epoch = this.epoch, client = this.hostClient, eventId = this.eventId;
            this.busy = true;
            this.error = '';
            this.message = 'Checking for a saved host session…';
            try {
                const user = await client.restore();
                if (!this.current(epoch, client, eventId)) return;
                if (this.authUid === undefined || (user ? user.uid : null) !== this.authUid) return;
                this.authenticated = !!user;
                this.message = user ? 'Loading active round and host access…' : 'Sign in with the host account to manage this event.';
                if (user) this.subscribe(epoch, client, eventId);
            } catch (error) {
                if (this.current(epoch, client, eventId)) this.error = 'We couldn’t restore host access. Sign in to continue.';
            } finally {
                if (this.current(epoch, client, eventId)) this.busy = false;
            }
        },
        async signIn() {
            if (this.busy || this.authError || !this.email.trim() || !this.password) return;
            const email = this.email.trim(), password = this.password;
            this.password = '';
            this.invalidate();
            const epoch = this.epoch, client = this.hostClient, eventId = this.eventId;
            this.busy = true;
            this.error = '';
            try {
                const user = await client.signIn(email, password);
                if (!this.current(epoch, client, eventId)) return;
                this.message = 'Checking signed-in host access…';
                if (this.authUid && user && user.uid === this.authUid) await this.restore();
            } catch (error) {
                if (this.current(epoch, client, eventId)) this.error = 'We couldn’t sign in or load host access. Check the details and try again.';
            } finally {
                if (this.current(epoch, client, eventId)) this.busy = false;
            }
        },
        async signOut() {
            const client = this.hostClient, eventId = this.eventId;
            this.invalidate();
            const epoch = this.epoch;
            this.password = '';
            this.busy = true;
            this.error = '';
            try {
                await client.signOut();
                if (this.current(epoch, client, eventId)) this.message = 'You are signed out.';
            } catch (error) {
                if (this.current(epoch, client, eventId)) this.error = 'We couldn’t confirm sign-out. Host controls remain locked.';
            } finally {
                if (this.current(epoch, client, eventId)) this.busy = false;
            }
        },
        subscribe(epoch, client, eventId) {
            let cancelled = false, returned, disposed = false;
            const release = () => { if (!disposed && typeof returned === 'function') { disposed = true; returned(); } };
            const cancel = () => { cancelled = true; try { release(); } catch (error) { /* best effort */ } };
            const current = () => !cancelled && this.current(epoch, client, eventId);
            const fail = () => {
                if (!current()) return;
                cancel();
                this.scope += 1;
                this.revealRequest += 1;
                this.pendingCommand = null;
                this.pendingTiming = null;
                this.authorized = false;
                this.privateSetup = null;
                this.setupRoundId = null;
                this.state = null;
                this.participants = [];
                this.reveal = null;
                this.stopTimingView();
                this.error = 'The event connection was lost. Reconnect to try again.';
            };
            this.disposer = cancel;
            try {
                returned = client.subscribe(eventId, value => {
                    if (!current()) return;
                    const next = projection(value);
                    if (!next) { fail(); return; }
                    const roundChanged = !this.state || this.state.roundId !== next.state.roundId;
                    if (roundChanged) {
                        this.scope += 1;
                        this.authorized = false;
                        this.privateSetup = null;
                        this.setupRoundId = null;
                        this.reveal = null;
                        this.pendingCommand = null;
                        this.pendingTiming = null;
                        this.timingError = '';
                        this.stopTimingView();
                    }
                    if (next.state.phase !== 'guessing') {
                        this.pendingTiming = null;
                        this.timingError = '';
                    }
                    this.state = next.state;
                    this.title = next.title;
                    this.roundCount = next.roundCount;
                    this.participants = next.participants;
                    this.error = '';
                    this.observeTiming(client.session, eventId, true, next.state.roundId);
                    if (this.setupRoundId !== next.state.roundId) this.authorize(epoch, client, eventId, next.state.roundId, this.scope);
                    this.loadReveal(epoch, client, eventId);
                }, fail);
                if (cancelled) release();
            } catch (error) { fail(); }
        },
        async authorize(epoch, client, eventId, roundId, scope) {
            this.setupRoundId = roundId;
            try {
                const setup = await client.session.getHostSetup(eventId, roundId);
                if (!this.current(epoch, client, eventId) || scope !== this.scope) return;
                if (!setupValid(setup, roundId)) throw new Error('unavailable');
                this.privateSetup = setup;
                this.authorized = true;
                this.message = 'Host controls are ready.';
            } catch (error) {
                if (this.current(epoch, client, eventId) && scope === this.scope) {
                    this.authorized = false;
                    this.privateSetup = null;
                    this.error = 'Host access or active-round setup is unavailable. Reconnect to try again.';
                }
            }
        },
        async loadReveal(epoch, client, eventId) {
            const roundId = this.state.lastRevealedRoundId;
            const request = ++this.revealRequest;
            if (!roundId) { this.reveal = null; return; }
            if (this.reveal && this.reveal.roundId === roundId) return;
            this.reveal = null;
            try {
                const value = await client.session.getReveal(eventId, roundId);
                if (!this.current(epoch, client, eventId) || request !== this.revealRequest) return;
                if (!value || value.roundId !== roundId) throw new Error('unavailable');
                this.reveal = value;
            } catch (error) {
                if (this.current(epoch, client, eventId) && request === this.revealRequest) this.error = 'Revealed standings are unavailable. Reconnect to try again.';
            }
        },
        async runCommand(command) {
            if (!this.canCommand || command !== this.command) return;
            this.pendingCommand = { command, expected: { roundId: this.state.roundId, revision: this.state.revision } };
            await this.writeCommand(this.pendingCommand);
        },
        async retryCommand() {
            if (!this.authorized || this.busy || !this.timingConnected || !this.pendingCommand) return;
            await this.writeCommand(this.pendingCommand);
        },
        async writeCommand(pending) {
            const epoch = this.epoch, client = this.hostClient, eventId = this.eventId;
            this.busy = true;
            this.error = '';
            try {
                const result = await client.session[pending.command](eventId, pending.expected);
                if (!this.current(epoch, client, eventId) || this.pendingCommand !== pending) return;
                if (!result || ![statuses[pending.command], `already-${statuses[pending.command]}`].includes(result.status)) throw new Error('uncertain');
                this.pendingCommand = null;
                this.message = 'The event update was acknowledged.';
            } catch (error) {
                if (this.current(epoch, client, eventId) && this.pendingCommand === pending) {
                    this.error = error.code === 'stale-state' ? 'These controls are out of date. Check the current round and reconnect before continuing.' :
                        'We couldn’t confirm that update. Retry keeps the original round and revision.';
                }
            } finally {
                if (this.current(epoch, client, eventId)) this.busy = false;
            }
        },
        async requestDuration(request) {
            if (!this.canCommand || !this.state || this.state.phase !== 'guessing' || !request || !Number.isSafeInteger(request.durationMs)) return;
            const epoch = this.epoch, client = this.hostClient, eventId = this.eventId, scope = this.scope;
            const expected = { roundId: this.state.roundId, revision: this.state.revision };
            const currentDeadline = validTiming(this.timing, expected.roundId) ? this.timing.deadlineMs : null;
            this.busy = true;
            this.timingError = '';
            try {
                const time = await client.session.getServerTime(eventId);
                if (!this.current(epoch, client, eventId) || scope !== this.scope) return;
                if (!this.state || this.state.roundId !== expected.roundId || this.state.revision !== expected.revision || !this.timingConnected) throw new Error('stale-state');
                const pending = { expected, deadlineMs: deadlineAfter(time.nowMs, request.durationMs, currentDeadline) };
                this.pendingTiming = pending;
                await this.writeTiming(pending, epoch, client, eventId);
            } catch (error) {
                if (this.current(epoch, client, eventId) && scope === this.scope) this.timingError = 'Timing update was not confirmed. Reconnect or retry the same update.';
            } finally {
                if (this.current(epoch, client, eventId)) this.busy = false;
            }
        },
        async retryTiming() {
            if (!this.authorized || this.busy || !this.timingConnected || !this.pendingTiming || this.state.phase !== 'guessing') return;
            const epoch = this.epoch, client = this.hostClient, eventId = this.eventId;
            this.busy = true;
            this.timingError = '';
            try { await this.writeTiming(this.pendingTiming, epoch, client, eventId); }
            catch (error) { if (this.current(epoch, client, eventId)) this.timingError = 'Timing update was not confirmed. Retry keeps the same deadline and round.'; }
            finally { if (this.current(epoch, client, eventId)) this.busy = false; }
        },
        async writeTiming(pending, epoch, client, eventId) {
            const result = await client.session.setDeadline(eventId, pending.expected, pending.deadlineMs);
            if (!this.current(epoch, client, eventId) || this.pendingTiming !== pending) return;
            if (!result || !['set', 'already-set'].includes(result.status)) throw new Error('uncertain');
            this.pendingTiming = null;
            this.timingError = '';
            this.message = 'The timing update was acknowledged.';
        },
        onTimingViewError() { this.timingError = 'Timing connection lost. Reconnect to continue.'; },
    },
};
</script>

<style scoped>
.event-host { box-sizing: border-box; max-width: 54rem; min-height: 100vh; margin: 0 auto; padding: clamp(1rem, 4vw, 3rem); color: #17212b; font: 1.2rem/1.45 Arial, sans-serif; }
.event-host__sign-in { display: grid; gap: 0.6rem; max-width: 32rem; }
.event-host input, .event-host button { box-sizing: border-box; min-height: 3rem; padding: 0.5rem 0.75rem; font: inherit; }
.event-host button { margin: 0.5rem 0.5rem 0.5rem 0; cursor: pointer; }
.event-host button:focus-visible, .event-host input:focus-visible { outline: 3px solid #145b9e; outline-offset: 2px; }
.event-host__error { color: #8b1e1e; }
</style>
