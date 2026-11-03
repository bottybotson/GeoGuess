import {
    MAX_ROUNDS, createRound, confirmationKey, isConfirmed, roundValues,
    canAdd, canRemove, moveRound, removeRound, buildSeed,
} from '@/utils/event/orderedSetup';

const { validate } = require('../../../scripts/event-setup/core.cjs');

const originalStructuredClone = global.structuredClone;
beforeAll(() => {
    global.structuredClone = value => JSON.parse(JSON.stringify(value));
});
afterAll(() => {
    if (originalStructuredClone) global.structuredClone = originalStructuredClone;
    else delete global.structuredClone;
});

const eventDetails = {
    projectId: 'party-project', databaseUrl: 'https://party-project.firebaseio.com',
    eventId: 'birthday', hostUid: 'existing-host-uid', title: 'Birthday game',
};

function validRow(index) {
    const row = {
        ...createRound(), panoramaId: `curated-pano-${index}`, heading: String(30 + index), pitch: '-4',
        answerLat: String(10 + index), answerLng: String(20 + index), difficulty: '2000',
    };
    row.confirmation = confirmationKey(row);
    return row;
}

function trustedValidate(seed) {
    return validate(seed, { projectId: seed.projectId, databaseUrl: seed.databaseUrl, eventId: seed.eventId });
}

describe('ordered setup pure model', () => {
    it.each([1, 2, 20])('builds a format 2 seed accepted by the reviewed validator for %i rounds', count => {
        const rows = Array.from({ length: count }, (_, index) => validRow(index + 1));
        const seed = buildSeed(eventDetails, rows);
        expect(trustedValidate(JSON.parse(JSON.stringify(seed)))).toEqual(seed);
        const rounds = seed.event.private.rounds;
        expect(seed.event.public).toEqual({
            title: 'Birthday game', formatVersion: 2, roundCount: count,
            state: { phase: 'lobby', roundId: 'r01', revision: 0 },
        });
        expect(Object.keys(rounds)).toHaveLength(count);
        expect(rounds.r01.id).toBe('r01');
        expect(rounds.r01.previousRoundId).toBeUndefined();
        expect(rounds[`r${String(count).padStart(2, '0')}`].nextRoundId).toBeUndefined();
        for (let index = 0; index < count; index++) {
            const id = `r${String(index + 1).padStart(2, '0')}`;
            if (index > 0) expect(rounds[id].previousRoundId).toBe(`r${String(index).padStart(2, '0')}`);
            if (index < count - 1) expect(rounds[id].nextRoundId).toBe(`r${String(index + 2).padStart(2, '0')}`);
        }
    });

    it('rejects missing confirmation, stale panorama/answer confirmation, and malformed values', () => {
        const row = validRow(1);
        expect(buildSeed(eventDetails, [{ ...row, confirmation: '' }])).toBeNull();
        const changedPanorama = { ...row, panoramaId: 'different-pano' };
        expect(isConfirmed(changedPanorama)).toBe(false);
        expect(buildSeed(eventDetails, [changedPanorama])).toBeNull();
        const changedAnswer = { ...row, answerLat: '12' };
        expect(isConfirmed(changedAnswer)).toBe(false);
        expect(buildSeed(eventDetails, [changedAnswer])).toBeNull();
        const changedDifficulty = { ...row, difficulty: '2500' };
        expect(isConfirmed(changedDifficulty)).toBe(false);
        expect(buildSeed(eventDetails, [changedDifficulty])).toBeNull();
        expect(buildSeed(eventDetails, [{ ...row, pitch: '91' }])).toBeNull();
        expect(buildSeed(eventDetails, [{ ...row, panoramaId: ' REPLACE_ME ' }])).toBeNull();
        expect(roundValues({ ...row, heading: '0x10' }).valid).toBe(false);
        expect(() => trustedValidate({ ...buildSeed(eventDetails, [row]), event: { ...buildSeed(eventDetails, [row]).event, private: { rounds: { r01: { bad: true } } } } })).toThrow();
    });

    it('keeps confirmation with row identity through reorder and regenerates canonical links', () => {
        const first = validRow(1);
        const second = validRow(2);
        const moved = moveRound([first, second], 0, 1);
        expect(moved.map(row => row.localId)).toEqual([second.localId, first.localId]);
        expect(moved.every(isConfirmed)).toBe(true);
        const seed = buildSeed(eventDetails, moved);
        expect(seed.event.private.rounds.r01.panoramaId).toBe('curated-pano-2');
        expect(seed.event.private.rounds.r01.nextRoundId).toBe('r02');
        expect(seed.event.private.rounds.r02.previousRoundId).toBe('r01');
        expect(trustedValidate(seed)).toEqual(seed);
    });

    it('removes a row cleanly and enforces the 1–20 row bounds', () => {
        const first = validRow(1);
        const second = validRow(2);
        expect(removeRound([first, second], 0)).toEqual([second]);
        expect(removeRound([first], 0)).toEqual([first]);
        expect(canRemove([first])).toBe(false);
        expect(canAdd(Array.from({ length: MAX_ROUNDS }, validRow))).toBe(false);
        expect(canAdd([first])).toBe(true);
    });
});
