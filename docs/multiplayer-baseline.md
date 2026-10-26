# Existing multiplayer protocol: B01 source audit

Source reviewed at baseline commit `a2cb1ab60fe9be80e1da24ed6d99bcd473882f22`. This is source evidence, not successful real-provider execution or a new event schema. See [#1](https://github.com/bottybotson/GeoGuess/issues/1) and the [development runbook](development-baseline.md).

## Storage and lifecycle

Firebase data lives directly at `/{roomName}`, without a `rooms/` namespace (`src/store/modules/settings.store.js:66`). Its principal nodes are:

| Node | Existing meaning/writer |
| --- | --- |
| `createdAt`, `started`, `size` | Creation timestamp, start flag, mutable participant count; lobby writes these |
| `playerName/playerN` | Nickname and implicit player identity; `N` is child count plus one |
| Settings fields, `timeLimitation`, `difficulty`, optional `bboxObj` | Lobby settings copied into room state |
| `active` | Existence used as session-alive flag; each multiplayer browser writes/removes it |
| `streetView/roundN` | Player 1 publishes exact coordinates, round info, warning, optional area |
| `roundN/playerN` | Initially readiness value `0`, later guess result with coordinates/area, distance, points and elapsed time |
| `guess/playerN` | Shared current-round guesses, removed by result listeners |
| `finalScore/playerN`, `finalPoints/playerN` | Client-written cumulative distance/points |
| `trigger/playerN`, `isGameDone/playerN` | Local progression/completion signals |

1. `/room/:roomName` mounts Home and the room dialog. `SETTINGS_SET_ROOM` reads `started`, calculates identity from `playerName.numChildren() + 1`, registers nickname deletion on disconnect, and writes the name (`settings.store.js:74–141`). There is no guest authentication flow.
2. Player 1 configures the game and starts once at least two players are present (`CardRoomPlayerName.vue:63`). `startGame` writes `size` and `started`; peers enter when their room listener sees `size` and `streetView` (`settings.store.js:237,292`). Role and room identity travel in transient route props.
3. Player 1 chooses a panorama and writes the answer. Every multiplayer browser writes `active:true`, creates its round readiness child, and waits until the round child count equals `size` (`StreetView.vue:344–450,504`). There is no authoritative current-round field.
4. Each submission calculates points locally, writes the result and cumulative totals independently, then writes the shared guess (`Maps.vue:447,504,528`; `StreetView.vue:637`). UI guards are the duplicate protection; no immutable accepted-guess record enforces idempotency.
5. Every browser watches the whole room. Guess count matching `size` (or the time-attack condition) causes result display; listeners draw other guesses and remove the shared guess node (`Maps.vue:277–405`). There is no host-controlled close/reveal boundary.
6. Next-round progress is local: player 1 loads another panorama and peers click Next when available (`Maps.vue:248,407`; `StreetView.vue:673`). Timers use local clocks, and `initTimer` selects the earlier end, preventing a straightforward live extension (`StreetView.vue:587`). Timeout manufactures a random guess (`:611`).
7. Completion can delete the room when done count equals `size` (`Maps.vue:580`; `StreetView.vue:454`). Any multiplayer page unmount removes shared `active`; peers detecting this exit and remove the room (`StreetView.vue:486,716`). Disconnect handlers also update `size` from stale snapshots (`Maps.vue:280`).

## Confirmed source risks and work owners

| Risk | Consequence | Follow-up |
| --- | --- | --- |
| Count-derived IDs, nontransactional joins and holes | Simultaneous joins or a departed guest can cause another player's record to be overwritten | [#2](https://github.com/bottybotson/GeoGuess/issues/2) |
| Guest unmount removes `active`; no persistent identity | Guest departure/refresh can destroy a session, with no verified resume | [#2](https://github.com/bottybotson/GeoGuess/issues/2) |
| Whole-room listeners download answers/guesses early | UI hiding is not a reveal or access boundary | [#2](https://github.com/bottybotson/GeoGuess/issues/2), [#6](https://github.com/bottybotson/GeoGuess/issues/6) |
| Independent, mutable result/total writes | Duplicate submissions, result-listener races and refresh can disagree about scores | [#2](https://github.com/bottybotson/GeoGuess/issues/2), [#6](https://github.com/bottybotson/GeoGuess/issues/6) |
| Local round/deadline; random timeout guess | Clients can disagree about progress; a non-answer can earn lucky points | [#4](https://github.com/bottybotson/GeoGuess/issues/4) |
| Lobby cancellation uses `this.playerNumber` rather than `state.playerNumber` | A nonfirst guest can leave a stale nickname (`settings.store.js:206`) | [#2](https://github.com/bottybotson/GeoGuess/issues/2) |
| Root-wide cleanup deletes nodes without `createdAt` | A new namespace or unrelated project data can be removed | [#1](https://github.com/bottybotson/GeoGuess/issues/1), [#2](https://github.com/bottybotson/GeoGuess/issues/2) |
| No tracked database rules or auth setup | Actual deployment permissions and role enforcement are unverified | [#1](https://github.com/bottybotson/GeoGuess/issues/1), [#2](https://github.com/bottybotson/GeoGuess/issues/2) |

The source risks above are not evidence that deployed Firebase rules permit every write. Those rules must be inspected separately. Existing Cypress multiplayer tests synthesize a second player with direct database writes; they do not validate two real clients or event-scale operation.

## Next architecture boundary, subject to B02 validation

Retain Vue 2, Firebase 8 and Street View, and keep legacy routes intact while building the host-led event path. Put subscriptions and explicit commands behind a small event service/store, with an explicit round ID, phase and shared deadline. Treat the admin, guest and read-only presenter as different consumers, with Firebase-enforced permissions. Route names and hidden buttons alone do not establish those permissions.

Prefer separate admin and presentation URLs; exact route names are deferred to the B02 slice. The presentation page must never join `participants` or mount `StreetView.vue`, `Maps.vue`, or the legacy room dialog, because those components perform shared-state writes and cleanup. Reuse pure rendering components only. Presenter navigation/refresh must not advance, score or delete a session.

Before implementing the rest of gameplay, prove a vertical lobby slice with host identity, stable guest identity across reconnects, transactional admission up to 50, guest 51 rejection, and a passive presenter. Define active-game join policy and test access rules in an emulator. Do not publish new Firebase rules or treat any proposed event schema as validated before those checks exist.
