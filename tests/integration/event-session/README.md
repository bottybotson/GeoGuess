# Isolated version-2 session Rules proof

Candidate-only protocol for issue #57. This directory's `rules.json` is tested
with the actual application `src/event/session.js`, imported through Babel's
CommonJS import transform only, using application Firebase SDK **8.10.1**.
Nothing routes to this adapter or deploys these rules. Version-1 files remain
unchanged; a later combined Rules file must explicitly exclude version 2 from
all v1 grants and rerun v1 regressions before deployment.

`generate-rules.cjs` expands the bounded phase/revision and s01–s50 completeness
expressions into the checked-in candidate `rules.json`; there are no loops or
unsupported `numChildren()` calls in Rules. It reuses the unchanged v1 canonical
nickname validator. Run `node tests/integration/event-session/generate-rules.cjs`
from the checkout to reproduce the candidate.

Use the existing isolated emulator tool installation described in
`../event-admission/README.md`: rules-unit-testing 4.0.1, tool Firebase 11.10.0,
Node 24.19, Firebase CLI 14.19.1 and Java 21. The application remains on Node 20.
From `/tmp`, with **exclusive ports 9009/9099**:

```sh
env XDG_CONFIG_HOME=/workspace/.geoguess-emulator-tools/config \
  XDG_CACHE_HOME=/workspace/.cache \
  FIREBASE_EMULATORS_PATH=/workspace/.cache/firebase/emulators \
  CI=1 timeout --kill-after=10s 300s \
  /opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node \
  /workspace/.geoguess-emulator-tools/node_modules/firebase-tools/lib/bin/firebase.js \
  emulators:exec --only auth,database --project demo-geoguess-admission \
  --config /workspace/GeoGuess/tests/integration/event-session/firebase.json \
  '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node /workspace/GeoGuess/tests/integration/event-session/run.cjs'
```

Both runners guard the exact demo project and loopback Auth/Database emulator
hosts before SDK imports, provider initialization or fixture credential creation.
Only the guarded test child clears HTTP_PROXY/http_proxy for SDK WebSockets;
the CLI retains normal artifact-download configuration. No login, live project,
service account, Street View or other provider call is needed. The outer and
child watchdogs bound startup, test execution and shutdown. Cancellation, timeout
and skipped tests are failures. Cleanup signs Auth out, takes DB offline and
naturally deletes apps; no forced success exit hides incomplete cleanup.

The trusted fixture creates immutable `hostUid`, public title/formatVersion 2/
roundCount/state and 1–20 contiguous private round setups. Setups use
`{id,panoramaId,heading,pitch,answer:{lat,lng},difficulty,previousRoundId?,nextRoundId?}`;
nonexistent boundary links are omitted. Actual anonymous SDK clients claim
reciprocal immutable participant/slot records during the initial lobby. Password
host identity is independent of all 50 seats. Public leaf reads need no identity.
Each reveal result is `{nickname,answered,points,totalPoints,distance?}`, omitting
distance and using zero points for non-submission. Totals recur from exactly one
prior immutable result; there is no mutable counter.

Verified 2026-10-29: **11/11 scenarios passed** in 102.1 seconds, zero skipped,
cancelled or failed tests; runner and CLI exit 0 with clean Auth/Database/hub
shutdown. The 50-guest/20-round and two r20 capacity variants took 5.68 seconds.
All six uncertain-acknowledgement cases used their real 15-second deadlines.

The sequential scenarios cover:

- Two actual rounds/two guests: concurrent starts/reveals/next/completion,
  missed guesses and zero points, reveal discussion pause, distinct next-ready
  and start, exact cumulative totals, duplicate same-UID guesses, reconnect,
  explicit old-round/revision rejection and immutable prior standings.
- A signed-out presenter: leaf reads without identity requests, null future
  clues/reveals, published canonical standings and denied private/ancestor reads.
- Matching-UID wrong provider, wrong host UID, invalid order/revision/links,
  malformed clues/guesses, protected setup/version/member/slot/deletion paths,
  immutable reveal/guess descendants and unknown-version denial.
- Initial empty lobby denial and the one-round lower boundary.
- Actual Rules `now` expiry, no automatic state progression, deliberate reopening
  through host extension, and old-round timing denial without copied deadlines.
- Fifty SDK guests over **20 real rounds**: 50 answered results, 50 unanswered
  results, mixed later results and exact round-20 recurrence; guest 51 denial;
  missing slot s50, altered total and missing prior result rejection. Two final
  capacity fixtures reuse that actual r19 history and separately publish r20
  with all 50 answered and all 50 unanswered through the application adapter.
- Accepted and rejected uncertain reveal, next and deadline acknowledgements:
  real SDK offline optimistic writes run through the actual 15-second deadline;
  new adapters and state/artifact readers share the pending-write barrier until
  the server accepts or rejects the original command after reconnect.

This is a bounded SDK/emulator protocol proof. Combined-rules compatibility,
routed UI, browser/phone networking, deployment, provider quotas and venue
rehearsal remain separate gates.
