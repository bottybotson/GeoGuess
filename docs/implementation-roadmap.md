# Implementation roadmap and issue conventions

Based on [requirements](event-requirements.md) and [source gap analysis](current-state-gap-analysis.md). High-level scope comes first; solution specifics are defined when an issue is implemented. This roadmap is planning documentation, not a statement that the features have been built.

## Priority / tracking

- **P0** — indispensable for the event, including validation and rehearsal.
- **P1** — beneficial, not a launch blocker.
- **P2** — optional, after event-critical flow is complete.
- Use [GitHub Issues #1–#9](https://github.com/bottybotson/GeoGuess/issues) as the authoritative task and completion tracker, with stable B01–B09 IDs indexed in [backlog](backlog.md). Each issue references requirements and includes acceptance criteria. Prefer short PRs implementing one vertical feature. **No code changes in this planning phase.**
- Track status in GitHub issue open/closed state and its acceptance checklist rather than maintaining a duplicate status table. This roadmap records sequencing and boundaries.

## Delivery sequence

### Stage A — baseline, reliability and implementation design (P0)
- Deploy the unchanged fork in a development/test environment and document required Google/Firebase configuration, costs, quotas, and security baseline.
- Reproduce its multiplayer flow and map its Firebase room state, lifecycle, account/no-account join and cleanup.
- Define and exercise a host-owned session and stable participant model before enabling 50 guests; test concurrency and reconnects.

**Exit criteria:** one reproducible dev run and a validated approach for 50 players, host independence, reconnect and round status.

### Stage B — birthday event gameplay (P0)
- Ordered event rounds with exact locations, starting heading/pitch and optionally panorama ID. Round 1 fixed to the physical event venue.
- Host owns opening/starting/closing/revealing/advancing each round, including deliberately slow tutorial pacing.
- Shared live timer with extend/modify during play and sensible handling of non-submissions.
- Nickname-only QR/browser join, 50-player admission, mobile guess/submit.

**Exit criteria:** complete synchronized multiplayer rehearsal, no random round locations, host can extend time mid-round.

### Stage C — results and usability (P0)
- Fair round scoring, result reveal, leaderboard and projector/presenter screen.
- Older-guest usability pass: large controls, brief instructions, legible typography, reassuring submissions and an easily taught first round.
- Real phones and realistic connectivity; target **50 joined guests** and a full-length practice game.

**Exit criteria:** host can present a full event without requiring guests to understand GeoGuessr.

### Stage D — preparation convenience (P1)
- Event definition file or lightweight round editor; preflight panorama preview, camera direction and venue sanity checks.
- Optional host diagnostics and export if needed to run the event.

### Stage E — extras (P2)
- Optional personal/historical photos and captions shown **only after** all guesses are locked; no historic photos as default location clues.
- Defer non-essential redesign and geographic imagery vendor replacement.

## Core design constraints

- Distinct host and guests, and distinct lobby / active round / results / complete states.
- All clients observe the same authoritative active round and close time. Player refreshes/reconnects must not advance or delete the game.
- Stable participant IDs and idempotent guess submission. Limit admission to 50 playing guests; projector/host is a separate role.
- Commit minimal data needed to score; do not expose exact answers to guests until reveal if avoidable, noting client-side Street View always presents some metadata.
- Verify API restrictions/usage and database access permissions; avoid storing private event personal details in the public repository.
- Treat implementation details as proposals until validated in their issue/PR.

## Launch gate

All P0 GitHub issues complete based on tested acceptance criteria, not just code committed. Complete a host-run rehearsal: scan QR on phones, 50-player concurrency/reconnect test, selected starting panorama, adjustable timer, late/non-submitting players, reveal, projector leaderboard, final standings and cleanup. Review billing alerts/quotas and deploy URL before the event.
