# Project instructions

## Scope and sources

- Build a one-off, host-led birthday game for at most 50 guests. Prefer simple, forgiving interactions for older and inexperienced players over SaaS infrastructure.
- Read `docs/event-requirements.md`, `docs/current-state-gap-analysis.md`, `docs/implementation-roadmap.md`, and the relevant live GitHub issue before implementation. Issues #1–#9 are the persistent task/status tracker; use B01–B09 in branches and commits.
- Retain Vue 2, Firebase Realtime Database, and Google Street View unless evidence justifies a change. Personal photos/stories are optional P2 work after core gameplay.
- The host controls start, close, reveal, and next round, including extending time during play. Venue-first is optional; gentle introductory pacing is required.
- Keep a read-only presentation view safe to project. Prefer separate admin and presentation pages; never expose admin credentials, private setup, or unrevealed answers there. Host/presenter must not consume guest slots.

## Orchestration and delivery

- Refine only the next useful implementation slice, with acceptance checks, dependencies, and concrete evidence. Do not design the entire system upfront.
- Delegate independent, bounded tasks when useful. Prefer faster/cheaper models for routine tests/docs; reserve stronger reasoning for session architecture, concurrency, access rules, and critical review.
- Give each agent explicit file ownership. Agents share the checkout: do not overlap edits or run Git mutations concurrently. The lead integrates, reviews, tests, commits, and publishes.
- Use the existing isolated checkout; do not create worktrees unless the user asks. Preserve existing changes and use a feature branch.
- Keep focused PRs linked to the relevant issue. Record progress, blockers, and decisions in GitHub. Close issues only after their acceptance criteria have evidence. If GitHub writes are blocked, preserve work on a branch, report the exact failure and direct issue links, and do not claim updates or PRs were created.
- **Never merge into the default branch (`master` here; also applies if renamed `main`) without the user's explicit approval.** Development-branch staging is allowed. Do not deploy publicly or change live cloud access rules merely to make tests pass.
- Require an independent review of synchronization, admission, scoring, and security changes before proposing them for merge. Report unresolved findings and unrun checks plainly.

## Development and validation

- Use Node from `.nvmrc` and `npm ci`; preserve the dependency lockfile unless dependency work is explicitly in scope. In this cloud environment, activate shared tools with `. /workspace/.geoguess-tools/env.sh` when present. It supplies pinned Node/npm, Xvfb and writable caches without credentials; shell calls otherwise start fresh. Reuse the activation file instead of repeating exports. Isolated emulator tools use their documented Node 24 runner.
- From the repository root: `npm run serve`, `NODE_ENV=production npm run lint -- --no-fix`, `npm run test:unit -- --runInBand`, and `npm run build`. See `docs/development-baseline.md` for setup and live smoke checks.
- Run relevant tests and required checks for changed behavior. Keep unit tests offline with realistic service responses; verify live providers separately. Do not weaken assertions, hide failures, or equate a homepage test with working multiplayer.
- Test 50-client admission, guest 51 rejection, refresh/reconnect, duplicate actions, missed guesses, and read-only presenter behavior before claiming event readiness. No random lucky points for non-submissions.
- Shared session state and server-enforced access boundaries must govern gameplay; UI hiding alone is not authorization. Guest disconnect/unmount must not delete or advance the session.
- Never commit credentials, service-account files, personal venue data, or real event configuration. Browser API keys are visible: restrict them with provider controls, not obscurity. Inspect variable presence only and use secure settings for values.
