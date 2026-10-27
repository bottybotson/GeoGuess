# Isolated admission feasibility proof — issue #17

This fixture is an experiment, not deployed rules or an application adapter. It
does not modify legacy rooms, manifests or live Firebase resources. **Current
result: not validated.** On 2026-10-27 the real emulator command below reached
the official database-emulator download and exited 1 with `403: Domain forbidden`
for `storage.googleapis.com`. Rules compilation and all 10 test cases remain
unrun. Do not begin adapter implementation or claim the candidate is secure on
the strength of these files.

Captured failure (no rule evaluation or TAP test results followed):

```text
i  emulators: Starting emulators: database
i  emulators: Detected demo project ID "demo-geoguess-admission"
i  database: downloading firebase-database-emulator-v4.11.2.jar...
i  emulators: Shutting down emulators.
Error: download failed, status 403: Domain forbidden
```

Local checks completed: Node syntax check passed; both JSON files parsed; the
config's loopback port and denied root grants were checked; executing without
the emulator host and executing with a different project each exited 1 at the
guard before Firebase initialization (expected). These are configuration/safety
checks, **not** Rules compilation, security or concurrency results. Integration
test outcome remains **0 executed / 10 unrun**, pending the official download.

## Tools and network

Install tools outside the checkout (no project dependency/lockfile changes):

```sh
npm install --prefix /workspace/.geoguess-emulator-tools --no-audit --no-fund \
  firebase-tools@14.19.1 @firebase/rules-unit-testing@4.0.1 firebase@11.10.0
```

The application remains on its pinned Node 20.14 runtime. Use Node 24.19 for
these isolated tools: currently resolved Firebase CLI transitive dependencies
include packages requiring Node >=22. Java 21 is required in PATH. The current
cloud image's Node 24 executable is shown below; substitute your Node 24 path on
another machine. The dependencies are intentionally separate from the app's
Firebase 8 dependency graph. No Firebase login, provider credentials, service
account or Auth emulator is needed: rules-unit-testing injects authenticated
contexts into the database emulator.

Required setup destinations are `registry.npmjs.org` (npm packages) and
`storage.googleapis.com` (official emulator JAR). CLI remote-config/MOTD network
checks may warn; they are not used by this test. The selected project is the
nonproduction ID `demo-geoguess-admission`. Emulator runtime uses only
`127.0.0.1:9009` for database access. The runner rejects a missing/different
`FIREBASE_DATABASE_EMULATOR_HOST` or a missing/different `GCLOUD_PROJECT` before
initializing any Firebase app. Firebase CLI also starts local hub/logging
processes; the emulator UI is disabled.

CLI 14.19.1 pins Database Emulator **4.11.2**, downloaded from:

```text
https://storage.googleapis.com/firebase-preview-drop/emulator/firebase-database-emulator-v4.11.2.jar
size:   34495935 bytes
MD5:    2fd771101c0e1f7898c04c9204f2ce63
SHA256: b70d99344caf17c98b6f910fa8f6edf32a7c016cb1035e8915f70d38901eb97f
```

Those values come from the installed CLI's
`lib/emulator/downloadableEmulatorInfo.json`. Its downloader checks size and
MD5 before caching. Preserve those checks and TLS verification. After download,
the SHA256 can also be checked with `sha256sum` against the value above.

## Reproduce

Run from `/tmp` to keep emulator logs/generated files outside the checkout.
The CLI resolves the rules relative to `firebase.json` and injects the database
emulator host into its child test process. `NODE_PATH` resolves the isolated
dependencies without changing the app dependency graph.

```sh
cd /tmp
env XDG_CONFIG_HOME=/workspace/.geoguess-emulator-tools/config \
  XDG_CACHE_HOME=/workspace/.cache \
  FIREBASE_EMULATORS_PATH=/workspace/.cache/firebase/emulators \
  CI=1 NODE_PATH=/workspace/.geoguess-emulator-tools/node_modules \
  timeout --kill-after=10s 240s \
  /opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node \
  /workspace/.geoguess-emulator-tools/node_modules/firebase-tools/lib/bin/firebase.js \
  emulators:exec --only database --project demo-geoguess-admission \
  --config /workspace/GeoGuess/tests/integration/event-admission/firebase.json \
  '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node --test --test-timeout=180000 /workspace/GeoGuess/tests/integration/event-admission/admission.cjs'
```

`admission.cjs` is an executable Node test entry point. It is intentionally
excluded from the app's Jest/unit workflow. Its exit status and TAP counts must
be preserved when capturing results. Successful syntax parsing (`node --check`)
is not successful emulator validation.
The outer 240-second watchdog also bounds CLI download/startup/shutdown hangs;
an exit status of 124 is a timeout failure. The Node test runner uses a
180-second test timeout. Listener readiness and the
independent race observer's final-state barrier each have explicit 10-second
timeouts; a timeout is a failed check, never a passed or skipped result.

## Candidate and attempted checks

Trusted setup seeds `/events/fixture/hostUid`, the public title/phase, and private
setup/answers/guesses with `withSecurityRulesDisabled`. Clients cannot provision
or replace the host. The host can write only the existing public phase leaf.
This experiment does not implement host authentication/recovery, phase-transition
policy, auth-provider setup, production quotas or real-device readiness.

An admission atomically creates:

```text
/events/fixture/public/participants/<authenticated UID> = {slot, nickname}
/events/fixture/public/slots/s01 … s50 = <same authenticated UID>
```

Each leaf independently authorizes creation in an existing lobby and validates
the reciprocal merged state through `newData.parent()`. There is no event,
public, participants or slots ancestor write grant. Memberships/slots cannot be
overwritten or deleted, even by their owners or the host. A rejoin reads the
existing immutable membership; repeating the write is rejected. No disconnect
deletion is installed. Slot contention is retried in a disposable test helper,
which is not an approved application adapter.

Only `public/title`, `public/phase`, `public/participants` and `public/slots` are
readable. Presenter subscriptions target the first three independently, never
the event/public root. Slots are public for admission conflict discovery. Private
setup/answers/guesses and host UID are unreadable by guests and unauthenticated
presenters. There is no application presenter implementation in this fixture.

The 10 substantive test cases cover reciprocal merged writes; immutable and
read-only rejoins; 51 independent concurrent authenticated clients with exactly
50 seats; same-UID competing joins; host exclusion/protection; all non-lobby
phases; forged identities/orphans/extras/multiple seats/invalid slots/ancestor
writes; deletion and overwrite of owner/other records; join versus host start
with authoritative observer ordering; public-only listener disposal without
writes; and 20-code-point emoji/combining-mark/whitespace nickname boundaries.

The Unicode regex is a hypothesis until the actual emulator accepts/rejects
the explicit boundary cases. In particular, do not replace code points with
UTF-16 `.length`, omit the 20-emoji case, weaken assertions, or infer Rules
features from client SDK methods. If any required invariant fails, preserve the
smallest failing input and stop adapter work; a trusted-backend alternative
requires a separate concrete proposal. Independent security review is required
after actual emulator execution and before treating the protocol as validated.
