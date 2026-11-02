import { createLobbyClient } from './lobby';
import { createSessionClient } from './session';
import { createRoundClient } from './round';
import { getFormatVersion, legacyClient, subscribeVersioned, validSessionState } from './version';

const failure = code => Object.assign(new Error(code), { code });

/** Public inspection never invokes identity; only a deliberate join does. */
export function createVersionedLobbyClient(database, identity) {
    const clients = { 1: createLobbyClient(database, identity), 2: createLobbyClient(database, identity, 2) };
    return {
        getFormatVersion: eventId => getFormatVersion(database, eventId),
        async join(eventId, nickname) {
            const version = await getFormatVersion(database, eventId);
            return clients[version].join(eventId, nickname);
        },
        subscribe: (eventId, onChange, onError) => subscribeVersioned(database, eventId,
            (version, valid, fail) => clients[version].subscribe(eventId, value => { if (valid()) onChange(value); }, fail), onError),
    };
}

/** Explicit v2 protocol. Host commands receive the caller's displayed expected state verbatim. */
export function createVersionedSessionClient(database, identity) {
    const session = createSessionClient(database, identity);
    return {
        ...session,
        subscribeTiming(eventId, roundId, onChange, onError) {
            if (typeof roundId !== 'string' || !/^r(0[1-9]|1[0-9]|20)$/.test(roundId)) throw failure('invalid-round-id');
            return subscribeVersioned(database, eventId, (version, valid, fail) => {
                if (version !== 2) throw failure('unsupported-format');
                return session.subscribeTiming(eventId, roundId, value => { if (valid()) onChange(value); }, fail);
            }, onError);
        },
        subscribeState(eventId, onChange, onError) {
            return subscribeVersioned(database, eventId, (version, valid, fail) => {
                if (version !== 2) throw failure('unsupported-format');
                const values = {};
                const ready = new Set();
                const listeners = [];
                let live = true;
                const stop = () => {
                    if (!live) return;
                    live = false;
                    listeners.forEach(({ ref, handler }) => ref.off('value', handler));
                };
                const cancelled = error => { if (live && valid()) { stop(); fail(error); } };
                for (const leaf of ['state', 'roundCount']) {
                    if (!live || !valid()) break;
                    let listener;
                    try {
                        const ref = database.ref(`events/${eventId}/public/${leaf}`);
                        const handler = snapshot => {
                            if (!live || !valid()) return;
                            values[leaf] = snapshot.val();
                            ready.add(leaf);
                            if (ready.size !== 2) return;
                            if (!validSessionState(values.state, values.roundCount)) { cancelled(failure('unavailable')); return; }
                            onChange({ ...values.state, roundCount: values.roundCount });
                        };
                        listener = { ref, handler };
                        listeners.push(listener);
                        ref.on('value', handler, cancelled);
                    } catch (error) { cancelled(error); }
                    finally {
                        // Providers may finish installation after synchronous cancellation.
                        if ((!live || !valid()) && listener) listener.ref.off('value', listener.handler);
                    }
                }
                return stop;
            }, onError);
        },
    };
}

/** Spectators receive only public operations and no identity object. */
export function createPresenterClient(database) {
    const session = createVersionedSessionClient(database);
    const lobby = createVersionedLobbyClient(database);
    const round = legacyClient(database, createRoundClient(database));
    return {
        lobby: { subscribe: lobby.subscribe, getFormatVersion: lobby.getFormatVersion },
        session: Object.fromEntries(['getState', 'subscribeState', 'getClue', 'getReveal', 'getTiming', 'subscribeTiming', 'getServerTime']
            .map(name => [name, session[name]])),
        round: Object.fromEntries(['getReveal', 'getTiming', 'getServerTime', 'subscribeTiming'].map(name => [name, round[name]])),
    };
}
