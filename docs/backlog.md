# Implementation backlog

Last reviewed 2026-10-26. **GitHub Issues are enabled and are the authoritative task/status tracker:** [All project issues](https://github.com/bottybotson/GeoGuess/issues). This document is a retained high-level feature index; live task status and acceptance checklists are in the individual issues. Source of truth for requirements: [event-requirements.md](event-requirements.md). Evidence: [current-state-gap-analysis.md](current-state-gap-analysis.md). Sequence: [implementation-roadmap.md](implementation-roadmap.md).

All nine issues were created on 2026-10-26 with their acceptance criteria; no implementation work has been completed as part of this issue migration. Scope is intentionally high-level; detailed technical solutions are determined during implementation.

## P0 — must have

### [B01](https://github.com/bottybotson/GeoGuess/issues/1) · Establish runnable fork, cost/security baseline and multiplayer smoke test
**Stage A · Requirements R08, R09 · Status: See linked GitHub issue**

- Reproduce the unchanged fork in a dev deployment, document Firebase + Maps configuration (without committing credentials).
- Test two mobile browsers from lobby through guessing and results.
- Verify Firebase access rules, browser key restrictions, Street View billing SKUs, quotas/alerts and cleanup.
- Deliver clear deployment and recovery instructions. Do not assert current load/cost estimates are verified.

### [B02](https://github.com/bottybotson/GeoGuess/issues/2) · Robust host-owned lobby and maximum 50 guests
**Stage A · Requirements R01, R02, R08 · Status: See linked GitHub issue**

- Separate the host/projector role from guessing guests.
- Guarantee unique/stable player identity under 50 simultaneous joins and reconnects; politely reject player 51.
- Rejoining must not reset totals, duplicate guesses or destroy the lobby.
- Session does not disappear when a guest/browser closes; review access controls.
- Explicitly define policy for arriving after game start (no asynchronous challenge required).
- Demonstrate concurrency-safe admission/reconnect at scale, not just a numerical cap.

### [B03](https://github.com/bottybotson/GeoGuess/issues/3) · Curated Street View rounds and venue-first introduction
**Stage B · Requirements R03, R04 · Status: See linked GitHub issue**

- Define ordered rounds with selected coordinates and heading/pitch, optional stable panorama ID.
- First round is **the physical event venue**, with a slow host-led demonstration.
- All players start with consistent intended panorama and angle; no random event rounds.
- Detect missing/shifted Street View and offer setup validation.
- Do not reveal stored answers before the round is closed.

### [B04](https://github.com/bottybotson/GeoGuess/issues/4) · Host-controlled round state and adjustable live timer
**Stage B · Requirements R01, R03, R05 · Status: See linked GitHub issue**

- Host starts, closes/reveals and advances rounds explicitly; all clients follow.
- Host can change remaining time **during** a round (minimum extend, preferably pause/resume).
- Clients display consistent time/status and survive refresh/reconnect.
- Host can finish a round even if players have not guessed; non-submissions are handled fairly (not random lucky points).
- No player-driven auto-advance; double events do not advance twice.

### [B05](https://github.com/bottybotson/GeoGuess/issues/5) · QR-code joining and accessible mobile guessing
**Stage B/C · Requirements R02, R06, R10 · Status: See linked GitHub issue**

- Show scannable QR with fallback join URL; nickname only, no account.
- Work on common iOS/Android browsers and narrow screens.
- Large controls, clear instructions, map pin placement, visible guess confirmation and duplicate-submit protection.
- Helpful full-lobby, reconnection and missed-round messages.
- Validate first-time use with guests unfamiliar with GeoGuessr.

### [B06](https://github.com/bottybotson/GeoGuess/issues/6) · Reveal, distance scoring and projected live leaderboard
**Stage C · Requirements R01, R07 · Status: See linked GitHub issue**

- Host closes guessing, reveals correct location and distance-based points.
- Cumulative scores/ranks are consistent and readable on projector screen; final ranking remains visible.
- Guess details are not shown to other players during active guessing.
- Allow host to pause between rounds and tell the significance of each location.
- Avoid repeated scoring on refresh or repeated submissions.

### [B07](https://github.com/bottybotson/GeoGuess/issues/7) · Full 50-player load, accessibility and billing rehearsal
**Stage C · Requirements R08, R09, R10 · Status: See linked GitHub issue**

- Test with **50 joined clients** and interruptions/reconnections, including slower phones.
- Exercise the first venue-based tutorial, mid-round time extension, non-submitters, result reveal and final leaderboard.
- Validate projected legibility, keyboard/touch usability, deployment checklist and recovery.
- Measure actual API usage/cost and confirm quota/budget safeguards.
- Record failures and only mark completed after blocking defects are fixed.

## P1 — quality-of-life

### [B08](https://github.com/bottybotson/GeoGuess/issues/8) · Reproducible event configuration and camera preview
**Stage D · Requirements R04, R11 · Status: See linked GitHub issue**

- Save ordered rounds, titles, coordinates, heading/pitch, optional panorama IDs and post-reveal descriptions.
- Preview and validate selected views/venue before the event.
- Configuration file acceptable; no elaborate admin UI required.
- Avoid inadvertently publishing sensitive personal locations in this **public fork**.

## P2 — optional

### [B09](https://github.com/bottybotson/GeoGuess/issues/9) · Personal media revealed after guessing
**Stage E · Requirement R12 · Status: See linked GitHub issue**

- Optional photos/stories after each round is locked; never required as an initial location clue.
- Host can control the presentation without affecting scoring or sync.
- Does not block event readiness.

## Working convention

Use references B01–B09 in branches, commit messages, and future GitHub issues. Requirements remain distinct from solutions; when asked to implement an item, review the relevant files, propose the smallest safe change, add tests, and document findings. Do not treat the current README's five-friend feature claim as proof that 50 works.

**Tracking:** Open or close the linked GitHub issue after its acceptance criteria are verified. Do not maintain a separate manual status in this overview.
