import { createLobbyClient } from './lobby';
import { createRoundClient } from './round';

// Only the separately named organizer Auth instance is injected here.
export function createHostClient(database, auth) {
    let restoring;
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
    const round = createRoundClient(database, { ensureUser });
    const lobby = createLobbyClient(database, { ensureGuest: ensureUser });
    return {
        restore,
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
        subscribe: lobby.subscribe,
        getHostSetup: round.getHostSetup,
        start: round.start,
        close: round.close,
        reveal: round.reveal,
        getReveal: round.getReveal,
    };
}
