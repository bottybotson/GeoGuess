# Ordered rounds: bounded protocol proposal

For [#50](https://github.com/bottybotson/GeoGuess/issues/50), following merged
#47. This source-reviewed contract is **not implemented or emulator-verified**.
Keep Vue 2, Firebase SDK 8, exact panoramas, existing scoring and 50-slot admission.

## Version and data

Provision fresh events with immutable `public/formatVersion: 2`. Unversioned
single-`r1` events retain the v1 adapter and rules; never rewrite started events.
Unknown versions fail closed. Every v2 grant must require version `2`; combined
rules must explicitly exclude v2 events from v1 grants. Test that exact combined
file before any deployment. A new event is the replay/migration path.

Bound trusted configuration to 1–20 contiguous IDs `r01`–`r20`. Twenty is a
proposed implementation bound, not a product requirement or provider limit.
The setup validator checks the configured count and immutable previous/next links.

Retain `hostUid`, title and reciprocal immutable participant/slot records.

| Path | Contract |
| --- | --- |
| `public/roundCount` | Trusted integer 1–20; no locations. |
| `public/state` | Atomic `{phase,roundId,revision,lastRevealedRoundId?}`; initially `lobby`, `r01`, revision `0`. Omit last-revealed ID until reveal. |
| `private/rounds/<id>` | Immutable panorama/POV/answer/difficulty plus previous/next IDs where applicable. All future clues and answers remain private. |
| `private/guesses/<id>/<uid>` | Immutable first accepted guess; own-guest read or organizer read only. |
| `public/rounds/<id>/clue` | Immutable exact panorama/POV, first published at that round's start. |
| `public/rounds/<id>/timing` | Optional `{roundId,deadlineMs}`; current-round host extension only. Retain past timing. |
| `public/rounds/<id>/reveal` | Immutable `{roundId,answer,results}`, first published atomically with reveal. |

Each reveal contains all admitted UIDs and the existing result fields plus
`totalPoints`. There is **no separate mutable totals counter**. The standings are
the results at `state.lastRevealedRoundId`. Rules check:

- first round: `totalPoints == points`;
- later round: `totalPoints == previousRound.reveal.results[uid].totalPoints + points`.

Require canonical nickname/answer, integer points 0–5000, integer totals
0–100000, actual-guess answered shape and zero points/no distance for missed
answers. As in v1, the organizer is trusted to calculate Turf distance/points;
Rules enforce the exact cumulative recurrence, not geometry.

## Host progression, timing and retries

```text
lobby -> guessing -> closed -> reveal -> ready (configured next round)
                                         ready -> guessing -> closed -> reveal
                                         final reveal -> complete
```

The host can discuss a reveal indefinitely. `next` selects only the configured
successor and leaves it `ready`; a separate start publishes its clue. Nothing
automatically advances, closes or reveals. Complete preserves final standings.

Every phase change increments `state.revision` exactly once. Commands take an
explicit expected `{roundId,revision}` and submit that transition's next revision.
Rules check the old/new phase, configured round edge and exact revision increment.
Never rebase a stale browser command onto a newly active round. A malicious
organizer can still issue valid current controls: organizer authority is trusted.

Start atomically writes the exact clue and next state. Reveal atomically writes
one immutable reveal and state including last-revealed ID. Next/complete preserve
that ID. Commands validate their expected state before private reads/calculation;
server validation rejects a phase/round race at write time.

Confirm retries from the **original** immutable artifact: clue proves start;
reveal proves reveal/prior close; exact next-ready state or that successor's
published clue proves that particular advance. Otherwise return stale-state,
never silently target a refreshed round. Preserve the shared per-database/event
pending-write acknowledgement barrier across adapters and deadlines: Firebase 8
optimistic reads are not server confirmation.

Deadline commands carry expected round/revision and one absolute target, reused
on retry. Do not copy prior timing or add duration again. Rules independently
require the matching current round, guessing phase and `now < deadlineMs` for
first guesses. Expiry does not advance state. The host may deliberately extend
an expired current deadline to reopen time; old-round extension must fail.

## Rules and capacity gate

No event/public/round ancestor write grants, deletes, client setup/version changes
or membership mutation. New admission is only during the initial lobby; existing
UID membership persists through every round. Public leaf reads expose only state,
published clues/timing and published results, never future clues/answers or other
guests' active guesses.

Realtime Database Rules cannot loop or use `numChildren()` here. Reuse explicit
s01–s50 completeness checks on **one current reveal**. Each result needs only its
one prior immutable total, avoiding a 20-round sum or separate totals-write pass.
A missing prior result denies progression/reveal rather than treating it as zero.
Do not assume evaluation capacity: prove 50 answered/unanswered result publication
and round-20 recurrence, including omission of s50 and altered-total rejection,
against actual emulators with clean shutdown.

Current admission reads `public/phase`; current timing/view validators accept only
`r1`. They do not already support this schema. Version dispatch, v2 admission and
UI/configuration integration are explicit later tasks, gated on the proof PR.

## First implementation and review

One strong worker owns **only** new `src/event/session.js`, its focused unit spec,
and `tests/integration/event-session/**` (standalone candidate v2 rules/fixtures).
Leave v1 code/rules, runtime, UI and seed tooling unchanged. No live project,
provider calls or new backend service. Coordinate emulator ports with the lead.

Suggested API: `getState`, `getClue(eventId,roundId)`,
`getReveal(eventId,roundId)`, `getOwnGuess(eventId,roundId)`;
`start/close/reveal/next/complete(eventId,expectedState)`;
`setDeadline(eventId,expectedState,absoluteDeadlineMs)`; and guest submit with an
explicit round ID. Subscribe to one atomic state snapshot; use last-revealed ID
for standings. Settle exact result shapes in the proof before delegating UI.

First prove **two rounds/two guests**: start, submission/missed answer, reveal
pause, next-ready, next start, final reveal/completion and reconnect. Then cover
concurrent/duplicate reveal/next/complete, old-round close/deadline rejection,
hidden future data, wrong UID/provider, direct invalid writes/deletes, expiry,
accepted/rejected uncertain acknowledgements and the 50-seat/boundary cases.
Independent synchronization/security review gates integration. Later combined
rules must rerun v1 regressions; routed and real-device multi-round rehearsals
remain separate acceptance gates. This contract does not add pause/resume,
media, an editor framework or deployment.
