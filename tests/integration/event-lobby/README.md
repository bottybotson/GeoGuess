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

Actual deployment still requires reviewed event rules, a durable organizer
identity, provider setup, Maps restrictions and the host-led round flow. The
current routes are `/event/:eventId/join` and `/event/:eventId/present`; they
only present the lobby. The host app will use a separate named instance so its
email/password session cannot replace a guest in the same browser.
