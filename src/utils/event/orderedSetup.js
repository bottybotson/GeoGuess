const MAX_ROUNDS = 20;
const MIN_ROUNDS = 1;

let nextLocalId = 1;

function createRound() {
    return {
        localId: `round-${nextLocalId++}`,
        panoramaId: '', heading: '', pitch: '', answerLat: '', answerLng: '', difficulty: '2000',
        confirmation: '',
    };
}

function confirmationKey(round) {
    return JSON.stringify([
        round.panoramaId, round.heading, round.pitch, round.answerLat, round.answerLng, round.difficulty,
    ]);
}

function isConfirmed(round) {
    return Boolean(round && round.confirmation && round.confirmation === confirmationKey(round));
}

function placeholder(value) {
    return typeof value === 'string' && /[<>]|^(?:YOUR_|CHANGE_?ME|REPLACE_)/i.test(value);
}

function strictNumber(value) {
    if (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return NaN;
    const number = Number(value);
    return Number.isFinite(number) ? number : NaN;
}

function roundValues(round) {
    const heading = strictNumber(round.heading);
    const pitch = strictNumber(round.pitch);
    const lat = strictNumber(round.answerLat);
    const lng = strictNumber(round.answerLng);
    const difficulty = strictNumber(round.difficulty);
    const panoramaId = round.panoramaId;
    const valid = typeof panoramaId === 'string' && panoramaId.length > 0 && panoramaId.length <= 512 &&
        panoramaId.trim() === panoramaId && !placeholder(panoramaId) &&
        Number.isFinite(heading) && heading >= 0 && heading < 360 &&
        Number.isFinite(pitch) && pitch >= -90 && pitch <= 90 &&
        Number.isFinite(lat) && lat >= -90 && lat <= 90 &&
        Number.isFinite(lng) && lng >= -180 && lng <= 180 &&
        Number.isFinite(difficulty) && difficulty > 0;
    return { valid, panoramaId, heading, pitch, lat, lng, difficulty };
}

function canAdd(rounds) { return rounds.length < MAX_ROUNDS; }
function canRemove(rounds) { return rounds.length > MIN_ROUNDS; }

function moveRound(rounds, index, direction) {
    const target = index + direction;
    if (target < 0 || target >= rounds.length) return rounds;
    const moved = rounds.slice();
    [moved[index], moved[target]] = [moved[target], moved[index]];
    return moved;
}

function removeRound(rounds, index) {
    if (!canRemove(rounds) || index < 0 || index >= rounds.length) return rounds;
    return rounds.filter((_, roundIndex) => roundIndex !== index);
}

function validTitle(title) {
    return typeof title === 'string' && title === title.trim() && Array.from(title).length >= 1 &&
        Array.from(title).length <= 120 && !placeholder(title);
}

function buildSeed({ projectId, databaseUrl, eventId, hostUid, title }, rows) {
    if (!Array.isArray(rows) || rows.length < MIN_ROUNDS || rows.length > MAX_ROUNDS || !validTitle(title)) return null;
    const rounds = {};
    for (let index = 0; index < rows.length; index++) {
        const row = rows[index];
        const values = roundValues(row);
        if (!values.valid || !isConfirmed(row)) return null;
        const id = `r${String(index + 1).padStart(2, '0')}`;
        const round = {
            id, panoramaId: values.panoramaId, heading: values.heading, pitch: values.pitch,
            answer: { lat: values.lat, lng: values.lng }, difficulty: values.difficulty,
        };
        if (index > 0) round.previousRoundId = `r${String(index).padStart(2, '0')}`;
        if (index < rows.length - 1) round.nextRoundId = `r${String(index + 2).padStart(2, '0')}`;
        rounds[id] = round;
    }
    try {
        const url = new URL(databaseUrl);
        return {
            projectId, databaseUrl: url.origin, eventId,
            event: {
                hostUid,
                public: {
                    title, formatVersion: 2, roundCount: rows.length,
                    state: { phase: 'lobby', roundId: 'r01', revision: 0 },
                },
                private: { rounds },
            },
        };
    } catch (error) {
        return null;
    }
}

module.exports = {
    MAX_ROUNDS, MIN_ROUNDS, createRound, confirmationKey, isConfirmed, roundValues,
    canAdd, canRemove, moveRound, removeRound, buildSeed,
};
