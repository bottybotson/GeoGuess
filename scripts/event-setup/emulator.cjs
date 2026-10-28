'use strict';
const { fail } = require('./core.cjs');
const PROJECT = 'demo-geoguess-admission';
const DATABASE = `https://${PROJECT}.firebaseio.com`;
function emulatorAdapter(target, environment = process.env, fetchRequest = globalThis.fetch) {
    // These checks run before any request or provider/SDK initialization. There is no live adapter.
    if (!target || target.projectId !== PROJECT || target.databaseUrl !== DATABASE ||
        typeof target.eventId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(target.eventId) ||
        environment.GCLOUD_PROJECT !== PROJECT || environment.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099' ||
        environment.FIREBASE_DATABASE_EMULATOR_HOST !== '127.0.0.1:9009') throw fail('emulator-target-required');
    const selected = Object.freeze({ ...target });
    const request = async (url, options = {}) => {
        try { return await fetchRequest(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(10000) }); }
        catch { throw fail('emulator-request-failed'); }
    };
    return {
        target: selected,
        async getUser(uid) {
            if (typeof uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw fail('invalid-host');
            const response = await request(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:lookup`, {
                method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ localId: [uid] }),
            });
            if (!response.ok) throw fail('host-lookup-failed');
            const body = await response.json();
            const user = Array.isArray(body.users) && body.users.find(item => item.localId === uid);
            if (!user) throw fail('invalid-host');
            return { uid: user.localId, disabled: user.disabled === true, providerData: user.providerUserInfo || [] };
        },
        async createIfAbsent(eventId, event) {
            if (eventId !== selected.eventId) throw fail('target-mismatch');
            const url = `http://127.0.0.1:9009/events/${eventId}.json?ns=${PROJECT}`;
            const headers = { Authorization: 'Bearer owner' };
            const current = await request(url, { headers: { ...headers, 'X-Firebase-ETag': 'true' } });
            if (!current.ok) throw fail('create-failed');
            const etag = current.headers.get('etag');
            if (!etag) throw fail('create-failed');
            if (await current.json() !== null) return false;
            // Firebase's conditional PUT is an atomic compare-and-set transaction:
            // if another writer wins after the read, the server returns 412.
            const response = await request(url, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json', 'if-match': etag }, body: JSON.stringify(event) });
            if (response.status === 412) return false;
            if (!response.ok) throw fail('create-failed');
            return true;
        },
    };
}
module.exports = { emulatorAdapter, PROJECT, DATABASE };
