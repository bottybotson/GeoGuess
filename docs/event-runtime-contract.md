# Versioned event runtime

Issue #61 adds protocol dispatch and an additive v2 API. Pages remain on the
one-round v1 API until their separate integration. No live rules are deployed.
A later runtime deployment must include the reviewed combined Rules artifact:
older v1-only Rules do not grant the public formatVersion dispatch read.

`getEventLobbyClient()` retains `join(eventId,nickname)` and
`subscribe(eventId,onChange,onError) -> unsubscribe`. It also exposes
`getFormatVersion(eventId) -> Promise<1|2>`. Only the public `formatVersion` leaf
selects the adapter: null means v1, exact number 2 means v2; all other values
reject with `unsupported-format`. Inspection and subscriptions never request a
guest identity. A deliberate join restores the stable named guest Auth app and
atomically claims reciprocal participant/slot records. New v2 guests join only
the initial lobby; existing membership rejoins throughout all rounds/phases.

V1 lobby projection remains `{title,phase,participants:[{id,nickname}]}`. V2 adds
`{formatVersion:2,roundId,revision,roundCount,lastRevealedRoundId?}` and derives
phase/round/revision/last-reveal from one validated atomic state. Malformed
state/roster produces `phase:'unavailable'`; malformed/unknown version rejects.
Callbacks are invalidated before observer release on version changes/disposal.
Subscribers must call their returned unsubscribe when changing event/client.

`getEventSessionClient()` is the explicit v2 guest protocol, with signatures:

- `getState(eventId)` returns atomic `{phase,roundId,revision,lastRevealedRoundId?}`.
- `subscribeState(eventId,onChange,onError)` returns unsubscribe and emits the
  validated atomic state plus `roundCount` (no identity or private reads).
- `getClue(eventId,roundId)`, `getReveal(eventId,roundId)`,
  `getTiming(eventId,roundId)` read only published public leaves.
- `subscribeTiming(eventId,roundId,onChange,onError)` returns unsubscribe and
  emits `{timing,connected,offsetMs}` for that exact configured round. It reads
  public leaves and `.info` only, reports disconnected clocks safely, and waits
  for the shared raw-write acknowledgement barrier before confirming timing.
- `getServerTime(eventId)` returns `{nowMs,offsetMs}`.
- `getOwnGuess(eventId,roundId)`, `submitGuess(eventId,roundId,{lat,lng})`
  restore guest identity only when called.

`getEventHostClient()` retains separate password Auth, restoration/sign-in/out,
and legacy v1 methods. Its public `getFormatVersion(eventId)` reads the dispatch
leaf without restoring a user. `subscribeAuth(onChange,onError)` returns a
disposer for continuous organizer Auth user/null changes, including cross-tab
sign-out and account switches; it neither signs in nor initializes a guest.
Consumers invalidate cached private setup and pending callbacks when identity
changes. Disposal or provider error invalidates callbacks before releasing the
observer; `restore()` remains an independent one-shot operation. Its
**`session`** property exposes the same v2 API plus:

- `getHostSetup(eventId,roundId)` (organizer-only private configuration).
- `start/close/reveal/next/complete(eventId,expected)`.
- `setDeadline(eventId,expected,absoluteDeadlineMs)`.

Every host mutation requires the caller's displayed
`expected = {roundId,revision}`. Missing/malformed expected rejects with
`invalid-expected-state`; stale controls reject with `stale-state` unless the
original immutable artifact confirms that exact command already succeeded.
No facade refreshes/synthesizes/rebases expected state. Retry deadlines reuse the
same absolute target. Commands retain session.js's shared pending-write barrier
and original acknowledgement/retry semantics. `next` enters the configured next
round's `ready` state; a separate `start` publishes its clue. Final `complete`
preserves standings. Other protocol errors include `invalid-event-id`,
`invalid-round-id`, `invalid-phase`, `deadline-expired`, and `unavailable`.

`getEventRoundClient()` and legacy host commands are explicitly v1-only and
reject v2 with `unsupported-format`; they cannot accidentally operate on a newly
active v2 round. Use `host.session` for v2 host commands.

`getEventPresenterClient()` returns `{lobby,session,round}` on a separate named
public app. Application code never requests Auth, signs in, creates a guest
identity or claims a slot. SDK8 can initialize its internal Auth provider while
constructing a database connection; that SDK behavior does not invoke our guest
identity flow. The real-SDK proof checks a fresh public app remains signed out
without any anonymous sign-in or membership writes. Its session exposes only the
seven public read/subscription methods above: no guesses, setup or host controls. Its lobby exposes
only `subscribe` and `getFormatVersion`; it has no join operation. Database rules enforce
the public/private boundary independently of these JavaScript surfaces. Its v1-only
`round` exposes `getReveal`, `getTiming`, `getServerTime` and `subscribeTiming`;
these retain legacy signatures and reject v2. Guest runtime sessions expose only
public reads/subscriptions and own-guess operations; organizer controls and setup
are available through `host.session`.

Factory equivalents accept injected SDK/database dependencies for offline tests:
`createEventLobbyRuntime`, `createEventSessionRuntime`,
`createEventPresenterRuntime`, and `createHostClient`.

Verification (2026-11-02): all runtime event unit suites pass, including the existing v1/session
regressions and new dispatch/subscription/auth boundaries. The local combined
Rules proof passed 51/51 assertions with no failures, cancellations or skips,
including v1 admission/round/timing, v2 50-seat/20-round recurrence and all real
uncertain-acknowledgement cases, v2 timing observers and actual SDK8 public-app
isolation. All seven suites ran sequentially in one invocation, exited 0 and
shut down the emulators cleanly. Independent synchronization/security review
found no remaining blocking findings after phase-type and timing-round fixes. See
[the exact candidate and reproducible runner](../tests/integration/event-runtime/README.md)
for the artifact digest and suite evidence. Routed multi-round pages and real
browser/phone rehearsal remain outside this runtime slice.
