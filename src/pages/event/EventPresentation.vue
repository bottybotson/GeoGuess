<template>
    <div class="event-presentation-page" aria-live="polite">
        <section v-if="status === 'loading'" class="event-presentation-page__message" role="status">
            <h1>Connecting to the presentation</h1>
            <p>Loading the public event view…</p>
        </section>

        <section v-else-if="status === 'error'" class="event-presentation-page__message" role="status">
            <h1>Presentation connection lost</h1>
            <p>{{ errorMessage }}</p>
            <button type="button" class="event-presentation-page__retry" style="min-height: 48px" @click="retry">Reconnect</button>
        </section>

        <section v-else-if="status === 'unavailable'" class="event-presentation-page__message" role="status">
            <h1>Presentation unavailable</h1>
            <p>The public event details are unavailable right now.</p>
            <button type="button" class="event-presentation-page__retry" style="min-height: 48px" @click="retry">Reconnect</button>
        </section>

        <template v-else-if="projection">
            <template v-if="isV2">
                <main class="event-presentation-page__multi" aria-label="Event presentation">
                    <header class="event-presentation-page__heading">
                        <p class="event-presentation-page__event-title">{{ projection.title }}</p>
                        <h1>{{ phaseHeading }}</h1>
                        <p class="event-presentation-page__phase">{{ phaseMessage }}</p>
                        <p class="event-presentation-page__round">Round {{ currentRoundNumber }} of {{ roundCount }}</p>
                    </header>

                    <EventJoinQr
                        v-if="sessionState.phase === 'lobby' && safeJoinUrl"
                        :event-id="eventId" :join-url="safeJoinUrl"
                    />

                    <EventRoundTimer
                        v-if="sessionClient && sessionState.phase === 'guessing'"
                        class="event-presentation-page__timer"
                        :timing="timing" :now-ms="nowMs" :connected="timingConnected"
                        :round-id="sessionState.roundId"
                    />

                    <EventGuessMap
                        v-if="mapsLoader && currentStandingsReveal"
                        class="event-presentation-page__map"
                        :maps-loader="mapsLoader" :answer="currentStandingsReveal.answer" :selected="null" :disabled="true"
                    />
                    <p v-else-if="currentStandingsReveal && !mapsLoader" class="event-presentation-page__map-fallback">
                        Correct location: {{ coordinateText(currentStandingsReveal.answer) }}
                    </p>
                    <p v-if="currentStandingsReveal && mapsLoader" class="event-presentation-page__map-caption">
                        Correct location: {{ coordinateText(currentStandingsReveal.answer) }}
                    </p>

                    <section v-if="revealError" class="event-presentation-page__notice" role="status">
                        <p>Published results could not be loaded.</p>
                        <button type="button" @click="retryReveal">Retry results</button>
                    </section>
                    <p v-else-if="revealLoading" class="event-presentation-page__notice" role="status">
                        Loading published results…
                    </p>

                    <EventRoundResults v-if="currentStandingsReveal" :reveal="currentStandingsReveal" cumulative :final="sessionState.phase === 'complete'" />
                    <p v-else-if="!revealLoading && !revealError" class="event-presentation-page__notice" role="status">
                        Standings will appear after the host reveals the first round.
                    </p>

                    <section class="event-presentation-page__guests" aria-label="Guests">
                        <p>{{ projection.participants.length }} of 50 guests</p>
                        <ul><li v-for="person in projection.participants" :key="person.id">{{ person.nickname }}</li></ul>
                    </section>
                </main>
            </template>
            <template v-else>
                <section v-if="roundClient && projection.phase === 'reveal'" class="event-presentation-page__results">
                    <EventRoundResults v-if="publicReveal" :reveal="publicReveal" />
                    <p v-else role="status">{{ revealError ? 'Results could not be loaded.' : 'Loading results…' }}</p>
                    <button v-if="revealError" type="button" class="event-presentation-page__retry" @click="retryReveal">Reconnect</button>
                </section>
                <template v-else>
                    <EventRoundTimer
                        v-if="projection.phase === 'guessing'"
                        class="event-presentation-page__timer"
                        :timing="timing" :now-ms="nowMs" :connected="timingConnected"
                    />
                    <EventLobbyPresentation
                        :title="projection.title" :phase="projection.phase"
                        :participants="projection.participants" :join-url="safeJoinUrl"
                    />
                    <EventJoinQr v-if="projection.phase === 'lobby' && safeJoinUrl" :event-id="eventId" :join-url="safeJoinUrl" />
                </template>
            </template>
        </template>
    </div>
