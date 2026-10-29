'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { fail } = require('./core.cjs');

// Deliberately limited to the supplied rehearsal project, not a general Admin tool.
const LIVE_PROJECT = 'customgeoguess';
const LIVE_DATABASE = 'https://customgeoguess-default-rtdb.europe-west1.firebasedatabase.app';
const CHECKOUT = path.resolve(__dirname, '../..');
const emulatorKeys = ['FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_DATABASE_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST'];

function assertLiveTarget(target, confirmations, environment = process.env) {
    if (!target || target.projectId !== LIVE_PROJECT || target.databaseUrl !== LIVE_DATABASE ||
        typeof target.eventId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(target.eventId) ||
        !confirmations || confirmations.projectId !== target.projectId || confirmations.databaseUrl !== target.databaseUrl ||
        emulatorKeys.some(key => Object.hasOwn(environment, key)) ||
        ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT'].some(key => environment[key] && environment[key] !== target.projectId)) {
        throw fail('live-target-required');
    }
}

function readServiceAccount(environment, target) {
    try {
        const supplied = environment.GOOGLE_APPLICATION_CREDENTIALS;
        if (typeof supplied !== 'string' || !supplied) throw new Error();
        const filename = fs.realpathSync(supplied);
        const relative = path.relative(CHECKOUT, filename);
        if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) throw new Error();
        const stat = fs.statSync(filename);
        if (!stat.isFile() || stat.size > 65536 || (stat.mode & 0o077) !== 0) throw new Error();
        const account = JSON.parse(fs.readFileSync(filename, 'utf8'));
        if (!account || account.type !== 'service_account' || account.project_id !== target.projectId ||
            typeof account.client_email !== 'string' ||
            !account.client_email.endsWith(`@${target.projectId}.iam.gserviceaccount.com`) ||
            typeof account.private_key !== 'string' || !account.private_key.startsWith('-----BEGIN PRIVATE KEY-----')) throw new Error();
        // Do not forward arbitrary JSON token endpoints to an authentication client.
        return { projectId: account.project_id, clientEmail: account.client_email, privateKey: account.private_key };
    } catch { throw fail('credential-required'); }
}

function adminAdapter(target, services, kind, operationTimeoutMs = 30000) {
    const selected = Object.freeze({ ...target });
    const bounded = async (operation, code, onTimeout) => {
        let timer;
        const timeout = new Promise((resolve, reject) => {
            timer = setTimeout(() => {
                if (onTimeout) { try { onTimeout(); } catch { /* Still report uncertain outcome if transport cleanup fails. */ } }
                reject(fail(code));
            }, operationTimeoutMs);
        });
        try { return await Promise.race([operation, timeout]); }
        finally { clearTimeout(timer); }
    };
    return {
        target: selected,
        kind,
        getUser: uid => bounded(Promise.resolve().then(() => services.auth.getUser(uid)), 'host-lookup-failed'),
        async createIfAbsent(eventId, event) {
            if (eventId !== selected.eventId) throw fail('target-mismatch');
            const value = JSON.parse(JSON.stringify(event));
            // The callback may be rerun by the SDK. It never merges/replaces existing data.
            const operation = services.database.ref(`events/${eventId}`).transaction(current => current === null ? value : undefined, undefined, false);
            const result = await bounded(operation, 'create-unconfirmed', () => services.database.goOffline());
            return result.committed === true;
        },
    };
}

function loadAdmin() {
    return {
        app: require('firebase-admin/app'),
        auth: require('firebase-admin/auth'),
        database: require('firebase-admin/database'),
    };
}

function createLiveAdapter(target, confirmations, { environment = process.env, loadSdk = loadAdmin } = {}) {
    // All target, emulator and credential checks precede SDK import/initialization.
    assertLiveTarget(target, confirmations, environment);
    const account = readServiceAccount(environment, target);
    let sdk, app, database;
    try {
        sdk = loadSdk();
        const credential = sdk.app.cert(account);
        app = sdk.app.initializeApp({ projectId: target.projectId, databaseURL: target.databaseUrl, credential }, `event-setup-${randomBytes(8).toString('hex')}`);
        database = sdk.database.getDatabase(app);
        const auth = sdk.auth.getAuth(app);
        return {
            adapter: adminAdapter(target, { auth, database }, 'live'),
            async close() {
                database.goOffline();
                await sdk.app.deleteApp(app);
            },
        };
    } catch {
        if (database) database.goOffline();
        if (sdk && app) sdk.app.deleteApp(app).catch(() => {});
        throw fail('admin-unavailable');
    }
}

module.exports = { LIVE_PROJECT, LIVE_DATABASE, assertLiveTarget, readServiceAccount, adminAdapter, createLiveAdapter };
