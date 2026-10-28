import firebase from 'firebase/app';
import 'firebase/auth';
import 'firebase/database';
import { createGuestIdentity } from './identity';
import { createLobbyClient } from './lobby';
import { createRoundClient } from './round';
import { createHostClient } from './host';

const DEMO_PROJECT = 'demo-geoguess-admission';
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const configuredDatabases = new WeakSet();

/** Separate event guests from legacy play and the future named host app. */
function eventConnection(sdk, { emulators = false, mode, hostname } = {}, role = 'guest') {
    if (emulators && (mode !== 'development' || !LOOPBACK.has(hostname))) {
        throw new Error('Event emulator mode requires local development.');
    }
    const name = emulators ? `geoguess-event-demo-${role}` : `geoguess-event-${role}`;
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
    return { app, database, auth };
}

function guestServices(sdk, options) {
    const { app, database, auth } = eventConnection(sdk, options);
    let identity;
    const guest = {
        ensureGuest() {
            if (!identity) identity = createGuestIdentity(auth || app.auth());
            return identity.ensureGuest();
        },
    };
    return {
        lobby: createLobbyClient(database, guest),
        round: createRoundClient(database, { ensureUser: guest.ensureGuest }),
    };
}

export function createEventLobbyRuntime(sdk, options) {
    return guestServices(sdk, options).lobby;
}

let runtime;
let host;
const unavailable = {
    join() { return Promise.reject(new Error('Event connection unavailable.')); },
    subscribe() { throw new Error('Event connection unavailable.'); },
};

const settings = () => ({
    emulators: process.env.VUE_APP_EVENT_EMULATORS === 'true',
    mode: process.env.NODE_ENV,
    hostname: typeof window === 'undefined' ? '' : window.location.hostname,
});

function getGuestServices() {
    if (runtime) return runtime;
    try {
        runtime = guestServices(firebase, settings());
        return runtime;
    } catch {
        // Keep provider/configuration details out of the public page.
        return { lobby: unavailable, round: null };
    }
}

export const getEventLobbyClient = () => getGuestServices().lobby;
export const getEventRoundClient = () => getGuestServices().round;

export function getEventHostClient() {
    if (host) return host;
    try {
        const connection = eventConnection(firebase, settings(), 'host');
        host = createHostClient(connection.database, connection.auth || connection.app.auth());
        return host;
    } catch {
        return null;
    }
}
