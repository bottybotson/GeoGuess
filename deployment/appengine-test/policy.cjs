'use strict';
const PROJECT = 'customgeoguess';
const DATABASE = 'https://customgeoguess-default-rtdb.europe-west1.firebasedatabase.app';
const ORIGIN = 'https://customgeoguess.ew.r.appspot.com';
const status = Object.freeze({
  'invalid-request': 400, 'method-not-allowed': 405, 'payload-too-large': 413,
  'unsupported-media-type': 415, unauthenticated: 401, 'password-host-required': 403,
  'origin-forbidden': 403, 'source-unavailable': 404, 'invalid-source': 409,
  'unsupported-source': 409, 'stale-source': 409, 'request-conflict': 409,
  'destination-conflict': 409, 'service-unavailable': 503, 'creation-unconfirmed': 503,
  'not-found': 404,
});
const fail = code => Object.assign(new Error(code), { code });
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, names) => record(value) && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const uidValid = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const eventIdValid = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
function requestValid(value) {
  return exact(value, ['sourceEventId', 'requestId']) && eventIdValid(value.sourceEventId) &&
    typeof value.requestId === 'string' && /^[a-f0-9]{32}$/.test(value.requestId);
}
function withinBudget(operation, milliseconds = 30000) {
  if (!Number.isInteger(milliseconds) || milliseconds < 1 || milliseconds > 30000) throw fail('service-unavailable');
  const controller = new AbortController();
  let expired = false, wrote = false, timer;
  const deadline = Date.now() + milliseconds;
  const context = {
    signal: controller.signal,
    active() { if (expired || Date.now() >= deadline) throw fail(wrote ? 'creation-unconfirmed' : 'service-unavailable'); },
    writing() { this.active(); wrote = true; },
  };
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      expired = true;
      controller.abort();
      reject(fail(wrote ? 'creation-unconfirmed' : 'service-unavailable'));
    }, milliseconds);
  });
  // Race retains rejection handlers on the late task: no unhandled rejection
  // and no further write may begin after the request's deadline.
  return Promise.race([Promise.resolve().then(() => operation(context)), timeout]).finally(() => clearTimeout(timer));
}
module.exports = { PROJECT, DATABASE, ORIGIN, status, fail, record, exact, uidValid, eventIdValid, requestValid, withinBudget };
