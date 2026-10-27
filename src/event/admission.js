const MAX_GUESTS = 50;

const PHASES = new Set(['lobby', 'guessing', 'reveal', 'complete']);
const IDENTITY_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

const isIdentity = value => typeof value === 'string' && IDENTITY_PATTERN.test(value);

const codePointLength = value => Array.from(value).length;

const isTrimmedNickname = value =>
    typeof value === 'string' &&
    value === value.trim() &&
    codePointLength(value) >= 1 &&
    codePointLength(value) <= 20;

const isValidState = state => {
    if (!isRecord(state)) return false;
    if (!hasOwn(state, 'hostUid') || !isIdentity(state.hostUid)) return false;
    if (!hasOwn(state, 'phase') || !PHASES.has(state.phase)) return false;
    if (!hasOwn(state, 'participants') || !isRecord(state.participants)) return false;

    const participantUids = Object.keys(state.participants);
    if (participantUids.length > MAX_GUESTS) return false;

    return participantUids.every(uid => {
        const participant = state.participants[uid];
        return (
            isIdentity(uid) &&
            uid !== state.hostUid &&
            isRecord(participant) &&
            hasOwn(participant, 'nickname') &&
            isTrimmedNickname(participant.nickname)
        );
    });
};

const invalid = status => ({ status, nextState: null });

/**
 * Plan an immutable guest admission decision for a caller-supplied lobby state.
 * This policy assumes the caller has already authenticated the requested UID.
 */
export function planAdmission(state, request) {
    if (!isValidState(state) || !isRecord(request) || !hasOwn(request, 'uid') || !isIdentity(request.uid)) {
        return invalid('invalid');
    }

    const { uid } = request;

    if (uid === state.hostUid) return invalid('host');

    if (hasOwn(state.participants, uid)) return { status: 'rejoined', nextState: state };

    if (state.phase !== 'lobby') return invalid('started');

    if (!hasOwn(request, 'nickname') || typeof request.nickname !== 'string') return invalid('invalid');

    const nickname = request.nickname.trim();
    if (!isTrimmedNickname(nickname)) return invalid('invalid');

    if (Object.keys(state.participants).length >= MAX_GUESTS) return invalid('full');

    const participants = { ...state.participants, [uid]: { nickname } };
    return { status: 'joined', nextState: { ...state, participants } };
}

export { MAX_GUESTS };
