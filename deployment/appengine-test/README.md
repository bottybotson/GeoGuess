# Private App Engine test service and host game creation

The current private **static** v2 rehearsal site is already working behind its
native IP allowlist and terminal default-deny firewall. These files prepare the
bounded server operation for [#78](https://github.com/bottybotson/GeoGuess/issues/78).
They do not activate it. [#81](https://github.com/bottybotson/GeoGuess/issues/81)
tracks separately authorized runtime IAM, packaging, deployment and private-host
verification. Preserve the existing hostname, firewall, scaling bounds and
Firebase Hosting disabled state. No firewall update or deployment runs from any
script in this folder.

The operation and security/retry contract is
[host-game-creation-contract.md](../../docs/host-game-creation-contract.md).
`POST /api/event-creations` accepts only `{sourceEventId,requestId}` (32 lowercase
hexadecimal characters for the request ID). It returns `201 created` or
`200 already-created` with `{status,eventId,links:{host,join,presenter}}` and
canonical relative paths. Errors contain only `{error:fixed-code}`. Every API
response is JSON/no-store/noindex/nosniff; unknown API paths never become SPA HTML.

## Server boundaries

- `http.cjs` enforces the exact path/method, configured same-origin Origin,
  Bearer header, JSON and 1 KiB body. Its 30-second budget includes body intake,
  lazy runtime initialization, authentication and database operations. Cookies,
  forwarded headers and request Host select no identity or target.
- `runtime.cjs` refuses disabled/non-App-Engine use, a foreign project, emulator
  variables, metadata endpoint overrides, credential-file configuration or an invalid configured service
  account. It verifies the fixed Google metadata endpoint identity **and** the
  actual Admin ADC credential is a Compute Engine credential for the same
  account, then binds one named Admin app to the pinned project/regional database.
- `creation.cjs` verifies the token with revocation checking, issuer/audience/UID,
  password sign-in provider and enabled matching password user. It reads only the
  source host UID before ownership succeeds, then one coherent source snapshot
  and a second ownership check. Missing/non-owned sources are indistinguishable.
- Fresh seed extraction selects only canonical v1/v2 configuration and rebuilds
  the lobby. Played/completed progress, participants, slots, guesses, timing,
  results and totals are excluded. Source data is never written.
- `validator.cjs` loads the **same** canonical `scripts/event-setup/core.cjs`
  in the checkout, or its byte-identical `seed-core.cjs` in staging. No browser or
  backend schema fork is maintained.
- `store.cjs` creates an immutable server-only ledger reservation, waits for its
  acknowledgement, then creates the deterministic destination through a
  transaction that aborts on **every** existing value. A per-database/path barrier
  prevents another request from treating optimistic local SDK data as an
  acknowledged reservation. Failed or timed-out writes may still commit; late
  promises remain tracked and the connection stays online. Recovery reuses the
  reserved seed and destination. Confirmed compatible games can progress without
  being overwritten; a pending request rejects changed configuration.

No server application log contains tokens, request bodies, account details,
source snapshots, answers, provider errors or credential paths. This server has
no request logger. Platform logging configuration remains an activation check.
A ledger retained outside `events` preserves idempotency; do not expire/delete it.
The existing combined client Rules deny this otherwise-ungranted path.

## Reproducible staging, separate from activation

Use a reviewed frontend build, then from the repository root:

```sh
node deployment/appengine-test/stage.cjs /absolute/path/to/dist /tmp/fresh-private-stage
```

The output must be a new directory outside the checkout and the source `dist`.
The builder validates the full input before writing, refuses symlinks, hidden or
unexpected asset files, and creates private directories/files. It copies only:

- `dist/`, containing `index.html` and supported static asset extensions;
- `app.yaml`, isolated `package.json` and exact `package-lock.json`, `server.cjs`;
- `policy.cjs`, `http.cjs`, `runtime.cjs`, `creation.cjs`, `store.cjs`, `validator.cjs`;
- byte-for-byte canonical validator as `seed-core.cjs`, and `.gcloudignore`.

`staging-manifest.json` records sorted path/size/SHA-256 entries and the validator
source. It is a review artifact excluded from upload. The explicit `.gcloudignore`
allowlist excludes tests, emulator helpers, source checkout, node_modules,
operator/firewall inputs and outputs, credential files and the manifest itself.
No existing output directory is reused. Repeating with identical inputs produces
an identical manifest. Install runtime dependencies with `npm ci --omit=dev`
inside staging; do not upload an operator dependency tree.

**The existing external deployment helper is static-only:** it uploads `dist`
plus three root files and hardcodes static handlers. Editing `app.yaml` alone
cannot activate this endpoint. #81 must review the complete staged file manifest,
use the candidate script handler before both asset and SPA handlers, and select
the explicit runtime identity/configuration. The candidate `app.yaml` intentionally
contains no enabled flag or service account configuration. A copied artifact
without separately reviewed runtime settings fails closed with 503.

## Offline and emulator verification

The isolated runtime dependency is `firebase-admin` **13.6.0**, pinned with its
lockfile, and the target runtime is Node **22.x**. The repository app retains its
own Node/dependency setup. In this environment:

```sh
. /workspace/.geoguess-tools/env.sh
npm ci --prefix deployment/appengine-test --ignore-scripts --no-audit --no-fund
npm test --prefix deployment/appengine-test
```

Offline tests cover auth/source ordering, schema rejection and detached v1/v2
1/2/20-round seeds; five-way retry convergence, account/key/target isolation;
source/destination preservation; crashes and lost acknowledgements before/after
reservation and creation; expired waiters, late commits and independent requests;
actual Node HTTP methods/paths/origin/content type/input/body/deadlines; runtime
ADC/project/metadata guards; complete deterministic staging and API/asset/SPA
handler ordering. Handler tests inspect the candidate manifest; they do not
simulate App Engine's firewall or prove live routing.

The actual Auth/RTDB emulator suite uses the pre-existing isolated Firebase CLI,
Node 24 and Java tools documented in
[the admission fixture](../../tests/integration/event-admission/README.md).
Ports **9009/9099 must be exclusive**. From `/tmp`:

```sh
env -u GOOGLE_APPLICATION_CREDENTIALS -u GOOGLE_CLOUD_PROJECT -u GCLOUD_PROJECT \
  -u FIREBASE_AUTH_EMULATOR_HOST -u FIREBASE_DATABASE_EMULATOR_HOST \
  XDG_CONFIG_HOME=/workspace/.geoguess-emulator-tools/config \
  XDG_CACHE_HOME=/workspace/.cache \
  FIREBASE_EMULATORS_PATH=/workspace/.cache/firebase/emulators CI=1 \
  timeout --kill-after=10s 180s \
  /opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node \
  /workspace/GeoGuess/deployment/appengine-test/run-emulator.cjs
```

The runner creates a temporary CLI configuration and copies canonical combined
Rules there. The test explicitly installs those Rules for the exact demo
namespace: a CLI default namespace can differ from the `.firebaseio.com` demo
namespace, whose otherwise auto-created emulator database starts open. Fixed
project and loopback guards run before any SDK/credential/network use. There are
no live project credentials or providers. The actual pinned Admin SDK verifies
password, anonymous, foreign-project, expired, revoked and disabled token cases;
creates five-way concurrent v1/v2 games; reads setups through actual application
runtime clients; checks old/progressed event preservation, client ledger denial
and lost-acknowledgement recovery after real ledger/event commits. Test-only
unsigned token mutation exercises emulator verifier checks; production verifier
behavior still needs the private-host check. Whole-process fixture cleanup takes
its own database offline only after all requests complete; request handlers never
do so. Timeout, cancellation, skipped tests or incomplete shutdown are failures.

Evidence on 2026-11-03: **32 offline tests passed** under repository Node 20.14;
**8 actual emulator tests passed**, exit 0 with clean Auth/Database shutdown, under
Node 24.19. All **32 offline tests also passed on Node 22.23.4**. A real 173-file
frontend staging manifest was generated outside the checkout; fresh staged
`npm ci --omit=dev --ignore-scripts` installed all 167 dependencies, loaded the
pinned Admin modules/canonical validator, and served fail-closed JSON 503 with
runtime disabled on Node 22.23.4.
These checks do not establish live readiness or authorize deployment.

## #81 activation gate

Before any separately authorized change, inspect the deployed version, native
firewall and runtime identity/IAM read-only. Select a dedicated runtime service
account and verify supported permissions for Auth user-read/revocation checking
and RTDB data access at the smallest supported resource scope. Runtime gets no
owner/editor, user-management, custom-token signing, deployment or key-file
capability; deployment/build/service-account-use authority stays with deployment.
Admin database access bypasses client Rules and IAM does not restrict it to event
paths; the residual broader database capability requires explicit review.

Review the staged manifest and unchanged firewall; confirm usable managed ADC,
project/database target, selected account, `EVENT_CREATION_ENABLED=true`,
`EVENT_CREATION_SERVICE_ACCOUNT`, `GAE_ENV=standard`, and actual platform project
variables. Preserve the zero-minimum/one-maximum scaling bounds. Verify Node 22
support and the pinned SDK against the real platform, Auth password provider,
authorized domains, correct token audience and revocation. Inspect provider
logging to exclude Authorization/body/private firewall data. Retain a rollback
to the current static version.

On the separately authorized private host, verify allowed/denied networks for
API/assets/index/SPA/HEAD/HTTPS and all default/version/service hostnames, plus
forged forwarded headers. A denied network receives no protected content.
Exercise authenticated creation/retry without modifying existing games and
confirm API errors remain JSON/no-store. Keep Firebase Hosting disabled. Local
passes are not evidence of IAM sufficiency, native firewall coverage, billing
limits, real device connectivity or venue readiness.

## Existing native firewall utility

`firewall.cjs` and `firewall.test.cjs` retain the reviewed synthetic-only manifest
utility. A nonempty list of exact IPv4 strings produces priority 1000+ `/32` ALLOW
rules followed by priority 2147483647 `*` DENY for unmatched IPv4 **and IPv6**.
Empty/malformed/CIDR/wildcard/duplicate/IPv6 allowlists fail closed. Omitting the
terminal wildcard can cause the API to append ALLOW ALL.

Private generation only:
`node deployment/appengine-test/firewall.cjs /private/allowed-ipv4.txt /private/firewall.json`.
Both files must be outside the checkout; symlinks and an existing output are
refused, output mode is 0600, and stdout never contains addresses or paths. Never
commit, upload or attach those files. Generation applies nothing. Any future
application-wide firewall replacement needs its own inventory and authorization;
keep the current working native allowlist/default-deny policy unchanged.