</template>

<script>
import EventLobbyPresentation from '@/components/event/EventLobbyPresentation.vue';
import EventJoinQr, { sanitizeJoinUrl } from '@/components/event/EventJoinQr.vue';
import EventRoundResults from '@/components/event/EventRoundResults.vue';
import EventRoundTimer from '@/components/event/EventRoundTimer.vue';
import EventGuessMap from '@/components/event/EventGuessMap.vue';
import timingView from '@/event/timing-view';

const PHASES = new Set(['lobby', 'ready', 'guessing', 'closed', 'reveal', 'complete']);
const ROUND_ID = /^r(0[1-9]|1[0-9]|20)$/;
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
    if (value.formatVersion === 2) {
        if (!ROUND_ID.test(value.roundId) || !Number.isInteger(value.roundCount) || value.roundCount < 1 || value.roundCount > 20) return null;
        return { title: value.title, phase: value.phase, participants, formatVersion: 2,
            roundId: value.roundId, roundCount: value.roundCount };
    }
    if (value.formatVersion !== undefined && value.formatVersion !== 1) return null;
    return { title: value.title, phase: value.phase, participants, formatVersion: 1 };
}

function safeSessionState(value) {
    if (!isRecord(value) || !PHASES.has(value.phase) || !ROUND_ID.test(value.roundId) ||
        !Number.isSafeInteger(value.revision) || value.revision < 0 ||
        !Number.isInteger(value.roundCount) || value.roundCount < 1 || value.roundCount > 20) return null;
    const current = Number(value.roundId.slice(1));
    if (current > value.roundCount || (value.phase === 'complete' && current !== value.roundCount)) return null;
    const expectedRevision = { lobby: 0, ready: 4 * current - 4, guessing: 4 * current - 3,
        closed: 4 * current - 2, reveal: 4 * current - 1, complete: 4 * current }[value.phase];
    if (value.revision !== expectedRevision || (value.phase === 'lobby' && current !== 1) ||
        (value.phase === 'ready' && current === 1)) return null;
    const last = value.lastRevealedRoundId;
    const shouldHaveLast = ['reveal', 'complete'].includes(value.phase) || current > 1;
    if (shouldHaveLast) {
        const expectedLast = ['reveal', 'complete'].includes(value.phase) ? value.roundId : `r${String(current - 1).padStart(2, '0')}`;
        if (last !== expectedLast) return null;
    } else if (last !== undefined) return null;
    return { phase: value.phase, roundId: value.roundId, roundCount: value.roundCount,
        lastRevealedRoundId: shouldHaveLast ? last : null };
}

function validReveal(value, roundId) {
    return isRecord(value) && value.roundId === roundId && isRecord(value.answer) &&
        Number.isFinite(value.answer.lat) && value.answer.lat >= -90 && value.answer.lat <= 90 &&
        Number.isFinite(value.answer.lng) && value.answer.lng >= -180 && value.answer.lng <= 180 &&
        isRecord(value.results) && Object.values(value.results).every(item => isRecord(item) &&
            typeof item.nickname === 'string' && Number.isFinite(item.totalPoints) && item.totalPoints >= 0 &&
            Number.isFinite(item.points) && item.points >= 0);
}

