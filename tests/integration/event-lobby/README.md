# Routed lobby browser check

This checks the actual Vue application with Firebase 8, local Auth/Database
emulators and three isolated Chromium contexts. It does not deploy rules or
enable providers in a real project. All external browser HTTP/WebSocket traffic
is rejected by the test; only the demo project and loopback endpoints are used.

In the cloud checkout, start a dedicated development server:

```bash
. /workspace/.geoguess-tools/env.sh
VUE_APP_EVENT_EMULATORS=true npm run serve -- --host 127.0.0.1 --port 8087
```

This explicit emulator mode refuses production builds or non-loopback hosts.
It uses a separate named guest app; no actual project credentials are needed
for this lobby fixture. Wait for successful compilation, then in another shell:

```bash
cd /tmp
env XDG_CONFIG_HOME=/workspace/.geoguess-emulator-tools/config \
  XDG_CACHE_HOME=/workspace/.cache \
  FIREBASE_EMULATORS_PATH=/workspace/.cache/firebase/emulators CI=1 \
  timeout --kill-after=10s 240s \
  /opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node \
  /workspace/.geoguess-emulator-tools/node_modules/firebase-tools/lib/bin/firebase.js \
  emulators:exec --only auth,database --project demo-geoguess-admission \
  --config /workspace/GeoGuess/tests/integration/firebase.lobby.json \
  '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node --test --test-timeout=120000 /workspace/GeoGuess/tests/integration/event-lobby/browser.cjs'
```

Use the pinned external tools documented in the admission fixture and the
installed Chromium/Playwright. Run one emulator suite at a time: fixtures reset
the shared disposable database. The test rejects other projects/endpoints and
clears the Node SDK's proxy settings only after those guards, inside its local
test child. The CLI retains normal TLS/proxy/artifact verification.

The current check passed **1 substantive browser scenario**: two guests join
by nickname, the presenter updates without anonymous signup, the public join
URL excludes an admin-looking query parameter, reload restores the same guest
identity/membership, and closing a guest page preserves both memberships. A
narrow viewport has no horizontal overflow. These are browser contexts in a
local emulator test, not real phones, a 50-device rehearsal or a public site.

## One-round browser check

The candidate also supplies `/event/:eventId/host`, plus guessing and results on
the guest and presentation routes. The host uses a separate named Firebase app,
so signing in cannot replace a guest identity in the same browser.

With the development server above compiled, run the same emulator command with
`--config /workspace/GeoGuess/tests/integration/firebase.round-browser.json`
and replace `browser.cjs` with `round-browser.cjs`. Do not run both suites at
once. This fixture creates an ephemeral password organizer and trusted event
inside the demo emulators; it does not create a usable live organizer or event.

The scenario signs in the host, joins two guests, starts a round, initializes a two-minute timer, extends it by exactly one
minute while both guests and the presenter observe it, submits two pins, restores an accepted guess after reload, closes guesses and
reveals distance/points on guest and presenter pages. It checks host/guest
identity isolation, no presenter anonymous signup, exact panorama/POV arguments,
and narrow-screen overflow. Google widgets are synthetic and all external
traffic is blocked: this proves application wiring, not live imagery or API
billing/restrictions. The fictional panorama is deliberately unsuitable for a
real Street View demonstration.

Actual deployment still requires reviewed live rules, a durable organizer and
trusted event seed, provider setup, a valid curated panorama, Maps restrictions
and a hosting decision. This prototype has one round, initially untimed; the host can start a timer
and extend it while guessing. Subsequent rounds and cumulative rankings remain
separate requirements. See
[the protocol proof](../event-round/README.md) for server boundaries and the
independent 50-client admission/scoring checks.

Verified on 2026-10-29: the routed timing scenario passed in 14.1 seconds, exit
0 with clean Auth/Database emulator shutdown. It uses real local Firebase
services and synthetic Google widgets; it does not verify live imagery.
