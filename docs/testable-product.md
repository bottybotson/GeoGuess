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

The supplied project and browser settings do not establish that live Authentication providers, organizer UID, current database rules, key restrictions, hosting, or event seed are ready. A recent cloud provider probe stopped with `ERR_CERT_AUTHORITY_INVALID` before key authentication, so it did not verify project access or provider configuration. The repository has no root `firebase.json` or deployable root rules file; candidate rules and emulator configurations live under `tests/integration/` only. The supplied project's current rules and restrictions remain unverified.

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

## Guarded seed and preflight: recommended next slice

There is no seed/preflight implementation yet. The emulator fixtures create a synthetic password organizer and write event setup through `withSecurityRulesDisabled`; that is test-only privileged setup. The source has no Admin SDK tool, durable host account bootstrap, live target guard, overwrite protection, or panorama preflight. Do not copy test fixture behavior into a public/browser command.

Implement one small operator CLI, kept outside frontend assets, with explicit `--project`, `--database-url`, and `--event-id`; a validated JSON input file containing the title and one-round setup; and trusted credentials supplied through a secure local mechanism. The first command should default to validation/dry-run and perform no writes. A separate explicit `--apply` should:

- reject missing/placeholder fields, malformed IDs, nonfinite/out-of-range coordinates, heading outside `[0,360)`, pitch outside `[-90,90]`, nonpositive difficulty, missing panorama ID, and missing/invalid existing organizer UID;
- check that the Auth account exists, is enabled, and already uses the password provider expected by the Rules; require the supplied `hostUid` to equal that account's actual UID;
- verify the target project/database URL against explicit operator input and refuse production by default (with an allowlist/strong explicit override only after review);
- read the event path first and refuse any existing value—never update or replace it;
- verify the panorama through the Maps JavaScript `StreetViewService` using the browser key, or through a separately restricted server key if a server Web Service is necessary; confirm the returned panorama and inspect scene/answer coherence;
- create the event only if the path is still absent using a Realtime Database transaction that returns the event value only for `current === null` (abort otherwise). A prior read followed by a write is insufficient because another process can create the event between those operations;
- print a redacted summary and next URLs, not credentials, answer coordinates, or tokens.

Keep this first slice to a fresh disposable rehearsal event and one untimed round. Do not add arbitrary reset/delete, multi-round support, timer changes, credentials in `.env` committed files, dependency upgrades, or live deployment. A bounded acceptance task is: test dry-run/schema failures and existing-event refusal offline; verify provider UID binding and event creation against a disposable emulator with an existing emulator user; then prepare (but do not apply) the exact merged-rule/deployment artifacts for human review. Real provider panorama preflight remains a separate explicitly configured check.

## Evidence and open blockers

Source review covered issue #34, the event requirements/gap/roadmap and development baseline, `src/event/{runtime,lobby,admission,identity,host,round}.js`, the routed Vue pages, and the integration fixtures/rules. Existing docs report passing local emulator protocol and routed browser checks using synthetic imagery; this investigation did not rerun those commands. There is no evidence here of a live event, real imagery load, deployed rules, public host route, or device rehearsal.

The next bounded task is to implement and test the guarded seed/preflight CLI against the supplied project's corresponding emulator fixture, including actual existing-organizer UID binding, dry-run, and transactional create-if-absent. Remaining live blockers are to verify the supplied project's provider setup, host UID, current rules and key restrictions; curate a real panorama and answer; prepare merged rules preserving legacy room access; confirm hosting; and review the exact write/deploy plan. The current certificate error means live provider access has not yet been established. The code and local fixture evidence alone are not event readiness.
