'use strict';
const { PROJECT, DATABASE, fail } = require('./policy.cjs');
const { createAdminStore } = require('./store.cjs');
const { createCreationService } = require('./creation.cjs');
const emulatorKeys = ['FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_DATABASE_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST'];
const metadataOverrides = ['GCE_METADATA_HOST', 'GCE_METADATA_IP', 'GCE_METADATA_ROOT'];
function assertRuntime(environment) {
  if (environment.EVENT_CREATION_ENABLED !== 'true' || environment.GAE_ENV !== 'standard' ||
      environment.GCLOUD_PROJECT !== PROJECT ||
      (environment.GOOGLE_CLOUD_PROJECT && environment.GOOGLE_CLOUD_PROJECT !== PROJECT) ||
      Object.hasOwn(environment, 'GOOGLE_APPLICATION_CREDENTIALS') ||
      emulatorKeys.some(key => Object.hasOwn(environment, key)) ||
      metadataOverrides.some(key => Object.hasOwn(environment, key)) ||
      typeof environment.EVENT_CREATION_SERVICE_ACCOUNT !== 'string' ||
      !/^[a-z][a-z0-9-]{4,28}[a-z0-9]@customgeoguess\.iam\.gserviceaccount\.com$/.test(environment.EVENT_CREATION_SERVICE_ACCOUNT)) throw fail('service-unavailable');
}
const loadAdmin = () => ({ app: require('firebase-admin/app'), auth: require('firebase-admin/auth'), database: require('firebase-admin/database') });
function createRuntime({ environment = process.env, loadSdk = loadAdmin, fetchMetadata = globalThis.fetch } = {}) {
  let loading;
  const initialize = async () => {
    assertRuntime(environment);
    // A configured email alone is not proof of the deployed identity. Verify
    // the platform's fixed metadata endpoint before loading ADC or the SDK.
    const response = await fetchMetadata('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email', {
      headers: { 'Metadata-Flavor': 'Google' }, redirect: 'error', signal: AbortSignal.timeout(2000),
    });
    if (!response.ok || response.headers.get('metadata-flavor') !== 'Google' ||
        (await response.text()).trim() !== environment.EVENT_CREATION_SERVICE_ACCOUNT) throw fail('service-unavailable');
    const sdk = loadSdk();
    const credential = sdk.app.applicationDefault();
    // Pinned Admin 13.6 exposes these checks on its ADC credential. Metadata
    // identity alone would not exclude a well-known user/key ADC file taking
    // precedence. Fail closed if a dependency update removes either check.
    if (typeof credential.isComputeEngineCredential !== 'function' || await credential.isComputeEngineCredential() !== true ||
        typeof credential.getServiceAccountEmail !== 'function' || await credential.getServiceAccountEmail() !== environment.EVENT_CREATION_SERVICE_ACCOUNT) throw fail('service-unavailable');
    const app = sdk.app.initializeApp({ projectId: PROJECT, databaseURL: DATABASE, credential }, 'event-creation-runtime');
    return createCreationService({ auth: sdk.auth.getAuth(app), store: createAdminStore(sdk.database.getDatabase(app)),
      target: { projectId: PROJECT, databaseUrl: DATABASE } });
  };
  return {
    async getService() {
      if (!loading) {
        loading = initialize().catch(() => { loading = undefined; throw fail('service-unavailable'); });
      }
      return loading;
    },
  };
}
module.exports = { createRuntime, assertRuntime };
