# Provider and cost preflight for a rehearsal

Use this checklist before inviting guests to a real Google/Firebase project. It records public documentation pointers and an estimate model; it does not certify that the supplied project is configured or free.

## Evidence boundary

The project and browser configuration were supplied, but their live settings have not been inspected. Authentication providers, organizer UID, Realtime Database instance/region/rules, Maps key restrictions, enabled APIs, quotas, billing account, alerts, hosting origin, and deployed rules remain unverified. Direct Chromium requests hit `ERR_CERT_AUTHORITY_INVALID`. A subsequent probe used Playwright's TLS-verifying request transport to fetch real Google responses: Maps JavaScript and panorama metadata loaded, but visual inspection showed “This page can’t load Google Maps correctly” and no panorama tiles were verified. This is not a successful live-imagery test or proof of billing/referrer/API configuration. No certificate checks were disabled.

An attempt to read the official pages below from this environment failed at the network proxy with `CONNECT tunnel failed, response 403` for `developers.google.com`, `firebase.google.com`, and `cloud.google.com`. Links are provided as official starting points, not as independently verified current price or quota statements. Check each page and the project's own current pricing/usage screens immediately before rehearsal. No prices or included allowances are asserted here.

## Maps and Street View estimate

The event client uses the Maps JavaScript API, creates a `StreetViewPanorama` for each playing browser and a map for guesses. Its clue uses an explicit panorama ID. The retained legacy game also uses `StreetViewService` for lookups; count those separately when exercising that path or a lookup tool. These operations can map to different billable SKUs and usage rules; count them separately in the Google Maps Platform usage/pricing reports rather than assuming one “map load” covers the whole game.

For a planning maximum of 50 guests and **R** rounds, a deliberately simple baseline planning count is:

- up to `50 × R` guest panorama presentations, assuming each guest opens every round once;
- up to `50 × R` guest map/game page sessions if each round causes a separate page/session load;
- add host/presenter sessions, retries, refreshes, panorama lookups, and any preview/rehearsal sessions separately.

This is a workload estimate, not a billable-event count: actual SKU counting, session rules, retries, and caching behavior must be checked against current provider documentation and observed usage. The current event flow has one round; multi-round behavior and 50 live guests have not been verified. Run a small real-device rehearsal, inspect per-SKU usage, then project cautiously to the planned round count. Do not infer cost from a displayed quota or from a successful two-phone test.

Official references to check:

- [Maps JavaScript API usage and billing](https://developers.google.com/maps/documentation/javascript/usage-and-billing)
- [Google Maps Platform pricing](https://developers.google.com/maps/billing-and-pricing/pricing)
- [Google Maps Platform quotas](https://developers.google.com/maps/documentation/javascript/usage-and-billing#usage_limits)
- [Street View service](https://developers.google.com/maps/documentation/javascript/streetview)
- [Google Cloud budgets and budget alerts](https://cloud.google.com/billing/docs/how-to/budgets)

## Key, authentication, database, and operations checks

1. **Browser key:** Restrict the Maps JavaScript key to the exact deployed HTTPS referrer(s), including the intended host and any required subdomain pattern. Restrict it to only the APIs the app needs. Test from the expected origin and confirm an unintended origin is rejected. Browser keys are visible in delivered JavaScript; restrictions are the protection. Do not reuse a browser-restricted key for a server web service.
2. **Billing and alerts:** Confirm the intended Google Cloud project, billing account, enabled Maps APIs, per-SKU quotas, and current usage. Set budget notifications at useful thresholds and add the relevant recipients. A budget/alert is a notification mechanism; it does **not** stop usage or cap charges. Review quotas separately and understand their effect before changing them. No live billing, key, quota, or alert settings were changed for this checklist.
3. **Firebase Auth:** In the supplied Firebase project, verify Anonymous sign-in is enabled for guests and Email/Password is enabled for the organizer. Verify the organizer's durable account and actual UID match the event's `hostUid`. Do not put passwords or service credentials in the client or repository.
4. **Realtime Database:** Identify the actual instance and region, inspect current deployed rules, and review reads/writes and bandwidth in the Firebase/Google Cloud usage views during rehearsal. Region is selected when the database is provisioned; verify the existing instance rather than assuming a default. Merge event access rules with existing legacy room rules and test both; do not replace live rules as a cost-preflight shortcut. Database location/rules for the supplied project remain unverified.
5. **Rehearsal monitoring:** Record start/end time, guest and host/presenter counts, rounds, refresh/retry count, Maps per-SKU usage before/after, Firebase reads/writes/bandwidth, and any quota/billing errors. Compare the delta with the model above. Keep screenshots/notes free of keys, tokens, personal location data, and account details.
6. **Cleanup:** Close the rehearsal, remove only the explicitly identified disposable event data using a reviewed trusted procedure, and confirm no public test deployment or temporary test origin remains. Do not clear the whole database or disable billing/key protections as cleanup.

Firebase references:

- [Anonymous Authentication](https://firebase.google.com/docs/auth/web/anonymous-auth)
- [Email and password Authentication](https://firebase.google.com/docs/auth/web/password-auth)
- [Realtime Database usage and limits](https://firebase.google.com/docs/database/usage/limits)
- [Choose project locations](https://firebase.google.com/docs/projects/locations)
- [Realtime Database security rules](https://firebase.google.com/docs/database/security)

Actual project settings and current prices/allowances still require verification in the provider consoles and the linked current documentation. No provider settings or live data were changed.
