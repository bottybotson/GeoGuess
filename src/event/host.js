import { createVersionedLobbyClient, createVersionedSessionClient } from './facade';
import { legacyClient } from './version';
import { createRoundClient } from './round';

// Only the separately named organizer Auth instance is injected here.
export function createHostClient(database, auth) {
    let restoring;
    const subscribeAuth = (onChange, onError = () => {}) => {
        if (typeof onChange !== 'function' || typeof onError !== 'function') throw new TypeError('Auth callbacks required.');
        let live = true;
        let release;
        let released = false;
        const safe = (callback, value) => {
            try { callback(value); } catch { /* Consumer exceptions must not interrupt provider registration or cleanup. */ }
        };
        const stop = () => {
            live = false;
            if (!released && typeof release === 'function') {
                released = true;
                try { release(); } catch { /* Keep stale callbacks invalidated even if provider cleanup fails. */ }
            }
        };
        const fail = error => {
            if (!live) return;
            stop();
            safe(onError, error);
        };
        try {
            release = auth.onAuthStateChanged(user => { if (live) safe(onChange, user); }, fail);
        } catch (error) { fail(error); }
        // Auth providers may complete registration after synchronous failure.
        if (!live) stop();
        return stop;
    };
    const restore = () => {
        if (restoring) return restoring;
        const attempt = new Promise((resolve, reject) => {
            let stop;
            let settled = false;
            const finish = (callback, value) => {
                if (settled) return;
                settled = true;
                if (stop) { try { stop(); } catch { /* preserve the auth outcome */ } }
                callback(value);
            };
            try {
                stop = auth.onAuthStateChanged(user => finish(resolve, user), error => finish(reject, error));
                if (settled && stop) { try { stop(); } catch { /* preserve the auth outcome */ } }
            } catch (error) { finish(reject, error); }
        });
        restoring = attempt;
        attempt.then(() => { restoring = null; }, () => { restoring = null; });
        return attempt;
    };
    const ensureUser = async () => {
        const user = await restore();
        if (!user) throw Object.assign(new Error('Organizer sign-in required.'), { code: 'unauthenticated' });
        return user;
    };
    const round = legacyClient(database, createRoundClient(database, { ensureUser }));
    const session = createVersionedSessionClient(database, { ensureUser });
    const lobby = createVersionedLobbyClient(database, { ensureGuest: ensureUser });
    return {
        restore,
        subscribeAuth,
        session,
        async signIn(email, password) {
            if (typeof email !== 'string' || !email.trim() || typeof password !== 'string' || !password) {
                throw new Error('Sign-in details required.');
            }
            await auth.setPersistence('local');
            const result = await auth.signInWithEmailAndPassword(email.trim(), password);
            if (!result || !result.user) throw new Error('Sign-in did not return a user.');
            return result.user;
        },
        signOut: () => auth.signOut(),
        getFormatVersion: lobby.getFormatVersion,
        subscribe: lobby.subscribe,
        getHostSetup: round.getHostSetup,
        start: round.start,
        close: round.close,
        reveal: round.reveal,
        getReveal: round.getReveal,
        subscribeTiming: round.subscribeTiming,
        setDeadline: round.setDeadline,
        getTiming: round.getTiming,
        getServerTime: round.getServerTime,
    };
}
