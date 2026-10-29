# Event rehearsal rules deployment review

This is a review artifact for the first single-round rehearsal. It targets Firebase project `customgeoguess` and the explicitly supplied Realtime Database instance `customgeoguess-default-rtdb`. The candidate rules are a byte-for-byte copy of the emulator-tested v1 event-round rules; they contain no legacy room grants and deny undeclared paths.

**Effect to review:** deploying this event-only ruleset would deny access to legacy room data and any undeclared paths in the selected database. It does not preserve unknown current rules or merge existing grants. Before any deployment, an operator must verify the instance is isolated or explicitly accept that effect, inspect and privately back up its current rules, verify the exact project and database target, and use project-bound credentials. The rehearsal event must also be seeded with the intended organizer UID and valid setup. Those conditions are unverified here. No deployment, live rules read, credential use, seed, or cloud change was performed.

The config targets one instance explicitly. Firebase CLI 14.19.1's installed `lib/database/rulesConfig.js` accepts database config entries with `instance` and `rules` (and otherwise requires `target` or `instance`); `lib/deploy/database/prepare.js` resolves and syntax-checks the configured rule file. This is local installed-CLI source evidence only; deployment has not been tested. The repository root `firebase.json` remains Hosting-only.

The v2 session proof/source is not included. These rules reproduce the v1 single-round emulator fixture and do not establish v2 behavior or compatibility with legacy room access. Any combined rules candidate requires separate tests for both protocols before use.

For a future, separately reviewed deployment, the explicit command would be:

```sh
firebase deploy --only database --config firebase.rehearsal.json --project customgeoguess
```

Do not run it until the target, current-rules backup/inspection, and isolation-or-effect decision above are complete.
