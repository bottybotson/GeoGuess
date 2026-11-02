# Versioned runtime and combined Rules proof

For issue #61. `rules.json` is the single candidate combining unversioned v1
and exact numeric formatVersion 2 events. It is a local test artifact; nothing
here deploys rules, migrates data, changes private test access or publishes a site.

Regenerate it with:

```sh
node tests/integration/event-runtime/generate-rules.cjs
```

The generator consumes the reviewed `event-round/rules.json` and
`event-session/rules.json` without editing either source. Every v1 read/write
grant requires absent formatVersion; every v2 grant requires numeric value 2.
Shared grants are explicitly ORed. Validation differing by protocol is likewise
guarded. There are no event/public ancestors or v2 round-container grants. The formatVersion leaf
is the sole universal public grant and remains unwritable. Unknown versions
therefore expose only that leaf and fail closed everywhere else.

The existing proof suites upload their own adjacent Rules fixture. To run their
original assertions against this candidate, `combined-only.cjs` redirects only
four explicit Rules file paths to the exact combined bytes. `run.cjs` computes
one SHA256 before spawning sequential suites and the preload verifies and
prints that digest in each child. `lobby-regression.cjs` narrowly extends the original isolated loader's allowed
pure dependencies with `./version`, retaining every original assertion. Other
file/source reads are unchanged. Every
child must actually consume the candidate. No deployed configuration or original
proof source is edited.

The runner retains the original admission assertions through their existing
one-round fixture adapter, the original SDK8 lobby/uncertain-admission proof,
the complete v1 round/timing proof, the real SDK8
timing-observer proof, and the complete v2 session proof (including 20-round,
50-player totals and six real uncertain-acknowledgement cases). `runtime.cjs`
adds side-by-side dispatch/admission/projection and cross-protocol attacks:
plausible legacy paths cannot authorize writes or reads on v2, v2 paths cannot
authorize v1, malformed/unknown formats fail closed, setup/version stay immutable,
50 of 51 actual SDK8 lobby clients join, stable rejoin survives every later phase,
and a signed-out presenter facade creates no identity and exposes only public
operations. An actual SDK8 named presenter runtime remains signed out while the
separate guest app is signed in, with a factory-time anonymous sign-in spy and
membership checks. SDK8 may internally initialize its Auth provider when creating
the database; application code does not request a user or call sign-in. Separate
direct probes verify private-read denial. The v2 `timing-observer.cjs` additionally
checks accepted/rejected offline deadline writes, shared acknowledgement barriers,
late recovery and signed-out public timing reads against the same candidate.

Use the existing isolated Node 24/Firebase CLI/Java tools documented in
`../event-admission/README.md`. Reserve exclusive local ports 9009/9099, then
from `/tmp` run:

```sh
env XDG_CONFIG_HOME=/workspace/.geoguess-emulator-tools/config \
  XDG_CACHE_HOME=/workspace/.cache \
  FIREBASE_EMULATORS_PATH=/workspace/.cache/firebase/emulators \
  CI=1 timeout --kill-after=10s 600s \
  /opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node \
  /workspace/.geoguess-emulator-tools/node_modules/firebase-tools/lib/bin/firebase.js \
  emulators:exec --only auth,database --project demo-geoguess-admission \
  --config /workspace/GeoGuess/tests/integration/event-runtime/firebase.json \
  '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node /workspace/GeoGuess/tests/integration/event-runtime/run.cjs'
```

Demo project and loopback guards run before provider initialization or disposable
fixture-account creation. Only the guarded children clear the SDK's problematic
loopback HTTP proxy forwarding. Each suite has a watchdog and retains clean SDK
sign-out/offline/app-delete cleanup. Failed, skipped, cancelled or timed-out
assertions are not passing evidence. Browser/phone networking, routed UI,
provider quotas and event rehearsal remain separate validation gates.

Verified 2026-11-02 against SHA256
`476b624d3011a31f393bd5283a9c22630cd87bf0a3f6478b56750b4486713ae1`:
**51/51 assertions passed**, zero failed, cancelled, skipped or todo. The complete
sequential run passed admission 10/10, SDK8 lobby 3/3, round/timing 21/21, v1 timing
observer 1/1, session 11/11, runtime 4/4 and v2 timing observer 1/1 (362.0 seconds of
suite time). The invocation exited 0 and stopped Database, Auth, hub and logging
cleanly. The checked-in runner includes all seven suites sequentially. The event
unit suites also passed, and independent synchronization/security
review found no remaining blocking findings.
