# B01 development baseline and live smoke test

Work item: [#1 — runnable fork, costs/security and multiplayer smoke test](https://github.com/bottybotson/GeoGuess/issues/1). This guide establishes the existing application's baseline before changing its multiplayer behavior. It does not certify the birthday event workflow or 50-player support.

## Reproduce local development

Use the existing checkout with Node from `.nvmrc` (20.14) and npm 10.7. In this cloud environment, source `. /workspace/.geoguess-tools/env.sh` to activate the pinned tools and writable caches. On other machines, activate the pinned Node with your normal version manager.

From the repository root:

```bash
# Use this when Cypress's external binary download is unavailable.
# It installs the CLI but does not prepare Cypress to run tests.
CYPRESS_INSTALL_BINARY=0 npm ci
NODE_ENV=production npm run lint -- --no-fix
npm run test:unit -- --runInBand
npm run build
npm run serve -- --host 0.0.0.0
```

The first development compilation can take roughly two minutes. A full production build makes both legacy and modern bundles; wait for the command's final exit status, not the first bundle summary. Build output is ignored at `dist/`. Do not update dependencies just to silence bundle-size or Browserslist warnings.

For Cypress in this cloud machine, the same activation file supplies local Xvfb, `CYPRESS_CACHE_FOLDER` and writable XDG directories. A retained environment helper at `/workspace/.geoguess-tools/install-xvfb.sh` refreshes local Xvfb from signed Debian indexes with APT checksum verification; it does not install system-wide packages. These machine-specific details are also saved in the environment install/start configuration.

Verify successful compilation and an internal HTTP request to port 8080, then interact with the page: the homepage must render, and the language menu must switch between English and French. HTTP 200 alone is not a functional check. In the cloud instance, `/workspace/.geoguess-tools/smoke.cjs` performs this small check using installed Chromium and Playwright. That helper is an environment artifact, not a repository test or gameplay verification.

### Application configuration

No real application bindings were available during the baseline run. Use environment settings or an ignored `.env.local`; never put real values in a PR, issue, screenshot, or build log. `.env.dist` lists the names, but its `YOUR_...` examples are not working credentials. Restart the dev server and rebuild deployment assets after changing values.

| Variable | Purpose |
| --- | --- |
| `VUE_APP_API_KEY` | Browser Google Maps JavaScript/Street View key with appropriate provider restrictions and enabled billing |
| `VUE_APP_FIREBASE_API_KEY` | Firebase web-app configuration |
| `VUE_APP_FIREBASE_PROJECT_ID` | Firebase project identity |
| `VUE_APP_FIREBASE_DATABASE_URL` | Exact Realtime Database URL from Firebase; do not infer a region-specific URL |
| `VUE_APP_FIREBASE_AUTH_DOMAIN` | Firebase web-app domain |
| `VUE_APP_STORAGE_BUCKET` | Firebase web-app bucket, if configured |
| `VUE_APP_FIREBASE_MESSAGING_SENDER_ID` | Firebase web-app sender ID |
| `VUE_APP_FIREBASE_APP_ID` | Firebase web-app app ID |
| `VUE_APP_FIREBASE_MEASUREMENT_ID` | Optional analytics; omit for the baseline unless intentionally enabled |
| `VUE_APP_LIST_MAPS_JSON_URL` | Optional catalogue override; current source defaults to `https://maps.geoguess.games/maps.json` |

The `VUE_APP_` values are compiled into browser assets. They are not server secrets, and a proxy-only secret placeholder is not a substitute for a browser-usable configuration. Never place Firebase Admin service-account material in these variables or in the frontend.

### Network destinations

Dependency installation uses the configured Git HTTPS proxy and npm registry. Live development also needs `maps.geoguess.games`, `maps.googleapis.com`, `maps.gstatic.com`, and `nominatim.openstreetmap.org`. Firebase destinations depend on the selected project's actual Database URL and SDK requests; allow only the exact required hosts after inspecting that configuration. Do not invent project names or assume a wildcard is needed.

Cypress downloads need `download.cypress.io` and its CDN, `cdn.cypress.io`. GitHub issue/PR operations need `api.github.com`; successful Git fetch/push does not establish API access. These destinations initially returned HTTP CONNECT 403. After the environment's access changed, GitHub REST operations, the map catalogue, Nominatim status and Cypress download were successfully retried. Do not infer Firebase connectivity from those responses. The required additions are saved in the environment draft; saving a draft alone does not apply network changes. Pricing-documentation requests to `developers.google.com` and `firebase.google.com` remain blocked, so current prices/allowances have not been verified here.

## Current evidence and remaining B01 checks

Local baseline evidence on 2026-10-26, before multiplayer application changes:

- Node 20.14.0 / npm 10.7.0, frozen-lockfile `npm ci`: passed.
- Production lint with `--no-fix`: passed.
- Full legacy + modern production build: passed, with bundle-size and outdated Browserslist warnings.
- Chromium homepage rendering and English → French → English switching: passed twice. An external-data `Network Error` was also observed; this is not proof that the map catalogue or gameplay works.
- Original unit run: 24 suites passed, 1 failed; 74 tests passed, 3 failed; 9 snapshots passed. The failed tests made real Nominatim requests. The focused change in this branch supplies realistic responses at the HTTP boundary while preserving their assertions. The full suite now passes: **25 suites, 77 tests, 9 snapshots**; live provider verification remains separate.
- Cypress 15.11.0 binary download and verification: passed after access was restored, local Xvfb was extracted, and writable XDG paths were configured. The existing homepage spec ran in headless Chromium: **1 passed, 0 failed/skipped**. It checks language switching, not live gameplay.

The following acceptance work remains open on #1:

1. Supply the real Maps/Firebase client settings securely and apply the required network access. Re-run the homepage with catalogue and provider access.
2. Inspect the selected Firebase project's actual rules and Google key restrictions; record sanitized findings. These settings are not in this checkout and cannot be inferred from successful compilation.
3. Deploy a disposable baseline build and complete the two-device scenario below. Keep the legacy behavior separate from the event implementation.
4. Inspect current provider billing documentation and the selected project's billing/quotas, then record observed usage. Do not mark the cost/security acceptance checks complete from this guide alone.

## Two-device baseline scenario

Use two independent browser/device sessions against the same disposable project/build, with a unique, nonpersonal room name. Record commit, browser/OS, build mode, sanitized configuration presence, exact failing step, and console/network errors without keys or personal data.

1. Device A opens **With Friends**, creates the room, configures Classic mode with five rounds and an unhurried limit, and chooses a nickname.
2. Device B joins the same room through the UI and chooses a different nickname. Confirm both names on A before starting. A currently acts as player 1 and organizer; this is legacy behavior, not the future host role.
3. A starts. Verify both devices load imagery for the same round and show the same initial location. Record that each currently starts its own timer; do not imply synchronization has been implemented.
4. On A place a map pin and submit. Check the waiting state. On B submit a different pin; verify both show the round result, distances, points and cumulative totals.
5. Advance on both devices and repeat through the final round. Record whether totals agree and whether the room is removed at completion.
6. In a **new disposable room**, separately test a guest refresh, guest tab closure, and two joins at once. These are expected risk probes: record observed outcomes and link defects to #2/#4, rather than calling broken recovery acceptable.

The existing `tests/e2e/specs/game/multi.test.js` uses direct Firebase writes to simulate a peer. It is not evidence for two real clients, reconnection, host authorization, or 50-player operation. With the runtime settings above, run the existing homepage check against the dev server:

```bash
npm exec -- cypress install
npm exec -- cypress verify
npm run test:e2e -- --spec tests/e2e/specs/homePage.test.js --browser /usr/bin/chromium --headless
```

The browser path is cloud-specific. Do not run gameplay Cypress specs against an event database: helpers write room data. They also use `Cypress.env(...)` separately from Vue build variables; configure those securely for a disposable test project without printing values.

## Deployment, billing and access checks

Prefer a static build with variables provided at build time and publish `dist/`. Choose the deployment host when live validation is possible; do not assume one has been selected. The included Netlify, Vercel, and nginx configurations provide history-route fallback; verify a fresh direct `/room/<test-room>` navigation works on the actual host. Do not ship the local build made without real app settings.

The Docker entrypoint substitutes placeholder values into emitted assets. It has not been exercised here, and its analytics variable is misspelled `MEASURMENT` while the app reads `MEASUREMENT`. Use the static build path for B01 rather than treating Docker runtime substitution as validated.

Before exposing the legacy app:

- Inspect and export the actual Realtime Database rules privately. No rules or auth implementation are tracked. Room names are not authorization; do not use unrestricted database rules or Firebase test mode as a shortcut to a successful smoke test. If safe access cannot be established for the legacy client, record that blocker and use an isolated local/emulated baseline instead of publishing it publicly.
- Restrict the Maps browser key to the exact development/deployment HTTP referrers and required APIs. Verify accepted requests and rejection from an unintended origin using the provider's supported process. Use separate test and event projects/keys where practical.
- Review the current [Maps JavaScript usage/billing](https://developers.google.com/maps/documentation/javascript/usage-and-billing), [Street View usage/billing](https://developers.google.com/maps/documentation/streetview/usage-and-billing), [Maps pricing](https://developers.google.com/maps/billing-and-pricing/pricing), and [Firebase pricing](https://firebase.google.com/pricing). Confirm which billing products the JavaScript panorama/service calls actually use; do not infer static-image API charges from the product name.
- Record current billing account/currency, applicable SKUs/allowances, enabled APIs, quota settings, Firebase plan/storage/download estimates, and observed rehearsal usage. This guide does not assert prices or free allowances. Fifty guests times rounds is an input to a rehearsal, not a verified billable-load estimate.
- Configure budget alerts and supported quotas with the organizer. Alerts are notifications, not a guaranteed spending cutoff; test the chosen stop/recovery procedure. Include a manual fallback for the event.

## Recovery and cleanup

Keep the deployed asset version and a private backup/export of disposable test data before destructive probes. If a dev service fails, stop only the process you started, read its log, and restart from the repository root; changing browser config requires a rebuild/restart.

The unchanged game has no verified session resume. Refreshing the multiplayer route loses transient route props; guest departure can terminate the whole room. During baseline testing, preserve evidence and create a fresh test room after such a failure. Do not promise an event can resume scores safely until #2/#4/#6 are validated. At an event, a documented manual score sheet/presentation fallback is needed until that recovery gate passes.

After testing, remove only the exact disposable room through an authorized admin tool and verify it is absent. Do not run `scripts/clean-rooms.js` against a shared/event database: it scans the entire root, removes nodes without `createdAt` as well as old rooms, and exits without awaiting all removal promises. A new `/events` namespace would also be at risk. Review and replace that cleanup boundary before introducing event data.

## Next bounded implementation slices

- **B01 now:** establish local baseline, deterministic unit tests, this runbook, and the room lifecycle evidence in [multiplayer baseline](multiplayer-baseline.md). Keep live acceptance criteria open pending actual credentials, provider settings, two-device execution and usage evidence.
- **B02 next:** specify a host-owned event session boundary with stable guest identity, admission/rejoin transactions, and server-enforced access rules. Verify 50 concurrent guests, rejection of guest 51, reconnect and a passive presenter before wiring the full event UI. This can progress with emulator tests while real-provider B01 work is externally blocked; it does not waive B01's live acceptance gate.
- **B03/B04 then:** ordered panorama data and authoritative host transitions/deadline. Repeated commands must be idempotent; missing submissions earn a defined no-answer result.
- **B06:** a read-only presentation surface independent from admin controls. Do not mount legacy multiplayer components in a spectator route: they write readiness and lifecycle state. Separate admin/presentation URLs are the preferred R13 convenience across B02/B06.

GitHub issue/PR updates must describe these as partial work on #1, not `Closes #1`. GitHub API access was restored during this work: #1 is in progress, and #2/#3/#5/#6/#7/#8 now record the optional-venue and separate-surface refinements.
