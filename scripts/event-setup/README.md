# Guarded one-round seed tool — issue #37

This operator tool validates a fresh single-round seed without touching Firebase
by default. It is outside frontend assets. **It has no live apply adapter.**
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

Only `--apply-emulator` enables writes. Before any request, the adapter requires
all of these exact values:

- Project and `GCLOUD_PROJECT`: `demo-geoguess-admission`.
- Database URL: `https://demo-geoguess-admission.firebaseio.com`.
- `FIREBASE_DATABASE_EMULATOR_HOST`: `127.0.0.1:9009`.
- `FIREBASE_AUTH_EMULATOR_HOST`: `127.0.0.1:9099`.

It then contacts only those loopback endpoints; redirects are refused and each
request has a 10-second timeout. A real project, remote emulator host, missing
guard, unknown CLI option or `--apply` switch is refused. Do not run emulator
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
is for trusted operator integration/tests; no live adapter or credential handling
has been approved. Any live adapter needs separate security review, explicit
project/credential binding and the same atomic no-overwrite guarantees.

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
