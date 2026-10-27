# First two event worker contracts

These are bounded foundations for B02/B06, not a deployed event protocol. They deliberately leave Firebase authentication, database paths/rules, transactional integration, live rounds and routing to subsequent lead-owned work. Do not wire either module into legacy multiplayer or change the live database. Parent issues #2 and #6 remain open after these tasks.

## Worker A: pure lobby admission policy

Own `src/event/admission.js` and `tests/unit/event/admission.spec.js` only. Export `MAX_GUESTS = 50` and `planAdmission(state, request)` as named exports. No Firebase, browser storage, clock, network or framework imports.

The caller supplies a trusted authenticated identity later; accepting a UID string in this pure function is **not authorization**. `state` is an object with:

```js
{
    hostUid: 'host_1',
    phase: 'lobby', // lobby | guessing | reveal | complete
    participants: { guest_1: { nickname: 'Guest' } }
}
```

Participant keys are stable identities, never counts or nicknames. For this initial contract, identity strings contain only ASCII letters, digits, `_` or `-`, and are 1–128 characters. A valid state has a valid host UID, one of the four phases, and an own-property participant map (not an array/null). It contains at most 50 entries, no host entry, and each entry has a valid identity and a nickname. A nickname is a trimmed string of 1–20 Unicode code points; reject invalid names instead of truncating them. Extra state/participant fields must be preserved unchanged. The state is caller-supplied; reject malformed state rather than guessing defaults or repairing it.

`request` is `{ uid, nickname? }`. Return exactly `{ status, nextState }`, using this order:

1. Invalid state or invalid/missing request UID: `invalid`, `null`.
2. UID equals host UID: `host`, `null`; the host never takes a guest slot.
3. UID is an existing **own** participant key: `rejoined`, the original state unchanged, even at capacity or outside the lobby. Ignore the requested nickname; reconnect must not overwrite identity, nickname or extra fields such as scores.
4. New UID outside the lobby: `started`, `null`. New arrivals wait for the next session; existing guests may reconnect.
5. Invalid/missing new-guest nickname: `invalid`, `null`.
6. Already 50 participants: `full`, `null`.
7. Otherwise: `joined`, a new immutable state with the new `{ nickname: trimmedName }` participant and all other fields preserved.

No argument may be mutated, including on failure or repeat calls. Only `joined` creates a changed state. Guard prototype/inherited-property cases; never use truthiness or `in` for membership. This function neither removes guests nor handles scores, presence, auth persistence or transactions.

Acceptance tests must exercise 50 sequential distinct admissions, rejection of guest 51, idempotent rejoin at capacity/each phase, late-newcomer rejection, host exclusion, invalid state/UID/nickname, Unicode boundaries, inherited/prototype-like keys, and preservation of unrelated fields with frozen inputs. A pure sequential simulation does not prove concurrent RTDB admission. Integration must later apply this policy inside one transaction and be verified with independent emulator clients and server-enforced rules.

## Worker B: passive lobby presentation component

Own `src/components/event/EventLobbyPresentation.vue` and `tests/unit/components/event/EventLobbyPresentation.spec.js` only. This Vue 2 component receives these individual props; it must not import Worker A or accept a raw session/database snapshot:

```js
{
    title: 'Birthday GeoGuess', // optional string, this default
    phase: 'lobby',             // same four phase names as above
    joinUrl: 'https://example.test/event/demo/join', // optional PUBLIC display text
    participants: [{ id: 'guest_1', nickname: 'Guest' }] // default []
}
```

The future lead-owned projection adapter supplies only guest names/IDs and public status. It excludes the host, admin URLs/tokens, private setup, answers, guesses and scores. The presenter renderer does not establish a database security boundary.

Render a semantic heading, number of guests out of 50, and the names as a list with stable ID keys. Empty lobby should say that guests are welcome and waiting for the host. In `lobby`, show a supplied join URL as readable plain text (no clickable arbitrary URL, QR dependency or navigation). Hide it once guessing begins. Use simple phase messages for `guessing`, `reveal`, and `complete`; the latter states have no round/results implementation yet. Unknown/missing phase must show an unavailable status and no join prompt. Escape user-supplied strings normally; never use `v-html`. Disable automatic inheritance of unknown attributes so a mistakenly passed private field is not rendered as an HTML attribute.

Keep typography readable on a projector and layout usable on a narrow screen: large text, clear contrast, wrapping long titles/names/URLs, no motion and no reliance on colour alone. English labels are acceptable for this isolated slice; integration must choose the event language before guest-facing rollout.

No Firebase/auth/store/router imports, subscriptions, timers, storage writes, emitted commands, form controls, lifecycle cleanup or legacy StreetView/Maps/room-dialog components. This task is a render-only component, not a new live route or a working presenter service.

Tests must verify the empty and populated lobby, reactive prop changes, stable list entries/duplicate nicknames, all phase messages, missing/unknown phase fallback, join URL hidden after lobby, string escaping, no leaked unknown attributes, and no emitted control events on mount/update/unmount. Test real rendered behavior instead of snapshots alone. Do not claim that render-only tests prove server-side read permissions or projector rehearsal.

## Integration and review

Both workers can start independently against this contract. The lead alone owns shared router/store/manifests/lockfiles and Git operations. Do not broaden file ownership without coordination. Use existing dependencies and test setup; each worker runs its focused suite and reports exact outcomes.

The lead reviews both changes and requests stronger independent review of admission invariants before publishing focused PRs. Never merge `master`/`main` without explicit organizer approval. A later B02 slice must resolve host authentication/recovery, stable anonymous identity, database/rules design and emulator concurrency before wiring any live service. Those are engineering decisions to refine next, not prerequisites for these two isolated modules.
