'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { assertRuntime, createRuntime } = require('./runtime.cjs');
const { PROJECT, DATABASE } = require('./policy.cjs');
const email = 'event-create-runtime@customgeoguess.iam.gserviceaccount.com';
const environment = { EVENT_CREATION_ENABLED: 'true', GAE_ENV: 'standard', GCLOUD_PROJECT: PROJECT, EVENT_CREATION_SERVICE_ACCOUNT: email };
function dependencies() {
  const calls = [];
  const credential = { async isComputeEngineCredential() { calls.push('adc-compute'); return true; }, async getServiceAccountEmail() { calls.push('adc-email'); return email; } };
  const sdk = { app: { applicationDefault() { calls.push('adc'); return credential; }, initializeApp(options, name) { calls.push(['initialize', options, name]); return 'app'; } },
    auth: { getAuth(app) { assert.equal(app, 'app'); return {}; } }, database: { getDatabase(app) { assert.equal(app, 'app'); return {}; } } };
  return { calls, credential, sdk, environment: { ...environment },
    loadSdk() { calls.push('sdk'); return sdk; },
    async fetchMetadata(url, options) { calls.push(['metadata', url, options]); return new Response(email, { headers: { 'Metadata-Flavor': 'Google' } }); } };
}
test('runtime fails closed on project, platform, enabled flag, credential files, emulator and arbitrary identity before SDK or metadata calls', async () => {
  assert.doesNotThrow(() => assertRuntime(environment));
  for (const change of [{ EVENT_CREATION_ENABLED: undefined }, { GAE_ENV: 'local' }, { GCLOUD_PROJECT: 'other' }, { GOOGLE_CLOUD_PROJECT: 'other' },
    { GOOGLE_APPLICATION_CREDENTIALS: '' }, { FIREBASE_AUTH_EMULATOR_HOST: '' }, { FIREBASE_DATABASE_EMULATOR_HOST: '' },
    { FIRESTORE_EMULATOR_HOST: '' }, { FIREBASE_STORAGE_EMULATOR_HOST: '' }, { GCE_METADATA_HOST: 'remote.invalid' },
    { GCE_METADATA_IP: '127.0.0.1' }, { GCE_METADATA_ROOT: '' },
    { EVENT_CREATION_SERVICE_ACCOUNT: 'user@example.test' }, { EVENT_CREATION_SERVICE_ACCOUNT: 'event-create-runtime@other.iam.gserviceaccount.com' }]) {
    const f = dependencies(); f.environment = { ...environment, ...change };
    await assert.rejects(createRuntime(f).getService(), { code: 'service-unavailable' }); assert.deepEqual(f.calls, []);
  }
});
test('managed metadata and real ADC identities must both match before pinned Admin app creation', async () => {
  for (const response of [new Response(email), new Response('other@customgeoguess.iam.gserviceaccount.com', { headers: { 'Metadata-Flavor': 'Google' } }), new Response(email, { status: 403, headers: { 'Metadata-Flavor': 'Google' } })]) {
    const f = dependencies(); f.fetchMetadata = async () => response;
    await assert.rejects(createRuntime(f).getService(), { code: 'service-unavailable' }); assert.equal(f.calls.includes('sdk'), false);
  }
  for (const change of [c => c.isComputeEngineCredential = async () => false, c => delete c.isComputeEngineCredential,
    c => c.getServiceAccountEmail = async () => 'other@example.test', c => delete c.getServiceAccountEmail]) {
    const f = dependencies(); change(f.credential);
    await assert.rejects(createRuntime(f).getService(), { code: 'service-unavailable' });
    assert.equal(f.calls.some(value => Array.isArray(value) && value[0] === 'initialize'), false);
  }
  const f = dependencies(), runtime = createRuntime(f);
  const [first, second] = await Promise.all([runtime.getService(), runtime.getService()]); assert.equal(first, second);
  const metadata = f.calls.find(value => Array.isArray(value) && value[0] === 'metadata');
  assert.equal(metadata[1], 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email');
  assert.equal(metadata[2].redirect, 'error'); assert.deepEqual(metadata[2].headers, { 'Metadata-Flavor': 'Google' });
  const init = f.calls.find(value => Array.isArray(value) && value[0] === 'initialize');
  assert.equal(init[1].projectId, PROJECT); assert.equal(init[1].databaseURL, DATABASE); assert.equal(init[1].credential, f.credential);
  assert.equal(f.calls.filter(value => value === 'sdk').length, 1);
});
test('failed metadata initialization may be retried, with fixed errors', async () => {
  const f = dependencies(), metadata = f.fetchMetadata; let attempts = 0;
  f.fetchMetadata = (...args) => ++attempts === 1 ? Promise.reject(new Error('sensitive provider data')) : metadata(...args);
  const runtime = createRuntime(f); await assert.rejects(runtime.getService(), { code: 'service-unavailable', message: 'service-unavailable' });
  assert.equal(typeof (await runtime.getService()).create, 'function');
});
