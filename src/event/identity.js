/**
 * Create a guest identity adapter for an injected Firebase 8 auth instance.
 *
 * Firebase LOCAL persistence keeps this identity in the current browser's
 * local data. Clearing browser data or using a different browser loses that
 * continuity. This adapter only identifies an auth user; it grants no host
 * authorization.
 *
 * @param {Object} auth Firebase 8-compatible auth instance.
 * @returns {{ ensureGuest: () => Promise<Object> }}
 */
export function createGuestIdentity(auth) {
    let inFlight = null;

    const waitForRestoredUser = () =>
        new Promise((resolve, reject) => {
            let unsubscribe = null;
            let settled = false;
            let shouldUnsubscribe = false;

            const dispose = () => {
                shouldUnsubscribe = true;
                if (typeof unsubscribe === 'function') {
                    const stop = unsubscribe;
                    unsubscribe = null;
                    try {
                        stop();
                    } catch (error) {
                        // Cleanup must not replace the restoration outcome.
                    }
                }
            };

            const finish = (callback, value) => {
                if (settled) return;
                settled = true;
                dispose();
                callback(value);
            };

            try {
                const stop = auth.onAuthStateChanged(
                    user => finish(resolve, user),
                    error => finish(reject, error),
                );

                unsubscribe = stop;
                if (shouldUnsubscribe && typeof unsubscribe === 'function') {
                    dispose();
                }
            } catch (error) {
                finish(reject, error);
            }
        });

    const startAttempt = () =>
        waitForRestoredUser().then(user => {
            if (user) return user;

            return auth.setPersistence('local').then(() => {
                // A separate tab or organizer sign-in may complete while
                // persistence is being selected. Preserve that identity.
                if (auth.currentUser) return auth.currentUser;

                return auth.signInAnonymously().then(result => {
                    if (!result || !result.user) {
                        throw new Error('Anonymous sign-in did not return a user.');
                    }
                    return result.user;
                });
            });
        });

    return {
        ensureGuest() {
            if (inFlight) return inFlight;

            const attempt = startAttempt();
            inFlight = attempt;
            attempt.then(
                () => {
                    if (inFlight === attempt) inFlight = null;
                },
                () => {
                    if (inFlight === attempt) inFlight = null;
                },
            );
            return attempt;
        },
    };
}
