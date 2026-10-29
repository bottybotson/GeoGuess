# One real-imagery organizer + two-guest test

Issue [#34](https://github.com/bottybotson/GeoGuess/issues/34) asks for a novice-repeatable rehearsal of the merged, single untimed round. This is a setup contract and source-based runbook; it does not mean a live Firebase project, real Street View panorama, or public deployment has been provisioned or tested.

## Prepare a round in the browser

The local preparation page is `/event/setup` on the app's origin. It accepts the
existing project/database details, organizer UID and one curated panorama with
its heading, pitch and answer coordinate. It keeps the draft in memory and
exports a JSON file; it does not create users, write database data or deploy
rules. Google receives requests to render the preview. Use “Use this panorama”
after the current scene loads, then download the configuration for the trusted
operator tool. Do not enter passwords or service-account credentials here.

The page cannot verify that the organizer, live rules or provider billing are
ready. Real panorama loading remains a separate check; synthetic unit fixtures
are not evidence of working imagery. The rest of this guide describes those
remaining prerequisites.

## What exists today

The event flow is separate from the legacy `/room/:roomName` game. The routes are:

| Role | URL |
| --- | --- |
| Organizer | `https://<deployed-host>/event/<event-id>/host` |
| Guest | `https://<deployed-host>/event/<event-id>/join` |
| Projector / presenter | `https://<deployed-host>/event/<event-id>/present` |

The organizer signs in with Firebase Email/Password, then can start, close, and reveal one untimed round. Guests enter a nickname, join anonymously, place one pin, and submit. The presenter reads public lobby/phase and reveal data without an anonymous sign-in. The host does not occupy a guest seat. The current flow has one `r1`; it has no next-round command, timer, or cumulative leaderboard.

The emulator browser proof uses the same Vue routes and Firebase 8 application adapters, but mocks Google Maps and blocks external traffic. Its `synthetic-public-pano` is deliberately fictional. The lower-level rules proof uses another fictional panorama and `(0,0)`. Neither is suitable for a real-world game. The emulator tests are meaningful evidence for local wiring and rules behavior, not evidence of Google imagery, live billing, deployed rules, actual phone connectivity, or a public URL.

## Minimum real test prerequisites

The Firebase/Google Cloud project and browser configuration have already been supplied for this work. Do not recreate the project or ask for the existing settings again. Before inviting guests, the remaining live prerequisites are:

1. Realtime Database in the supplied project and a reviewed rules file that includes the event rules **and** preserves the project's legacy room data rules.
2. Anonymous sign-in enabled for guests, Email/Password enabled for the organizer, and one durable organizer account in Firebase Authentication. Record the account's actual Firebase Auth UID; event ownership is bound to this UID, not to an email, display name, or frontend role flag.
3. A Maps JavaScript API key restricted to the rehearsal's exact web origin, with Maps JavaScript API / Street View availability and billing/quota reviewed. The supplied Firebase project may be the same underlying Google Cloud project.
4. A valid Street View panorama ID, its intended heading and pitch, and the correct answer coordinate. Check it with the browser Maps JavaScript `StreetViewService`/panorama API using the configured browser key; a referrer-restricted Maps JavaScript key must not be assumed usable with a server Web Service. If a server-side check is needed, use a separately restricted server key. Use an explicit panorama ID rather than a nearest-coordinate lookup.
5. A build using the eight app configuration variables already supplied. `VUE_APP_` values are public browser configuration, not secrets. Do not compile an Admin SDK credential into the app.
6. A trusted, one-time seed of a new event record matching the organizer's existing UID and the schema below. The browser cannot create the event or write its private answer/setup.

The supplied settings do not establish that live providers, organizer UID,
deployed rules, hosting or event data are ready. Root `firebase.json` now provides
Hosting-only configuration; `firebase.rehearsal.json` separately describes an
explicit event-only database candidate for review. Neither has been deployed by
this work. The candidate would deny legacy room/undeclared access, so the current
rules and intended effect must be inspected before applying it.

The 2026-10-29 real-provider probe fetched Google JavaScript and panorama metadata
through a TLS-verifying transport, but the visual view displayed Google's load
warning and no panorama tile was verified. Real imagery remains a blocker.
Direct Chromium certificate trust also remains unresolved; no TLS bypass was used.


## Minimum event record contract

For a fresh `<event-id>`, the seed must establish the equivalent of:

```json
{
  "events": {
    "<event-id>": {
      "hostUid": "<actual-existing-organizer-auth-uid>",
      "public": { "title": "<nonpersonal rehearsal label>", "phase": "lobby" },
      "private": {
        "round": {
          "id": "r1",
          "panoramaId": "<valid-google-panorama-id>",
          "heading": 37,
          "pitch": -4,
          "answer": { "lat": 12.345, "lng": 67.89 },
          "difficulty": 2000
        }
      }
    }
  }
}
```

The coordinates/POV above are placeholders, not a recommended or verified location. `answer` is private until reveal. `public/phase` begins at `lobby`; the host start command publishes only `id`, `panoramaId`, `heading`, and `pitch` at `public/round`, then sets `guessing`. Close changes phase to `closed`; reveal writes canonical answer and results then sets `reveal`. Do not prepopulate guest records or guess/results. The host setup is immutable to clients after seed; the organizer's password provider and UID must match the seeded `hostUid`.

## Novice rehearsal path after prerequisites are supplied

1. Open the deployed host URL on the organizer's computer. Sign in with the pre-created Email/Password account. Check that the event title and lobby are visible and that host controls are enabled. If sign-in succeeds but setup is unavailable, stop: that account's UID or event seed does not match.
2. Open the presenter URL on the projector/computer. In lobby it shows the title, phase, guest count/list, and join URL. Keep this page open; it has no host controls.
3. On two separate phones, scan/open the guest URL. Each guest enters a distinct nickname and joins. The host and presenter should show exactly two guests. Do not use the host or projector browser as a test guest.
4. The organizer explains the pin-and-submit interaction, then presses **Start round**. Both phones should load the same real Street View scene and initial direction. Confirm the scene is the intended panorama before proceeding. A blank/unavailable panorama is a failed prerequisite, not a successful game start.
5. Each phone taps the world map, places a pin, and submits once. Confirm each phone receives acknowledgement. Refresh one guest after its accepted submission: the guest should recover its prior guess and should not gain a second submission.
6. The organizer presses **Close guesses**, then **Reveal**. Both guests and the presenter should show the answer and the results; the presenter must not have shown the answer during guessing. Compare the displayed answer to the configured coordinate and confirm one answered result per guest.
7. Record the commit, deployed URL, browser/device types, redacted provider/config presence, panorama validation outcome, and any failure step. Do not save credentials, private coordinates tied to a real person, or host login details in the repository or issue.

The existing routed browser scenario is the closest local rehearsal template, documented in [`tests/integration/event-lobby/README.md`](../tests/integration/event-lobby/README.md). It creates an ephemeral emulator organizer, seeds with privileged emulator access, and uses a synthetic Google widget. The current proof is not a live-provider rehearsal and must not be described as one.

To repeat that local synthetic scenario in the documented cloud environment, first start the development server in one shell:

```sh
. /workspace/.geoguess-tools/env.sh
VUE_APP_EVENT_EMULATORS=true npm run serve -- --host 127.0.0.1 --port 8087
```

After compilation, run this in a second shell (the pinned external emulator tools and Chromium/Playwright described in the linked README must already be installed):

```sh
cd /tmp
env XDG_CONFIG_HOME=/workspace/.geoguess-emulator-tools/config \
  XDG_CACHE_HOME=/workspace/.cache \
  FIREBASE_EMULATORS_PATH=/workspace/.cache/firebase/emulators CI=1 \
  timeout --kill-after=10s 240s \
  /opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node \
  /workspace/.geoguess-emulator-tools/node_modules/firebase-tools/lib/bin/firebase.js \
  emulators:exec --only auth,database --project demo-geoguess-admission \
  --config /workspace/GeoGuess/tests/integration/firebase.round-browser.json \
  '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node --test --test-timeout=120000 /workspace/GeoGuess/tests/integration/event-lobby/round-browser.cjs'
```

These are the documented local replay commands, not commands run during this investigation. The adjacent test documentation records its previous pass; re-run it in the current checkout before treating that evidence as current. Keep the two-device live run below separate from this emulator run.

## Local versus live boundary

| Local emulator can establish | A disposable live project/rehearsal must establish |
| --- | --- |
| Rules parse and enforce the event contract; anonymous guest admission; password-provider host authorization; phase transitions; private answer/guess boundaries; result correctness and completeness; 50-seat protocol behavior. | Correct project/database URL and deployed merged rules; Email/Password provider and durable host account; UID-to-event binding; API-key referrer restrictions and billing; valid panorama/POV/answer; deployed route refresh/rewrite behavior; real phone browsers and actual network/provider behavior. |
| Browser pages/adapter wiring, guest refresh/rejoin, presenter read-only access, identity separation, route rendering, and a mocked panorama UI. | Google actually returning the chosen Street View panorama to the deployed origin; two physical guest devices completing the flow; account recovery, project quotas and cost; public hosting/TLS. |

The checked-in event rule fixtures are candidate rules, not a production deployment artifact. `tests/integration/event-round/rules.json` defines rules at database root for the event tree and contains no legacy room authorization. Replacing the supplied database's rules with this fixture can disable existing legacy room access; broad legacy ancestor grants can also expose event data. Inspect the actual live rules and legacy data paths, merge the event constraints into a reviewed candidate, and run event plus legacy regression checks against that candidate before deployment.

## Reset and repeated runs

For repeated single-round runs, provision a new event ID each time (for example, `rehearsal-20261028-a`, then `...-b`) and seed it in `lobby` before guests join. Memberships/slots are immutable, guesses are one-shot, round setup is immutable, and the protocol only moves forward `lobby → guessing → closed → reveal`. There is deliberately no app/browser reset or delete path. A fresh event avoids silently wiping guests or answer/result data and avoids replaying a completed phase. Reuse the same durable organizer UID across fresh rehearsal events if desired.

Only a trusted operator with appropriate database privileges can remove a disposable event. Any reset operation must require an explicit event ID and explicit confirmation, validate that it is a disposable test project, and be separately reviewed; there is no such reset tool today. Never clear the entire database or overwrite an existing event as a shortcut.

## Provisioning and current blockers

The operator tool in `scripts/event-setup/` now validates configuration without
network access by default. Its reviewed server-only adapter supports an explicit
apply to the supplied project/database with matching confirmations and a secure,
project-bound service-account file. It checks the existing password organizer and
atomically refuses an existing event. No real credentials or live writes were
used to validate that adapter; guarded Admin emulator tests establish its local
transaction behavior. The browser preparation page never receives that credential.

The available ambient credential is not a matching project service account and
was not used. Live execution still requires suitable trusted access, current-rules
inspection/backup, the intentional event-only access decision, an organizer/test
configuration and a separately reviewed apply/deploy action. Real Google imagery
and the eventual hosted-origin restrictions remain unverified. No public game URL
or physical-device rehearsal is claimed.

Version-2 ordered rounds are an isolated protocol proof in a separate PR; the
current preparation page, runtime and deployment candidate remain single-round.
Combined rules, version dispatch, configuration and UI need their own integration
proof before a multi-round event can be claimed.