export default {
    name: 'EventPresentation',
    inheritAttrs: false,
    mixins: [timingView],
    components: { EventLobbyPresentation, EventJoinQr, EventRoundResults, EventRoundTimer, EventGuessMap },
    props: {
        eventId: { type: String, required: true },
        lobbyClient: { type: Object, required: true },
        joinUrl: { type: String, default: '' },
        roundClient: { type: Object, default: null },
        sessionClient: { type: Object, default: null },
        mapsLoader: { type: Function, default: null },
    },
    computed: {
        safeJoinUrl() { return sanitizeJoinUrl(this.joinUrl, this.eventId); },
        isV2() { return !!this.sessionClient && !!this.sessionState; },
        roundCount() { return this.sessionState ? this.sessionState.roundCount : (this.projection ? this.projection.roundCount : 0); },
        currentStandingsReveal() {
            return this.standingsReveal && this.sessionState &&
                this.standingsRoundId === this.sessionState.lastRevealedRoundId ? this.standingsReveal : null;
        },
        currentRoundNumber() { return this.sessionState ? Number(this.sessionState.roundId.slice(1)) : 1; },
        phaseHeading() {
            if (!this.sessionState) return '';
            if (this.sessionState.phase === 'complete') return 'Game complete';
            return this.sessionState.phase === 'lobby' ? 'Waiting for the host' : `Round ${this.currentRoundNumber}`;
        },
        phaseMessage() {
            const messages = { lobby: 'The host will start the first round when everyone is ready.',
                ready: 'The host is preparing this round. Take your time.', guessing: 'Guests are exploring and placing their guesses.',
                closed: 'Guessing is closed. The host will reveal the results.', reveal: 'The host has revealed this round.',
                complete: 'The event is complete. Here are the final standings.' };
            return this.sessionState ? messages[this.sessionState.phase] : 'Connecting to round status…';
        },
    },
    data() {
        return { status: 'loading', errorMessage: 'Check the connection and reconnect when ready.',
            projection: null, sessionState: null, epoch: 0, disposers: [], connectScheduled: false,
            publicReveal: null, standingsReveal: null, standingsRoundId: null,
            revealError: false, revealLoading: false, revealEpoch: 0, protocolVersion: null };
    },
    watch: {
        eventId() { this.scheduleConnect(); }, lobbyClient() { this.scheduleConnect(); },
        roundClient() { this.scheduleConnect(); }, sessionClient() { this.scheduleConnect(); },
    },
    mounted() { this.connect(); },
    beforeDestroy() { this.epoch += 1; this.stopSubscriptions(); this.stopTimingView(); },
    methods: {
        coordinateText(point) { return `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`; },
        scheduleConnect() {
            if (this.connectScheduled) return;
            this.connectScheduled = true;
            this.$nextTick(() => { this.connectScheduled = false; if (!this._isDestroyed && !this._isBeingDestroyed) this.connect(); });
        },
        stopSubscriptions() {
            const disposers = this.disposers;
            this.disposers = [];
            disposers.forEach(dispose => { try { dispose(); } catch (error) { /* best effort cleanup */ } });
        },
        connect() {
            const client = this.lobbyClient;
            const session = this.sessionClient;
            const eventId = this.eventId;
            const epoch = ++this.epoch;
            this.stopSubscriptions();
            this.stopTimingView();
            this.status = 'loading'; this.projection = null; this.sessionState = null;
            this.publicReveal = null; this.standingsReveal = null; this.standingsRoundId = null;
            this.revealError = false; this.revealLoading = false; this.revealEpoch += 1;
            this.protocolVersion = session ? null : 1;
            let lobbyReady = false;
            let stateReady = !session;
            let activeSession = null;
            let sessionObserverStarted = false;
            let selectedVersion = session ? null : 1;
            let cancelled = false;
            const current = () => !cancelled && this.epoch === epoch && this.lobbyClient === client &&
                this.sessionClient === session && this.eventId === eventId;
            const fail = () => {
                if (!current()) return;
                cancelled = true; this.status = 'error'; this.projection = null; this.sessionState = null;
                this.stopSubscriptions(); this.stopTimingView();
            };
            const ready = () => {
                if (!current() || !lobbyReady || !stateReady) return;
                this.status = 'ready';
                if (activeSession && this.sessionState) {
                    this.observeTiming(activeSession, eventId, this.sessionState.phase === 'guessing', this.sessionState.roundId);
                    this.loadLatestReveal(epoch);
                } else if (this.projection) {
                    this.observeTiming(this.roundClient, eventId, this.projection.phase === 'guessing');
                    if (this.projection.phase === 'reveal') this.loadLegacyReveal(epoch);
                }
            };
            const listen = (subscribe, onChange) => {
                let live = true; let returned = null; let disposed = false;
                const disposeOnce = () => { if (!disposed && typeof returned === 'function') { disposed = true; returned(); } };
                const stop = () => { live = false; disposeOnce(); };
                this.disposers.push(stop);
                try {
                    returned = subscribe(onChange, fail);
                    if (!live || cancelled) disposeOnce();
                } catch (error) { fail(error); }
            };
            listen((change, error) => client.subscribe(eventId, change, error), value => {
                if (!current()) return;
                const safe = safeProjection(value);
                if (!safe || (selectedVersion && safe.formatVersion !== selectedVersion)) {
                    this.status = 'unavailable'; this.projection = null; return;
                }
                this.projection = safe; lobbyReady = true; ready();
            });
            const observeSession = () => {
                if (!session || sessionObserverStarted || !current()) return;
                sessionObserverStarted = true;
                activeSession = session;
                stateReady = false;
                listen((change, error) => session.subscribeState(eventId, change, error), value => {
                    if (!current()) return;
                    const safe = safeSessionState(value);
                    if (!safe) { this.status = 'unavailable'; this.sessionState = null; return; }
                    this.sessionState = safe; stateReady = true;
                    this.revealEpoch += 1;
                    this.revealLoading = false;
                    if (this.projection && (this.projection.roundId !== safe.roundId || this.projection.phase !== safe.phase || this.projection.roundCount !== safe.roundCount)) {
                        this.projection = { ...this.projection, phase: safe.phase, roundId: safe.roundId, roundCount: safe.roundCount };
                    }
                    ready();
                });
            };
            if (session && typeof client.getFormatVersion === 'function') {
                Promise.resolve().then(() => client.getFormatVersion(eventId)).then(version => {
                    if (!current()) return;
                    if (version === 2) {
                        selectedVersion = 2;
                        this.protocolVersion = 2;
                        if (this.projection && this.projection.formatVersion !== 2) {
                            this.status = 'unavailable'; this.projection = null; return;
                        }
                        observeSession();
                    } else if (version === 1) {
                        selectedVersion = 1;
                        this.protocolVersion = 1;
                        if (this.projection && this.projection.formatVersion === 2) {
                            this.status = 'unavailable'; this.projection = null; return;
                        }
                        stateReady = true; ready();
                    }
                    else { this.status = 'unavailable'; this.projection = null; }
                }).catch(fail);
            } else if (session) {
                this.protocolVersion = 2;
                observeSession();
            }
        },
        retry() { this.connect(); },
        onTimingViewError() {
            if (this.status === 'ready') {
                this.status = 'error'; this.errorMessage = 'The public event connection was lost. Reconnect to continue.';
            }
        },
        async loadLatestReveal(epoch) {
            const session = this.sessionClient;
            const state = this.sessionState;
            const roundId = state && state.lastRevealedRoundId;
            if (!session || !roundId || this.standingsRoundId === roundId || this.revealLoading) return;
            const request = ++this.revealEpoch;
            this.revealLoading = true; this.revealError = false;
            try {
                const value = await session.getReveal(this.eventId, roundId);
                if (request !== this.revealEpoch || epoch !== this.epoch || session !== this.sessionClient ||
                    !this.sessionState || this.sessionState.lastRevealedRoundId !== roundId) return;
                if (!validReveal(value, roundId)) throw new Error('Invalid public reveal');
                this.standingsReveal = value; this.standingsRoundId = roundId;
                if (this.sessionState.phase === 'reveal' || this.sessionState.phase === 'complete') this.publicReveal = value;
            } catch (error) {
                if (request === this.revealEpoch && epoch === this.epoch) this.revealError = true;
            } finally {
                if (request === this.revealEpoch && epoch === this.epoch) this.revealLoading = false;
            }
        },
        retryReveal() {
            this.standingsRoundId = null; this.revealError = false;
            if (this.protocolVersion === 2) this.loadLatestReveal(this.epoch);
            else { this.publicReveal = null; this.loadLegacyReveal(this.epoch); }
        },
        async loadLegacyReveal(epoch) {
            if (!this.roundClient || this.publicReveal || this.revealLoading) return;
            const client = this.roundClient;
            this.revealLoading = true;
            try {
                const value = await client.getReveal(this.eventId);
                if (epoch !== this.epoch || client !== this.roundClient || this.status !== 'ready' || this.projection.phase !== 'reveal') return;
                if (!value) throw new Error('Reveal unavailable');
                this.publicReveal = value;
            } catch { if (epoch === this.epoch && client === this.roundClient && this.status === 'ready') this.revealError = true; }
            finally { if (epoch === this.epoch && client === this.roundClient) this.revealLoading = false; }
        },
    },
};
</script>

