# Birthday event requirements

Status: initial baseline, 2026-10-26. This document records the event requirements before implementation choices. See [gap analysis](current-state-gap-analysis.md) and [roadmap](implementation-roadmap.md).

## Purpose and format

A single, live, host-led GeoGuessr-style game at a birthday celebration. Locations are personally significant to the birthday person. Guests use their own phone/browser; an organizer controls play and can project round results and rankings. This is **not** a join-anytime/asynchronous challenge.

## Priorities

- **P0 — event must work:** minimum viable experience, including operating safely with up to **50 concurrent participants** (planning maximum, not an expected attendance count).
- **P1 — convenience:** useful setup improvements that are not essential to conduct the event.
- **P2 — optional:** enhancement only if the core event is ready.

## Requirements

| ID | Priority | Requirement | Observable acceptance condition |
| --- | --- | --- | --- |
| R01 | P0 | Host-led single session | Organizer can open a lobby, start a common game, reveal each result, and move everyone through the same ordered rounds. No arbitrary drop-in game mode is required. |
| R02 | P0 | Phone/browser joining | Guest scans a QR code or opens its URL, enters a nickname, and joins without creating an account. Lobby clearly shows who is present; max 50 playing guests. |
| R03 | P0 | Accessible first round | **Round 1 is the real-world event venue**, using a fixed Street View location and sensible starting camera direction. It acts as a gentle introduction, with no forced fast progression; host can explain how to play. |
| R04 | P0 | Curated exact locations | Organizer chooses every round's location and order, plus initial Street View **heading and pitch** (and a stable panorama identifier where feasible). Random locations are not used for this event. |
| R05 | P0 | Adjustable pacing during play | Host can change remaining round time **while a round is in progress** (at least extend time, ideally pause/resume), end a round, and choose when to advance. All players see consistent status. |
| R06 | P0 | Simple guessing | Players inspect Street View, place a pin on a map, and submit one guess per round. Clear confirmation, readable controls, and a reasonable timeout/no-answer outcome. |
| R07 | P0 | Results and leaderboard | After a round closes, reveal the correct location, show distance-based points, update cumulative rankings, and provide a readable **projector/presenter view**. Other players' guesses must not reveal the answer during an active round. |
| R08 | P0 | Robust event operation | Support up to 50 joined players; short network interruptions or page refreshes should not destroy the session or duplicate scores. Organizing and testing should not require guest accounts. |
| R09 | P0 | Cost-aware deployability | Document Google Maps/Street View and Firebase requirements, protect API keys using provider restrictions, review quotas/billing, and rehearse real-device access before the event. Do not assume the event is automatically free. |
| R10 | P0 | Low-friction accessibility | Designed for inexperienced and older guests: readable text, large tap targets, minimal navigation, visible instructions, obvious feedback, and no need to interact quickly. |
| R11 | P1 | Convenient event setup | Prefer a reproducible way to save, validate, and edit the ordered round configuration without code changes; a simple configuration file is acceptable for an initial event. |
| R12 | P2 | Optional personal media | Host may show personal/historical photos or stories **after** guesses are locked. Not required for the guessing phase, because such imagery may make the location too obvious. |

## Explicit boundaries

- Live synchronized session only; **no join-anytime game mode** is needed.
- Street View is acceptable and preferred over building a custom photo viewer for the core game.
- A full Google Maps replacement, user accounts, ongoing public tournaments, and elaborate anti-cheat mechanisms are **not** MVP requirements.
- No personal/historical photos should be shown *as clues during guessing* by default.
- "Up to 50" is a functional test target, not evidence that the current fork supports 50.

## Questions intentionally deferred until implementation

These are **not blockers for documenting the backlog**: exact venue and round coordinates; number of rounds; initial/default duration and whether the tutorial round is initially untimed; movement/zoom policy; whether timing needs pause plus extend or extend only; preferred deployment host and data-retention policy. Resolve the smallest relevant decision when implementing that feature.

## MVP acceptance scenario

Host opens a joinable lobby and projects its QR code; up to 50 guests enter nicknames on phones. Host starts round 1 at the event venue with the selected panorama orientation, gives newcomers time to orient themselves, and adjusts the live timer if needed. Guests pin and submit guesses. Host ends the round, reveals the location, discusses its significance, and displays the live cumulative standings. Subsequent curated rounds proceed in order. Temporary guest disconnections do not end the event.
