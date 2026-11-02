# Host New game / replay — bounded proposal

For [#74](https://github.com/bottybotson/GeoGuess/issues/74), dependent on the
reviewed [#75](https://github.com/bottybotson/GeoGuess/pull/75) provisioning schema
(`541f776`) and version-aware host pages. This is a design for review, not an
implemented endpoint or deployment authorization.

Reuse the existing private App Engine Node service for one **create from this
host-owned game's configuration** action. Keep the old game available, create a
fresh lobby, and return host/join/presenter links together. No configuration
upload/editor, reset, deletion, account creation or general event CRUD.

The November 1 deployment comment on
[#64](https://github.com/bottybotson/GeoGuess/issues/64) records the existing
private test hostname and unchanged native allowlist/default-deny firewall.
`deployment/appengine-test/README.md` still describes its earlier proposal;
inspect the deployed service/version/account before activation rather than
treating that older permission-blocker text as current evidence.

## One authenticated operation

`POST /api/event-creations`, JSON body exactly
`{sourceEventId,requestId}`. Source ID uses the existing 1–80 character event-ID
grammar; request ID is a fresh browser-generated 128-bit random value encoded as
exactly 32 lowercase hexadecimal characters. Limit the body to 1 KiB; reject extra fields,
unsupported content types, malformed IDs and other methods. The browser never
supplies a destination ID, project/database URL, host UID, seed or title override.

Use the existing separately named host Auth app (`src/event/runtime.js`) and
`createHostClient` restoration/sign-in (`src/event/host.js`). Obtain its current
user's ID token in memory with `getIdToken()` and send `Authorization: Bearer`.
Do not reuse guest/default-app identity or send the password to this endpoint.
Require JSON, an exact configured same-origin `Origin`, and no cookie-based
authentication or permissive CORS. Origin is supplementary protection, never
proof of identity; forwarded headers and request Host cannot select a target.

The server pins the existing project and regional database origin in private
runtime configuration, refuses emulator variables in production, and verifies
the ID token using that project's Admin Auth with revocation checking. Require
`firebase.sign_in_provider === 'password'`, the expected project/issuer, and an
enabled matching user with a password provider. A linked password account whose
current token is anonymous is insufficient. No new provider or account workflow
is needed; actual deployed provider/domain settings remain a verification gate.

First read the source `hostUid` and require equality to the verified UID before
reading private configuration. Then obtain one coherent source-event snapshot,
recheck its host UID, and extract the configuration below. The source is already
trusted, client-immutable setup; progress may continue while a replay is created.
Never return or log that source snapshot. Missing/non-owned sources have the same
response. A source that disappears or changes owner/schema during inspection
fails closed; no creation request is reserved from an inconsistent source.

## Configuration and creation boundary

Construct a new seed by explicitly selecting:

- V1: source title, `private.round`, and verified host UID; rebuild
  `public:{title,phase:'lobby'}`. Only an absent/null format marker selects v1.
- V2: source title, exact numeric version 2, count and `private.rounds`; rebuild
  `public:{title,formatVersion:2,roundCount,state:{phase:'lobby',roundId:'r01',revision:0}}`.

Pass the detached candidate through the exact reviewed
`scripts/event-setup/core.cjs` validator from #75. It enforces v1 `r1`, v2 1–20
contiguous `r01`–`r20`, canonical links with omitted endpoints, exact fields,
coordinates/POV/difficulty and placeholder refusal. Preserve protocol version;
unknown/mixed setup fails closed. Source public clues/results/state progress are
expected on played games and are deliberately excluded before fresh-seed
validation. Reject mixed *configuration* (`private.round` plus `private.rounds`),
rather than silently choosing one. Never copy participants, slots, guesses,
published rounds, timing, reveals, totals or last-revealed state. No writes target
the source event.

Package this reviewed validator as server-only source in private deployment
staging, reproducibly copied from its canonical module; do not maintain another
validator in the browser/backend. Do not reuse the operator live factory: its
credential-file/CLI-confirmation boundary and connection shutdown behavior were
designed for an isolated operator process.

## Retry contract: one request, at most one fresh event

Use a private server-only ledger outside `events`, for example
`eventCreationRequests/<uid>/<requestId>`. Existing client rules must deny all
reads/writes there. No new field is added to the strict seed schema.

1. Atomically reserve an absent ledger record with immutable UID, source ID,
   validated seed snapshot, canonical seed digest and destination event ID.
   Derive the destination from a domain-separated SHA-256 of pinned project,
   UID and request ID, using a reserved prefix and at least 128 digest bits;
   keep it within the existing 80-character ID limit. It is an identifier, not
   an authorization secret. A repeated key for a different source conflicts.
2. Only after reservation is server-acknowledged, create `events/<destination>`
   in a transaction returning the reserved seed only when current data is
   `null`. SDK contention callbacks must abort on every existing value. Never
   use unconditional set, merge or a transaction over the database root.
3. Concurrent/successive calls with the same UID/key resume that reservation's
   exact snapshot. Reauthorize the user and source ownership. Changed gameplay
   progress is harmless; an observed immutable configuration change produces
   `stale-source` before a pending creation. A confirmed destination with the reserved host
   and canonical configuration proves an earlier create, including when its
   gameplay has since progressed; return the same links without modifying it.
   Any incompatible existing destination is a conflict, never an overwrite.

The immutable ledger and create-only event write need no cross-path transaction
or mutable completion flag. A crash after reservation resumes the same target;
a crash after event creation recovers by checking that target. Do not expire or
delete these small records automatically: their retention preserves idempotency
for this one-off event. An unconfirmed reservation must not start event creation.

Bound the whole handler to 30 seconds, below the platform request deadline.
Timeout after a write may have been dispatched returns `creation-unconfirmed`;
that write may later commit. Track late promises safely, never reconnect/retry
with a new key, and never take a shared Admin database connection offline to
cancel one request. An explicit retry with the same key is recovery, not a second
creation attempt with a new destination.

## Responses and browser behavior

Return `201 created` or `200 already-created`, destination `eventId`, and only
relative `{host,join,presenter}` paths matching the existing routes:
`/event/<id>/host`, `/event/<id>/join`, `/event/<id>/present`. Build any absolute
links from the browser's own origin; do not echo request Host or redirect input.
All API responses use JSON, `Cache-Control: no-store` and existing noindex/nosniff
headers; no private setup or token is returned.

| HTTP | Safe code / behavior |
| --- | --- |
| 400 / 405 / 413 / 415 | Fixed invalid-request/method/body/content-type errors. |
| 401 | Sign-in required; invalid, expired, revoked and wrong-project tokens reveal no token details. |
| 403 | Password host required, or disallowed origin. |
| 404 | Source unavailable; missing and wrong owner are indistinguishable. |
| 409 | Invalid/unsupported source, stale-source, request conflict or destination conflict; only disclose setup validity after ownership. |
| 503 | Service unavailable or creation-unconfirmed; retain the same request ID. |

Expose fixed actionable messages, never raw provider exceptions, account details,
answers, request bodies or credential paths. Application logs contain only safe
codes and an opaque correlation ID; verify platform logging does not capture
Authorization/body data or private firewall configuration.

Show “New game with these rounds” only in an authorized host view. Disable while
pending, keep the source view intact, and show all three links when confirmed.
Persist only the pending request/source identity, scoped by host UID, in session
storage before sending. Refresh/retry reuses it; sign-out/user changes must never
submit another user's attempt. Clear it on confirmed success, and issue a fresh
key only for an explicit subsequent New game action. On uncertainty offer “Check
creation again” using the same key; do not suggest that nothing was created.
Ignore late UI callbacks after event/user/view changes. Guest and presenter
surfaces gain no creation controls or privileged identity.

## Deployment boundary and remaining decisions

Current `app.yaml` serves assets and then SPA HTML entirely through static
handlers; `server.cjs` only returns 404. Insert this handler **before both**:

```yaml
handlers:
  - url: /api(/.*)?
    script: auto
    secure: always
  # Existing asset handler follows; SPA fallback remains last.
```

The Node server accepts only the exact operation path/method; all other `/api`
paths return JSON 404, including asset-looking paths. This reserves API requests
from the static `.json` matcher and HTML fallback. Retain static security/cache
headers, the existing hostname/native IP policy and terminal default-deny,
Firebase Hosting's disabled state, and the current scaling bounds. No new
gateway, function, host, CORS domain or forwarded-IP parser is needed.

Use managed Application Default Credentials on a **dedicated runtime service
account**, with only required Auth user-read/revocation-check and RTDB data
read/write capabilities at the smallest supported IAM resource scope. Bind the
adapter to the one pinned instance. Inspect current IAM first; verify exact
permissions/resource scope/custom-role support against the APIs, and keep deployment/build/
service-account-use roles on the deployment identity. Runtime needs no owner/
editor, Auth user-management/custom-token signing, key-file or deployment role.
Admin RTDB access bypasses client rules and IAM does not enforce per-event paths;
the supported grant may also cover other databases in the project. This residual
data capability requires explicit review. Path
restriction here comes from the bounded handler/adapter, not an invented
path-scoped IAM grant. If that capability is unacceptable, a separate rules-
enforced server identity is another design/review slice, not a silent fallback.

Activation still needs evidence of the deployed version/service identity and
permissions, usable ADC, pinned Admin dependency/runtime compatibility, correct
Firebase token audience/password-provider/revocation behavior, and current
native firewall coverage of dynamic requests and alternate hostnames. The
service currently has no Admin dependency; adding its isolated package/lock is
explicit implementation scope. These are unresolved deployment/provider checks,
not evidence that new APIs or broad roles must be enabled. Prepare/test/review
the concrete artifact first; any live deployment or IAM change follows the
existing authorization boundary separately.

## Two bounded implementation tasks

**A — server operation and evidence.** Own `deployment/appengine-test/**`
(including isolated package/lock and staging documentation), new
`tests/integration/event-creation/**`, and a new private-staging build script if
needed. Consume #75's validator without editing its schema. Implement routing,
token/ownership checks, reservation and create-only adapter; independently review
security and concurrency before publication. No frontend or live IAM/rules/
firewall/deployment edits. Emulator proof uses fixed demo/loopback guards.

**B — host action after A's contract is stable.** Own new
`src/event/creation.js`, its host-client wiring in `src/event/host.js`, a shared
host creation component, the v1/v2 host pages and corresponding unit/page tests.
Keep guest/presenter routes unchanged; use dependency-injected HTTP for offline
tests. Coordinate host.js ownership with runtime work before editing. A separate
authorized private-host smoke check follows both tasks; it is not part of a
unit-test pass or automatic deployment.

Acceptance evidence must cover:

- Real/emulated password-token verification; anonymous/other provider, wrong
  project, expired/revoked/disabled user, missing token and wrong host rejected;
  missing/non-owned source indistinguishable. No private data in responses/logs.
- V1 and v2 with 1/2/20 rounds, played and completed sources; exact fresh seeds
  accepted by the real runtime. Unknown/mixed/malformed setup rejected, no old
  members/guesses/results/timing/progress copied, source bytes unchanged.
- Five concurrent same-key requests and double clicks create one event; distinct
  explicit keys create distinct events. Key reuse with another source conflicts.
  Account/key isolation, occupied target, invalid source and changed setup fail
  closed. Existing destination progress is preserved on successful recovery.
- Crashes/uncertain acknowledgement before and after ledger/event commit, late
  acceptance, refresh and retry all converge on the same ID without overwrite;
  unrelated in-flight requests keep working. No public ledger access.
- Actual server and handler-order tests for POST/GET/HEAD/OPTIONS, `/api`, unknown
  `/api/*`, `.json` suffixes, oversized/extra input, SPA refresh and asset paths;
  JSON errors never become cached HTML. Host login/action/pending/retry/three-link
  flow, sign-out and stale callbacks tested with guest/presenter identity isolation.
- At separately authorized activation: allowed/denied networks across API,
  assets and alternate hostnames, forged forwarded headers, unchanged native
  firewall, and restricted runtime IAM. No readiness claim from local tests alone.
