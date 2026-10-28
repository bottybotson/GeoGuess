<template>
    <main class="event-presentation" aria-live="polite">
        <header class="event-presentation__header">
            <h1 class="event-presentation__title">{{ title }}</h1>
            <p class="event-presentation__count">
                {{ participants.length }} of 50 guests
            </p>
        </header>

        <section class="event-presentation__status" aria-label="Event status">
            <p>{{ phaseMessage }}</p>
            <div v-if="isLobby && joinUrl" class="event-presentation__join">
                <span class="event-presentation__join-label">Join at:</span>
                <span class="event-presentation__join-url">{{ joinUrl }}</span>
            </div>
        </section>

        <section class="event-presentation__guests" aria-label="Guests">
            <h2>Guests</h2>
            <p v-if="participants.length === 0" class="event-presentation__empty">
                {{ emptyGuestsMessage }}
            </p>
            <ul v-else>
                <li v-for="participant in participants" :key="participant.id">
                    {{ participant.nickname }}
                </li>
            </ul>
        </section>
    </main>
</template>

<script>
const PHASE_MESSAGES = {
    lobby: 'The lobby is open. The host will start the game.',
    guessing: 'Guessing is in progress. Results will be shown after the host reveals them.',
    closed: 'Guessing is closed. The host will reveal the results.',
    reveal: 'The host is revealing the round. Round results are not available yet.',
    complete: 'The event is complete. Final results are not available yet.',
};

export default {
    name: 'EventLobbyPresentation',
    inheritAttrs: false,
    props: {
        title: {
            type: String,
            default: 'Birthday GeoGuess',
        },
        phase: {
            type: String,
            default: 'unknown',
        },
        joinUrl: {
            type: String,
            default: '',
        },
        participants: {
            type: Array,
            default: () => [],
        },
    },
    computed: {
        isLobby() {
            return this.phase === 'lobby';
        },
        phaseMessage() {
            return Object.prototype.hasOwnProperty.call(PHASE_MESSAGES, this.phase)
                ? PHASE_MESSAGES[this.phase]
                : 'Event status is unavailable.';
        },
        emptyGuestsMessage() {
            if (this.phase === 'lobby') {
                return 'Guests are welcome and waiting for the host.';
            }

            if (this.phaseMessage === 'Event status is unavailable.') {
                return 'Guest list is unavailable.';
            }

            return 'No guests are currently listed.';
        },
    },
};
</script>

<style scoped>
.event-presentation {
    box-sizing: border-box;
    min-height: 100vh;
    padding: clamp(1.5rem, 5vw, 4rem);
    background: #10263d;
    color: #fff;
    font-family: Arial, sans-serif;
    font-size: clamp(1.25rem, 2.4vw, 2rem);
    line-height: 1.4;
}

.event-presentation__header,
.event-presentation__status,
.event-presentation__guests {
    max-width: 70rem;
    margin: 0 auto 2rem;
}

.event-presentation__title {
    margin: 0 0 0.5rem;
    font-size: clamp(2.25rem, 6vw, 5rem);
    line-height: 1.1;
    overflow-wrap: anywhere;
}

.event-presentation__count {
    margin: 0;
    font-size: 1.25em;
    font-weight: 700;
}

.event-presentation__status {
    padding: 1.25rem 1.5rem;
    border: 2px solid #c6e6ff;
    border-radius: 0.5rem;
    background: #183a59;
}

.event-presentation__status p {
    margin: 0;
}

.event-presentation__join {
    margin-top: 1rem;
}

.event-presentation__join-label {
    display: block;
    font-weight: 700;
}

.event-presentation__join-url {
    display: block;
    color: #fff;
    overflow-wrap: anywhere;
    word-break: break-word;
}

.event-presentation__guests h2 {
    margin: 0 0 0.5rem;
    font-size: 1.5em;
}

.event-presentation__guests ul {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 2rem;
    margin: 0;
    padding-left: 1.5em;
}

.event-presentation__guests li,
.event-presentation__empty {
    overflow-wrap: anywhere;
}

.event-presentation__empty {
    margin: 0;
}
</style>
