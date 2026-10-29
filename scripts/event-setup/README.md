# Guarded one-round seed tool — issue #37

This operator tool validates a fresh single-round seed without touching Firebase
by default. It is outside frontend assets. Live apply is a separate, explicit
operator action restricted to the supplied rehearsal project; it has not been
executed against live services as part of this work.
It does not deploy rules, enable providers, create accounts, reset/delete events,
validate Google imagery, or configure hosting. The project's real browser
settings do not grant trusted provisioning authority.

Use Node 20.14 or newer. No new dependencies, Firebase login or credentials are
needed for validation or the pure tests. From the repository root:

```sh
node scripts/event-setup/cli.cjs \
  --input scripts/event-setup/example.synthetic.json \
  --project demo-geoguess-admission \
  --database-url https://demo-geoguess-admission.firebaseio.com \
  --event-id synthetic-rehearsal-a
node --test scripts/event-setup/setup.test.cjs
```

The example intentionally has a fictional panorama and a nonexistent organizer.
A successful dry-run reports `identityVerified:false` and
`panoramaVerified:false`; it only establishes schema/target validity. It loads
no provider adapter and makes no network calls. All four explicit input/target
arguments are required. Target values must agree with the JSON file, including
the region-specific database URL. Extra event fields, existing public results,
non-lobby phase, malformed IDs, obvious placeholder fields and invalid coordinates
or camera settings are refused. The event schema is the current `r1` contract;
multiround configuration is not implemented here.

Keep actual private seed files outside the checkout or in an appropriately
ignored private directory. Never commit real answers, personal venue data,
credentials or passwords. The tool prints status/verification flags and safe
error codes, never its input, file path, host account details or response bodies.
Transport/provider failures are mapped to generic errors. A failed or uncertain
create can be checked by a trusted operator; rerunning will never replace an
existing event. There is no force/overwrite switch.

## Emulator-only apply

A trusted operator must first have an **existing enabled password-provider
organizer account in the emulator**. Replace the example host UID with that
account's actual UID, and choose a fresh event ID in both JSON and arguments.
The CLI does not create the user and does not use an email as ownership.

In this emulator workflow, only `--apply-emulator` enables writes. Before any request, the adapter requires
all of these exact values:

- Project and `GCLOUD_PROJECT`: `demo-geoguess-admission`.
- Database URL: `https://demo-geoguess-admission.firebaseio.com`.
- `FIREBASE_DATABASE_EMULATOR_HOST`: `127.0.0.1:9009`.
- `FIREBASE_AUTH_EMULATOR_HOST`: `127.0.0.1:9099`.

It then contacts only those loopback endpoints; redirects are refused and each
request has a 10-second timeout. In emulator mode a real project, remote emulator host, missing guard, unknown CLI
option or generic `--apply` switch is refused. Do not run emulator
suites concurrently because they share disposable database state.

The adapter looks up the existing user using the Auth emulator's privileged
operator endpoint and checks UID, disabled state and password provider. The
Database operation reads the exact event path with an ETag, refuses any existing
value, then performs conditional PUT with `If-Match`. This is an atomic
compare-and-set transaction: a concurrent creator changes the ETag and the
server returns 412, so no prior event is overwritten. It does not perform an
unconditional read-then-set or retry with a newer ETag. `Bearer owner` is an
emulator-only authorization token, not a production credential.

Example inside a running, correctly guarded emulator environment:

```sh
node scripts/event-setup/cli.cjs \
  --input /path/to/private/emulator-seed.json \
  --project demo-geoguess-admission \
  --database-url https://demo-geoguess-admission.firebaseio.com \
  --event-id synthetic-rehearsal-a --apply-emulator
```

## Interfaces and evidence

`core.cjs` exports `validate(input,target)` and
`provision(input,target,{apply,adapter})`. Only literal `apply:true` uses an
adapter. The injected trusted interface supplies:

- `target:{projectId,databaseUrl,eventId}` agreeing with the validated input;
- `getUser(uid) -> {uid,disabled:boolean,providerData:[{providerId}]}`;
- `createIfAbsent(eventId,event) -> boolean`, with atomic create-if-absent
  semantics. Returning true means a server-acknowledged create, not optimistic
  local state.

Validation copies the seed before awaiting account lookup. Dependency injection
is for trusted operator integration/tests. The live adapter below has a narrower
project/credential boundary than this general interface; never substitute an
unreviewed adapter for privileged execution.

Verified 2026-10-28: **9 pure Node tests passed** (no external tools/network) and
**1 actual Auth/Database emulator scenario passed**, exit 0 with clean shutdown.
The latter verifies real account lookup and five concurrent creators (exactly
one winner), exact stored seed, replacement refusal and nonexistent host refusal.
A temporary random password account exists only in that guarded fixture and is
removed afterwards; no password is printed. This is not proof of live Firebase
permissions, real panorama availability, live key restrictions or phone access.

Reproduce the integration check in this cloud checkout using the existing
external Node 24/Firebase CLI installation (no app dependency changes):

