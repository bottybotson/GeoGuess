'use strict';
const { fail } = require('./policy.cjs');
// Firebase once() may expose an optimistic transaction from another request.
// The acknowledgement barrier is shared by every adapter for this database and
// survives request timeouts. A server-confirmed transaction is the only proof.
const pending = new WeakMap();
const overlaps = (a, b) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
function createAdminStore(database) {
  if (!pending.has(database)) pending.set(database, new Map());
  const writes = pending.get(database);
  const settled = async path => {
    for (;;) {
      const tasks = Array.from(writes, ([task, location]) => overlaps(path, location) ? task : null).filter(Boolean);
      if (!tasks.length) return;
      await Promise.allSettled(tasks);
    }
  };
  const read = async path => {
    for (;;) {
      await settled(path);
      const snapshot = await database.ref(path).once('value');
      if (Array.from(writes.values()).some(location => overlaps(path, location))) continue;
      return snapshot.val();
    }
  };
  const transaction = async (path, value, context) => {
    await settled(path);
    context.active();
    const detached = structuredClone(value);
    // Register before invoking the SDK, so parallel requests cannot observe its
    // optimistic callback value between invocation and barrier registration.
    const operation = Promise.resolve().then(() => {
      context.active();
      return database.ref(path).transaction(current => current === null ? detached : undefined, undefined, false);
    });
    writes.set(operation, path);
    const release = () => writes.delete(operation);
    operation.then(release, release);
    try { return await operation; }
    catch { throw fail('creation-unconfirmed'); }
  };
  return {
    readHost: id => read(`events/${id}/hostUid`),
    readSource: id => read(`events/${id}`),
    readEvent: id => read(`events/${id}`),
    async reserve(uid, requestId, value, context) {
      const path = `eventCreationRequests/${uid}/${requestId}`;
      await transaction(path, value, context);
      // An aborted transaction's result may reflect another request's local
      // pending value. Await all overlapping acknowledgements before reuse.
      return read(path);
    },
    async create(id, value, context) {
      return (await transaction(`events/${id}`, value, context)).committed === true;
    },
  };
}
module.exports = { createAdminStore };
