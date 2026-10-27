import firebase from 'firebase/app';
import 'firebase/auth';
import 'firebase/database';
import { createGuestIdentity } from './identity';
import { createLobbyClient } from './lobby';

const DEMO_PROJECT = 'demo-geoguess-admission';
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const configuredDatabases = new WeakSet();

/** Separate event guests from legacy play and the future named host app. */
export function createEventLobbyRuntime(sdk, { emulators = false, mode, hostname } = {}) {
    if (emulators && (mode !== 'development' || !LOOPBACK.has(hostname))) {
        throw new Error('Event emulator mode requires local development.');
    }
    const name = emulators ? 'geoguess-event-demo-guest' : 'geoguess-event-guest';
    const options = emulators ? {
        projectId: DEMO_PROJECT,
        apiKey: 'demo-key',
        databaseURL: `https://${DEMO_PROJECT}.firebaseio.com`,
    } : sdk.app().options;
    const app = sdk.apps.find(candidate => candidate.name === name) || sdk.initializeApp(options, name);
    if (app.options.projectId !== options.projectId) throw new Error('Event project configuration mismatch.');

    let auth;
    if (emulators) {
        auth = app.auth();
        if (auth.emulatorConfig) {
            if (auth.emulatorConfig.host !== '127.0.0.1' || auth.emulatorConfig.port !== 9099) {
                throw new Error('Unexpected event auth emulator.');
            }
        } else {
            auth.useEmulator('http://127.0.0.1:9099', { disableWarnings: true });
        }
    }
    const database = app.database();
    if (emulators && !configuredDatabases.has(database)) {
        database.useEmulator('127.0.0.1', 9009);
        configuredDatabases.add(database);
    }
    let identity;
    return createLobbyClient(database, {
        ensureGuest() {
            if (!identity) identity = createGuestIdentity(auth || app.auth());
            return identity.ensureGuest();
        },
    });
}

let runtime;
const unavailable = {
    join() { return Promise.reject(new Error('Event connection unavailable.')); },
    subscribe() { throw new Error('Event connection unavailable.'); },
};

export function getEventLobbyClient() {
    if (runtime) return runtime;
    try {
        runtime = createEventLobbyRuntime(firebase, {
            emulators: process.env.VUE_APP_EVENT_EMULATORS === 'true',
            mode: process.env.NODE_ENV,
            hostname: typeof window === 'undefined' ? '' : window.location.hostname,
        });
        return runtime;
    } catch {
        // Keep provider/configuration details out of the public page.
        return unavailable;
    }
}