<style scoped>
.event-presentation-page { min-height: 100vh; background: #10263d; color: #fff; font-family: Arial, sans-serif; }
.event-presentation-page__multi { box-sizing: border-box; max-width: 90rem; min-height: 100vh; margin: 0 auto; padding: clamp(1rem, 4vw, 3rem); }
.event-presentation-page__heading { margin-bottom: 1.5rem; }
.event-presentation-page__event-title { margin: 0 0 .5rem; opacity: .9; font-size: clamp(1.1rem, 2vw, 1.7rem); }
.event-presentation-page__heading h1 { margin: 0; font-size: clamp(2.4rem, 7vw, 5rem); }
.event-presentation-page__phase, .event-presentation-page__round { margin: .5rem 0 0; font-size: clamp(1.15rem, 2.6vw, 2rem); }
.event-presentation-page__timer { width: fit-content; margin: 1rem 0; padding: .75rem 1.25rem; border-radius: .4rem; background: #fff; color: #17212b; }
.event-presentation-page__map { margin: 1.5rem 0; border-radius: .5rem; overflow: hidden; }
.event-presentation-page__map-fallback, .event-presentation-page__notice { padding: 1rem; border-radius: .4rem; background: #183a59; font-size: 1.2rem; }
.event-presentation-page__map-caption { margin: -.75rem 0 1.5rem; font-size: 1.1rem; }
.event-presentation-page__multi .event-round-results { max-width: 68rem; margin: 2rem auto; border-radius: .5rem; background: #fff; color: #17212b; font-size: clamp(1.15rem, 2.3vw, 1.8rem); }
.event-presentation-page__guests { margin-top: 2rem; font-size: 1.1rem; }
.event-presentation-page__guests ul { display: flex; flex-wrap: wrap; gap: .75rem 1.5rem; padding: 0; list-style: none; }
.event-presentation-page__results { min-height: 100vh; padding: clamp(1rem, 4vw, 3rem); background: #fff; color: #17212b; }
.event-presentation-page__retry { min-width: 9rem; min-height: 3rem; margin-top: 1rem; padding: .5rem 1.25rem; border: 2px solid #fff; border-radius: .35rem; background: #fff; color: #10263d; font: inherit; font-weight: 700; cursor: pointer; }
.event-presentation-page__message { box-sizing: border-box; max-width: 70rem; min-height: 100vh; margin: 0 auto; padding: clamp(1.5rem, 5vw, 4rem); display: flex; flex-direction: column; justify-content: center; align-items: flex-start; font-size: clamp(1.25rem, 2.4vw, 2rem); line-height: 1.4; }
.event-presentation-page__message h1 { margin: 0 0 1rem; font-size: clamp(2rem, 5vw, 4rem); }
.event-presentation-page__retry:focus-visible { outline: 4px solid #ffd166; outline-offset: 3px; }
</style>
