# Isolated admission feasibility proof — issue #17

This fixture is an experiment, not deployed rules or an application adapter. It
does not modify legacy rooms, manifests or live Firebase resources. The real
Database Emulator 4.11.2 compiled the rules and executed **10 tests: 10 passed,
0 failed, 0 skipped**, on 2026-10-27; the command exited 0 and shut down cleanly.
The checks include exactly 50 admitted memberships/slots from 51 independent
authenticated clients, with forced initial slot contention. Strong independent
security review is still required before proceeding to an application adapter.
The final documented watchdog command completed in 6263 ms of test-runner time
with 0 cancelled/todo tests. The 51 clients are separate authenticated Firebase
SDK contexts in one Node process; browser and venue rehearsals remain separate.

The initial `storage.googleapis.com` HTTP 403 was resolved by publishing the
required network setting. The official JAR was then downloaded with the CLI's
size/checksum checks and its SHA256 independently verified against the pinned
metadata below. Earlier fixture failures were corrected before the passing run:
the emulator's whitespace-regex datatype failed to load; regex Unicode escapes
did not mean the intended characters; and `NODE_PATH` alone selected the app's
Firebase 8 package. The final fixture retains the original security and Unicode
boundary assertions and uses explicit character ranges, string boundary checks
and absolute dependency resolution.

Node syntax/JSON checks and fail-closed host/project guards also passed. These
are separate from the real emulator results and do not replace them.

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
After these safety guards, the test child clears `HTTP_PROXY`/`http_proxy` for
its loopback WebSocket connections: Firebase's Node transport otherwise sends
even localhost through that proxy and ignores `NO_PROXY`. The CLI's verified
artifact downloads retain their normal proxy and TLS configuration.

CLI 14.19.1 pins Database Emulator **4.11.2**, downloaded from:

```text
https://storage.googleapis.com/firebase-preview-drop/emulator/firebase-database-emulator-v4.11.2.jar
size:   34495935 bytes
MD5:    2fd771101c0e1f7898c04c9204f2ce63
SHA256: b70d99344caf17c98b6f910fa8f6edf32a7c016cb1035e8915f70d38901eb97f
```

Those values come from the installed CLI's
`lib/emulator/downloadableEmulatorInfo.json`. Its downloader checks size and
MD5 before caching. Preserve those checks and TLS verification. The cached JAR's
SHA256 was independently checked with `sha256sum` and matched the value above.

## Reproduce

Run from `/tmp` to keep emulator logs/generated files outside the checkout.
The CLI resolves the rules relative to `firebase.json` and injects the database
emulator host into its child test process. The test uses `createRequire` rooted
at `/workspace/.geoguess-emulator-tools/package.json` and verifies the exact
Firebase/rules-unit-testing versions. `NODE_PATH` alone is insufficient because
the checkout's nearer Firebase 8 package takes precedence.

```sh
cd /tmp
env XDG_CONFIG_HOME=/workspace/.geoguess-emulator-tools/config \
  XDG_CACHE_HOME=/workspace/.cache \
  FIREBASE_EMULATORS_PATH=/workspace/.cache/firebase/emulators \
  CI=1 \
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

## Candidate and checks

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

The count regex consumes a UTF-16 high/low surrogate pair or one character per
repetition. Its surrogate ranges are single JSON Unicode escapes, which decode
to actual characters before Rules parses the regexp. A double-escaped regexp
`\\u` sequence does not provide the intended Unicode escape in this emulator.
The wildcard also accepts internal newline/NUL as required by the pure contract.
Boundary checks use `beginsWith`/`endsWith` for all 25 ECMAScript trim code points;
Unicode string escapes work there. Tests accept 20 emoji and reject 21, exercise
combining marks and U+10FFFF, reject every trim code point at both boundaries,
and accept zero-width space (which JavaScript trim preserves).

Do not replace code points with UTF-16 `.length`, omit the 20-emoji case, weaken
assertions, or infer Rules features from client SDK methods. If a required
invariant fails, preserve the smallest failing input and stop adapter work; a
trusted-backend alternative requires a separate concrete proposal. This local
proof does not establish auth-provider setup, venue network behavior, production
quotas, organizer recovery, real-device reconnects or event readiness.
