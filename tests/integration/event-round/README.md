# Isolated one-round protocol proof — issue #27

This candidate is local only. It does not deploy rules or change live resources,
legacy rooms, dependencies, admission fixtures, or event configuration. It uses
synthetic coordinates and a fictional panorama identifier; no Maps API is called.
The application source is `src/event/round.js`, loaded without reimplementing its
commands. Babel transforms only ES import/export; the repository's Firebase
8.10.1, Turf distance and existing getScore implementation execute unchanged.

Verified on 2026-10-27 with the command below: **14 round tests passed** in
125.8 seconds, followed by **all 10 original admission tests passed** against
the candidate rules in 3.0 seconds. Both suites had 0 failures, cancellations,
skips or todo tests. The combined command exited **0** and the Auth/Database
emulators shut down cleanly. The 8 focused unit tests and production ESLint
checks for the new application module/unit fixture also passed. These results
do not substitute for the independent security review.

The final targeted run also passed **3 tests** in 5.75 seconds, exit 0 with
clean shutdown: strengthened valid-payload host authorization checks, the
preserved 50-unanswered reveal, and a new 50-answered reveal. Every answered
guest submitted the canonical answer through the actual adapter and received
`answered:true, distance:0, points:5000`; repeated reveal preserved all results.
The full runner now contains 16 round cases plus the 10 admission regressions;
the added assertions were verified by this targeted run without repeating the
unchanged eight 15-second offline checks.

A subsequent public-reader target passed 1 test in 1.22 seconds, exit 0 with
clean shutdown. An actual signed-out SDK8 presenter read the clue and published
results without requesting identity or creating an anonymous user; private
reads and writes remained denied. The new public-read branch also passed the
8-test unit suite, including the shared acknowledgement barrier after timeout.

## Contract and boundaries

A trusted fixture creates a disposable email/password organizer in the **Auth
emulator**, then binds that actual UID to `events/fixture/hostUid` using the rules
fixture's privileged context. Other clients sign in anonymously against the Auth
emulator. There is no browser create-host/create-event permission. A password
sign-in token and the pinned UID are both required for host commands/private reads.
The fixture password/account are generated after safety guards, remain in memory,
and are not production credentials. Separate named apps isolate host and guests.

The immutable private `round` contains `id:'r1'`, `panoramaId`, `heading`, `pitch`,
`answer:{lat,lng}` and `difficulty`. Host start atomically publishes only the clue
and `guessing`; it requires at least one admitted guest. Since membership cannot
be deleted, the later reveal always has a nonempty `results` map (Realtime
Database omits empty objects). The client reports `no-participants` for an empty
lobby, and the server independently denies raw empty-lobby start writes.

Only ordered `lobby → guessing → closed → reveal` transitions are allowed. Guests
create exactly one own coordinate record during guessing; no overwrite, deletion,
extra properties or late submission is accepted. Host close locks all guesses.
Host reads the locked records and publishes exact configured answer plus one
result per participant, atomically with reveal. Unanswered participants receive
`answered:false, points:0` and **no distance property**. Answered distance is
floored Turf meters, scored with the existing getScore(distance,difficulty,0,
'normal'). There are no cumulative totals or score increments. The authenticated
host is the trusted scorer; Rules enforce canonical answer, complete membership,
answer/no-answer shape, nickname and immutable records, while the application
computes distances/points.

Realtime Database Rules do not have `numChildren()`. Completeness therefore uses
the existing fixed s01–s50 slot index: for every occupied slot its owner must
have a result; every result UID must be an admitted participant. The admission
protocol guarantees the reciprocal immutable membership/slot mapping. The proof
includes full 50-client unanswered and answered reveals and denies an otherwise
valid payload omitting s50's result, testing both result branches, the boundary
and Rules evaluation capacity.

Public reads target individual clue/reveal leaves, never the event/public root.
Only `getRound` and `getReveal` skip `identity.ensureUser()`, so a read-only
presenter does not authenticate or create an anonymous account. Both retain
identifier validation, the 15-second budget, pending-write acknowledgement
barrier and payload validation. They return null before the corresponding data
is published; canonical answer/results do not exist until atomic host reveal.
Guests read only their own accepted guess; host reads only the protected setup
and round guesses. No guest answer/other-guess/private ancestor read grant exists.
A signed-out presenter can read explicit public leaves and cannot write anything.

