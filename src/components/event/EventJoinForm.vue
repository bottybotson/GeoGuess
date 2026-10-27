<template>
    <section class="event-join" aria-labelledby="event-join-title">
        <h1 id="event-join-title" class="event-join__title">Join the game</h1>
        <p id="event-join-instructions" class="event-join__instructions">
            Choose a nickname with 1–20 characters. No account is needed.
        </p>

        <form class="event-join__form" @submit.prevent="submit">
            <label class="event-join__label" for="event-join-nickname">Nickname</label>
            <input
                id="event-join-nickname"
                v-model="nickname"
                class="event-join__input"
                type="text"
                name="nickname"
                autocomplete="nickname"
                :disabled="controlsDisabled"
                :aria-describedby="'event-join-instructions event-join-count'"
            >
            <p id="event-join-count" class="event-join__count" aria-live="off">
                {{ nicknameLength }} of 20 characters
            </p>
            <button
                class="event-join__button"
                type="submit"
                :disabled="controlsDisabled || !isNicknameValid"
                @click.prevent="submit"
            >
                Join
            </button>
        </form>

        <p class="event-join__status" role="status" aria-live="polite">
            {{ statusMessage }}
        </p>
    </section>
</template>

<script>
const KNOWN_STATES = ['idle', 'joining', 'joined', 'full', 'started', 'error'];

export default {
    name: 'EventJoinForm',
    inheritAttrs: false,
    props: {
        state: {
            type: String,
            default: 'idle',
        },
    },
    data() {
        return {
            nickname: '',
            hasSubmitted: false,
        };
    },
    computed: {
        isKnownState() {
            return KNOWN_STATES.indexOf(this.state) !== -1;
        },
        isEditable() {
            return this.state === 'idle' || this.state === 'error';
        },
        controlsDisabled() {
            return !this.isEditable || this.hasSubmitted;
        },
        trimmedNickname() {
            return this.nickname.trim();
        },
        nicknameLength() {
            return Array.from(this.trimmedNickname).length;
        },
        isNicknameValid() {
            return this.nicknameLength >= 1 && this.nicknameLength <= 20;
        },
        statusMessage() {
            if (!this.isKnownState) return 'Joining is unavailable right now.';

            switch (this.state) {
                case 'joining':
                    return 'Joining the lobby. Please wait.';
                case 'joined':
                    return 'You’re in the lobby. Please wait for the host.';
                case 'full':
                    return 'This lobby is full. Please ask the host for help.';
                case 'started':
                    return 'The game has already started. Please ask the host for help.';
                case 'error':
                    return 'We couldn’t join just now. Check your connection and try again.';
                default:
                    return 'Enter a nickname and join when you’re ready.';
            }
        },
    },
    watch: {
        state(nextState) {
            if (nextState === 'idle' || nextState === 'error') {
                this.hasSubmitted = false;
            }
        },
    },
    methods: {
        submit() {
            if (!this.isEditable || this.hasSubmitted || !this.isNicknameValid) return;

            this.hasSubmitted = true;
            this.$emit('join', { nickname: this.trimmedNickname });
        },
    },
};
</script>

<style scoped>
.event-join {
    box-sizing: border-box;
    width: 100%;
    max-width: 34rem;
    margin: 0 auto;
    padding: clamp(1rem, 5vw, 2rem);
    color: #10263d;
    font-family: Arial, sans-serif;
    font-size: 1.125rem;
    line-height: 1.5;
}

.event-join *,
.event-join *::before,
.event-join *::after {
    box-sizing: border-box;
}

.event-join__title {
    margin: 0 0 0.5rem;
    font-size: clamp(1.75rem, 7vw, 2.25rem);
    line-height: 1.2;
}

.event-join__instructions {
    margin: 0 0 1.5rem;
}

.event-join__form {
    display: grid;
    gap: 0.5rem;
}

.event-join__label {
    font-weight: 700;
}

.event-join__input,
.event-join__button {
    width: 100%;
    min-height: 48px;
    border: 2px solid #385873;
    border-radius: 0.4rem;
    font: inherit;
}

.event-join__input {
    padding: 0.5rem 0.75rem;
    color: #10263d;
    background: #fff;
}

.event-join__input:focus-visible,
.event-join__button:focus-visible {
    outline: 3px solid #075fa8;
    outline-offset: 3px;
}

.event-join__input:disabled {
    color: #43596b;
    background: #edf1f4;
    opacity: 1;
}

.event-join__count {
    margin: 0 0 0.5rem;
    color: #344b5e;
    font-size: 1rem;
}

.event-join__button {
    padding: 0.5rem 1rem;
    border-color: #07528a;
    color: #fff;
    background: #07528a;
    font-weight: 700;
    cursor: pointer;
}

.event-join__button:disabled {
    border-color: #687987;
    color: #fff;
    background: #687987;
    cursor: not-allowed;
}

.event-join__status {
    min-height: 3rem;
    margin: 1rem 0 0;
    font-weight: 700;
}
</style>
