# Firebase Hosting setup and route check

The root `firebase.json` configures Firebase Hosting to publish the Vue CLI `dist` directory and send application paths to `/index.html`. This supports the Vue Router history routes, including `/event/<id>/join`, `/event/<id>/host`, and `/event/<id>/present`, on refresh and direct navigation. `src/router.js` uses `mode: 'history'`, so the site must be hosted at the domain root with `VUE_APP_PUBLIC_PATH=/` (the default).

Build with the supplied browser configuration for the intended Firebase project. Keep settings in an ignored local env file or secure build environment; `VUE_APP_` values are compiled into public browser code, and must not contain Admin SDK credentials. Check the production configuration before compiling, then build and check the output:

```sh
node scripts/hosting-preflight.cjs --config-only
npm run build
node scripts/hosting-preflight.cjs
```

The script reads `.env.production.local`, `.env.production`, `.env.local`, and `.env` in Vue CLI's production-file precedence, with shell variables taking precedence. It rejects dotenv variable interpolation on either checked setting because Vue CLI expands those references during the build and this preflight does not reproduce dotenv-expand. Both invocations reject `VUE_APP_EVENT_EMULATORS=true` and a non-root `VUE_APP_PUBLIC_PATH`; the full output check also fails if `dist/index.html` or a JavaScript bundle is missing. It reports setting names and general errors without echoing configured values. Run the config-only check immediately before `npm run build` so the built output uses the checked configuration. This is an operator sequence, not cryptographic provenance: the script does not inspect every compiled asset for test data, secrets, or unsafe configuration.

For the supplied Firebase project, use its exact project ID explicitly in the CLI command. Set `FIREBASE_PROJECT_ID` in your shell from the supplied project configuration, verify it against the Firebase Console, and deploy Hosting only:

```sh
firebase deploy --only hosting --project "$FIREBASE_PROJECT_ID"
```

This configuration has no Firebase project alias and does not include database rules or emulator deployment settings. Do not use `firebase deploy` without `--only hosting` as part of this hosting procedure. No public deployment or live project change is included in this setup.

Before inviting rehearsal guests, check the supplied project's Firebase Authentication authorized domains for the deployed Hosting domain, confirm the required Authentication providers are enabled (Email/Password for the organizer and Anonymous for guests), verify the Maps browser key's HTTP referrer restrictions include the exact deployed origin and its APIs/billing/quota are enabled, and review the current Realtime Database rules. Hosting configuration does not install rules, create an organizer account, or seed an event. The event must already be seeded with the organizer's actual UID and valid round setup under the separate event rehearsal procedure; never replace existing project rules with an event-only fixture.

After an authorized deployment, open a direct route such as `/event/<test-id>/join`, refresh it, and confirm it serves the app rather than a Hosting 404. Repeat for `/event/<test-id>/host` and `/event/<test-id>/present` if those routes are being rehearsed. This verifies Hosting rewrites and client-side route loading only; HTML fallback alone does not establish working multiplayer. It does not verify authentication, database rules, event setup, browser API configuration, Google Maps/Street View, provider billing, device connectivity, or live gameplay.

The preflight checks explicit emulator selection and the configured public path. It cannot establish that every compiled asset is free of test data, unsafe configuration, or credentials. Review the build inputs and generated artifact separately; browser `VUE_APP_` settings are public configuration and must never contain Admin SDK credentials.