All commands/read methods use a 15-second budget. A module-level WeakMap retains
raw pending SDK writes per database/event across adapter instances and deadlines.
Reads wait for these acknowledgements and discard snapshots if another local
write begins while reading. Firebase 8 **both once() and get()** expose optimistic
queued state; neither serves as a server-acknowledgement barrier. Retries return
original accepted records and never report a rejected queued value as success.
This guard covers writes issued through this module, not arbitrary external SDK
writes made outside its command API. Reuse the same injected database object for
adapters sharing one SDK database singleton.

## Reproduce

Use the existing external tool installation, not the app's Node/dependency graph:
Firebase CLI 14.19.1, rules-unit-testing 4.0.1, tool Firebase 11.10.0, Node 24.19
and Java 21. See `../event-admission/README.md` for pinned emulator artifact size,
checksums, download provenance, and isolated dependency installation. No login,
service account or real provider is used. Node 20 remains the app runtime.

From `/tmp` (keeps generated emulator logs outside the checkout):

```sh
cd /tmp
env XDG_CONFIG_HOME=/workspace/.geoguess-emulator-tools/config \
  XDG_CACHE_HOME=/workspace/.cache \
  FIREBASE_EMULATORS_PATH=/workspace/.cache/firebase/emulators \
  CI=1 timeout --kill-after=10s 300s \
  /opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node \
  /workspace/.geoguess-emulator-tools/node_modules/firebase-tools/lib/bin/firebase.js \
  emulators:exec --only auth,database --project demo-geoguess-admission \
  --config /workspace/GeoGuess/tests/integration/event-round/firebase.json \
  '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node /workspace/GeoGuess/tests/integration/event-round/run.cjs'
```

The config's rules are inside its own directory, as required by the CLI. Reserve
ports 9009/9099 exclusively. The runner checks explicit demo project and loopback
Auth/Database hosts before provider initialization or fixture credential creation.
Only the guarded test children clear HTTP_PROXY/http_proxy for local SDK WebSocket
connections; the CLI retains normal proxy and verified downloads. The outer
watchdog bounds emulator startup/shutdown; each child also has a finite process
and test deadline. Timeout, cancellation and skipped checks are not passes.

`run.cjs` runs suites **sequentially** because both reset the same disposable DB:

- `round.cjs`: actual password host/anonymous guests, full lifecycle, range/schema
  rejection, private read boundaries, protected host/provider binding, ordered and
  atomic commands, every immutable record/deletion/ancestor defense, duplicate
  commands and same-UID guesses, observer-ordered close/guess race, empty-lobby
  guard, 50-client answered/unanswered reveals, and all four operations with real 15-second offline
  accepted/rejected acknowledgements across new adapters and their read methods.
  The unauthenticated public-reader case verifies no identity request/account
  creation, null before publication, canonical reveal afterwards and continued
  private/write denial.
- `admission-regression.cjs`: executes all original 10 admission tests/assertions
  against **these** candidate rules. Exact anchored transformations change fixture
  setup only: valid password organizer token, private round, atomic host starts,
  one supporting guest where start formerly had none, trusted non-lobby setup
  (including the new closed phase), and expected published clue in the presenter
  snapshot. No assertions are removed or weakened. Source drift fails closed.
  This preserves forced 51-client contention, exactly 50 admissions, guest 51
  rejection, reciprocal immutability, Unicode nickname boundaries and observer
  ordering without editing the original admission fixture.

Fixture cleanup explicitly signs out Auth before taking DB offline/deleting apps.
An initial implementation using app.delete alone passed its assertions but left
Firebase8 Auth teardown pending until the watchdog; it was treated as a failed
run, diagnosed, and corrected. No forced process exit hides unfinished cleanup.

This is an isolated Node SDK/emulator proof, not a browser/venue connectivity,
Google imagery, live deployment, production quota, full game timer, subsequent
round, cumulative ranking or event-readiness claim. The untimed single round is
this milestone only. Independent security review remains a separate launch gate.
