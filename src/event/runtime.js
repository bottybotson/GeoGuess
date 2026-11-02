import firebase from 'firebase/app';
import 'firebase/auth';
import 'firebase/database';
import { createGuestIdentity } from './identity';
import { createVersionedLobbyClient, createVersionedSessionClient, createPresenterClient } from './facade';
import { legacyClient } from './version';
import { createRoundClient } from './round';
import { createHostClient } from './host';

const DEMO_PROJECT = 'demo-geoguess-admission';
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const configuredDatabases = new WeakSet();

function eventAuth(app, emulators) {
    const auth = app.auth();
    if (emulators) {
        if (auth.emulatorConfig) {
            if (auth.emulatorConfig.host !== '127.0.0.1' || auth.emulatorConfig.port !== 9099) {
                throw new Error('Unexpected event auth emulator.');
            }
        } else auth.useEmulator('http://127.0.0.1:9099', { disableWarnings: true });
    }
    return auth;
}

/** Keep event guest, organizer and public presentation connections separate. */
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

    const auth = emulators && role === 'host' ? eventAuth(app, true) : undefined;
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
        async ensureGuest() {
            if (!identity) identity = createGuestIdentity(auth || eventAuth(app, options && options.emulators));
            return identity.ensureGuest();
        },
    };
    const session = createVersionedSessionClient(database, { ensureUser: guest.ensureGuest });
    return {
        lobby: createVersionedLobbyClient(database, guest),
        round: legacyClient(database, createRoundClient(database, { ensureUser: guest.ensureGuest })),
        session: Object.fromEntries(['getState', 'subscribeState', 'getClue', 'getReveal', 'getTiming', 'subscribeTiming', 'getServerTime', 'getOwnGuess', 'submitGuess']
            .map(name => [name, session[name]])),
    };
}

export function createEventLobbyRuntime(sdk, options) {
    return guestServices(sdk, options).lobby;
}

export function createEventSessionRuntime(sdk, options) {
    return guestServices(sdk, options).session;
}

export function createEventPresenterRuntime(sdk, options) {
    return createPresenterClient(eventConnection(sdk, options, 'presenter').database);
}

let runtime;
let host;
let presenter;
const unavailable = {
    getFormatVersion() { return Promise.reject(new Error('Event connection unavailable.')); },
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
        return { lobby: unavailable, round: null, session: null };
    }
}

export const getEventLobbyClient = () => getGuestServices().lobby;
export const getEventRoundClient = () => getGuestServices().round;
export const getEventSessionClient = () => getGuestServices().session;
export function getEventPresenterClient() {
    if (presenter) return presenter;
    try { presenter = createEventPresenterRuntime(firebase, settings()); return presenter; }
    catch { return null; }
}

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
