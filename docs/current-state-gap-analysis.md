# Fork baseline and requirements gap analysis

Reviewed: 2026-10-26. Repository: `bottybotson/GeoGuess`, upstream `GeoGuess/GeoGuess`. This is a **static source review**, not a successful deployment/load test. Requirements are in [event-requirements.md](event-requirements.md); work plan is in [implementation-roadmap.md](implementation-roadmap.md).

## Existing components worth reusing

- Vue 2.7 / Vuetify 2, Vuex, Firebase Realtime Database 8, Google Maps JavaScript and Street View; see `package.json`, `.env.dist`.
- Multiplayer rooms, nicknames, linkable `/room/:roomName`, player guesses, cumulative points, and a basic leaderboard: `src/store/modules/settings.store.js`, `src/pages/StreetView.vue`, `src/components/Maps.vue`, `src/components/game/LeaderboardContent.vue`.
- Distance scoring: `src/utils/game/score.js` and `src/components/Maps.vue`.
- Predefined ordered coordinates **in the single-player path**: `src/pages/Home.vue` passes `roundsPredefined`; `src/plugins/StreetViewService.js` reads them, but multiplayer `startGameMultiplayer` does not propagate an event-specific round list.
- Panorama orientation currently always resets to `heading: 270, pitch: 0`: `src/pages/StreetView.vue`, `setPosition()`.
- Some existing lobby and game-time UI: `src/components/dialogroom/card/CardRoomPlayerName.vue`, `CardRoomSettings.vue`.

## Gap table

| Req. | Current fork / verified observation | Status / necessary outcome |
| --- | --- | --- |
| R01 | Rooms and common game exist, but starting and advancing are coupled to players/first player; no dedicated independent host role. | **Partial** — explicit host-controlled lobby, round, reveal, next-round lifecycle. |
| R02 | `/room/:roomName` and nicknames exist, but QR rendering not found; README documents up to five friends. | **Partial** — QR and straightforward join flow; support/test max 50. |
| R03 | No venue/tutorial first-round semantics. Predefined locations exist only in current single-player path. | **Missing** — enforce fixed first location and intro-friendly host pacing. |
| R04 | Single-player preset coordinates; fixed `setPov({heading:270,pitch:0})`; nearest panorama selection can shift chosen position. | **Partial** — ordered multiplayer round data plus explicit POV/panorama handling and coverage checks. |
| R05 | Static `timeLimitation` read at round start; local `endTime`; no host mutation flow for live extend/pause. | **Missing** — shared authoritative round deadline/status, adjustable at runtime. |
| R06 | Pin-and-submit, score, map, mobile UX exist; timeout currently can generate a random guess. | **Partial** — simplify and evaluate accessibility; distinguish no-answer from arbitrary guess. |
| R07 | Firebase-backed leaderboard exists, and round result markers are drawn. UI is not a dedicated projected/presenter view. | **Partial** — controlled reveal plus clear cumulative standings and projector-safe view. |
| R08 | Existing room logic uses numeric `playerN` identifiers based on current number of children; readiness waits for exact room size; some `onDisconnect` and cleanup operations may conflict with disconnect/reconnect at scale. | **High-risk / unverified** — concurrency-safe joins, stable player identity, reconnection, idempotent submission, test at 50. |
| R09 | Requires Google key, Firebase settings, Maps API billing; deploy examples exist. | **Partial** — deployment and billing checklist, quotas, rules and multi-device rehearsal. |
| R10 | PWA and responsive interface exist, but no dedicated older-first-time-player interaction audit. | **Needs validation** — usability and readability. |
| R11 | Custom GeoJSON editor plus a hard-to-share URL-driven single-player coordinate preset. | **Partial** — simple event configuration and venue/POV validation. |
| R12 | No post-round personal media workflow identified. | **Deferred P2** — only after the core live experience works. |

## Technical findings to consider when designing solutions

1. The README advertises up to five friends. No verified 50-person capacity or load test; **do not equate a displayed size setting with scalability**.
2. In `settings.store.js`, `playerNumber = playerName.numChildren() + 1` is vulnerable to joins/rejoins colliding after disconnect. Use stable guest/session identifiers and transactional admission.
3. In `StreetView.vue`, host-as-player-one is overloaded: player 1 generates the round, `beforeDestroy` edits `active`, and the multiplayer round starts after an exact count of participating player nodes. A presenter must not be counted as a guessing participant.
4. In `Maps.vue`, round results are triggered when the guess count equals room size (or certain time-attack conditions). For slower users, move to explicit host close/reveal; no need to force a rapid guess or wait forever.
5. In `StreetView.vue`, each browser creates a local timer from a room value. A shared deadline or equivalent host-owned timing model is needed to extend the **current** round consistently.
6. `StreetViewService.js` looks up panoramas near predefined coordinates, not necessarily an exact panorama ID; add preview/validation to avoid unexpected views.
7. Event-specific room/round schema must be checked against Firebase database security rules before any release.
8. Legacy dependencies (Vue 2.7, Firebase JS SDK 8) are a maintenance risk, **not by themselves a reason to rewrite before the event**.

## Verification still needed

- Deploy and smoke-test the fork; no runtime behavior, mobile accessibility, actual Street View usage, or Firebase rules have been verified here.
- Check Maps API quotas, billing and real billable loads from a rehearsal. Creating one panorama object per guest/round is only a planning approximation.
- Inspect remaining settings/dialog code and tests when implementing each issue. Confirm network/network-resume behavior with real devices.
- Agree on concrete event setup (venue, selected panoramas, number of rounds, duration) during that feature's implementation.

## Decision

Keep the fork for now as a reusable baseline, but **do not extend its existing room protocol blindly**. First build a reproducible smoke test and specify a host-owned session state model. If the architecture makes 50-person operation more expensive than replacing the lobby/session layer, reassess before deep implementation.