```sh
cd /tmp
env XDG_CONFIG_HOME=/workspace/.geoguess-emulator-tools/config \
  XDG_CACHE_HOME=/workspace/.cache \
  FIREBASE_EMULATORS_PATH=/workspace/.cache/firebase/emulators CI=1 \
  timeout --kill-after=10s 120s \
  /opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node \
  /workspace/.geoguess-emulator-tools/node_modules/firebase-tools/lib/bin/firebase.js \
  emulators:exec --only auth,database --project demo-geoguess-admission \
  --config /workspace/GeoGuess/tests/integration/event-round/firebase.json \
  '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node --test /workspace/GeoGuess/scripts/event-setup/emulator.test.cjs'
```

Independent security review is required before proposing this tool for merge.
For the remaining live prerequisites, see
[`docs/testable-product.md`](../../docs/testable-product.md).


## Prepared live adapter — issue #51

This adds an operator-only Admin SDK adapter, not a live event or an authorization
to change cloud data. Before running it, review the exact event input, deployed
Rules/ancestor grants, provider settings and target with the organizer. It does
not deploy Rules, create accounts, enable providers, check panorama availability
or change billing/hosting. Real project access and imagery remain unverified.

Install the isolated dependency package only for trusted operator execution:

```sh
npm ci --prefix scripts/event-setup --ignore-scripts --omit=dev
```

Its exact `firebase-admin` 13.6.0 dependency and lockfile are independent of the
frontend package/lock; the adapter is never imported by the Vue app. Dry-run and
pure tests still require no installed Admin dependency or credentials.

The live adapter deliberately accepts only project `customgeoguess` and the
existing regional Database origin
`https://customgeoguess-default-rtdb.europe-west1.firebasedatabase.app`.
The explicit input target and two additional confirmation arguments must match
exactly. It refuses emulator environment variables and conflicting Google Cloud
project environment values before importing the SDK.

Credentials use the standard `GOOGLE_APPLICATION_CREDENTIALS` file variable, but
this first narrow implementation accepts a service-account JSON file rather than
ambient/user ADC credentials. Its `project_id` and service-account email domain
must match the supplied project. The file must resolve outside this checkout and
have no group/other permission bits (for example `chmod 600` on the operator's
own file). Keep it in a secure operator location, never in frontend variables,
GitHub comments, chat, input JSON or the repository. Arbitrary JSON OAuth/token
endpoints are discarded; only the matched project, email and private key are
passed to the SDK's service-account credential constructor. Obtain any needed
operator credential through the project's existing secure administration process;
no credential was supplied or used in these tests.

The following is the prepared command form, **not a command run or a request to
execute it now**. Use an actual private seed file and a fresh event ID after the
write plan has been reviewed. Dry-run the same command without the three apply/
confirmation options first:

```sh
node scripts/event-setup/cli.cjs \
  --input /secure/private-rehearsal.json \
  --project customgeoguess \
  --database-url https://customgeoguess-default-rtdb.europe-west1.firebasedatabase.app \
  --event-id rehearsal-a \
  --apply-live \
  --confirm-project customgeoguess \
  --confirm-database-url https://customgeoguess-default-rtdb.europe-west1.firebasedatabase.app
```

The existing enabled password-provider organizer is looked up in the explicitly
bound Auth project. The Admin Database transaction writes only
`events/<event-id>` and returns the seed only while the current value is `null`.
The SDK can rerun its transaction callback during contention; every retry aborts
against existing data. It never resets/replaces an event or reports a cached
optimistic write as acknowledged. A successful live result says
`created-live-event`, `identityVerified:true`, `written:true`, and still
`panoramaVerified:false`.

Each Admin lookup and create has a 30-second budget. Lookup timeout prevents
creation. A create timeout takes only the isolated Admin database offline and
reports `create-unconfirmed`; the already-sent server write may still commit.
The tool never automatically reconnects or retries that uncertain write.

A network/process interruption during creation does not prove no write occurred.
Inspect the one target event through a trusted operator before deciding whether
to retry; rerunning cannot overwrite an existing event. A bounded process
watchdog such as `timeout --kill-after=10s 90s` may be used around the command on
systems providing that utility. A watchdog exit is an uncertain outcome, never
a pass or proof of no write. The CLI disposes its isolated named Admin app after
completion; it does not change any guest/browser connection.

Pure verification:

```sh
node --test scripts/event-setup/setup.test.cjs scripts/event-setup/live.test.cjs
```

The live factory is tested with synthetic credential material and injected SDK
services; no real credentials or live network calls occur. A separate guarded
`admin-emulator.test.cjs` uses the actual isolated Admin SDK only with fixed demo
project and loopback Auth/Database services, checking actual user lookup,
concurrent transaction creation, disabled-host rejection and overwrite refusal.
It can be run with the emulator command above by replacing `emulator.test.cjs`
with `admin-emulator.test.cjs`. It never loads the live credential factory.

Verified 2026-10-29 for issue #51: **15 pure tests pass**, independently reproduced
with pinned Node 20 during security review. **One actual Admin SDK emulator
scenario passes** (702.5 ms, 984 ms total), exit 0 with clean Auth/Database
shutdown. Five concurrent SDK transaction creators produce one winner and four
refusals; actual organizer lookup, disabled-account rejection and existing-event
preservation pass. The fixture clears proxy variables only after fixed demo/
loopback guards, inside its own process; normal CLI TLS/proxy verification stays
enabled. An initial inherited-proxy attempt did not complete and was treated as
a failed run; the corrected run is the evidence above. Independent security
review found no blockers. No live credential or live write was exercised.
