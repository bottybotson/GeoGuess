'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
// This runner stages the canonical combined Rules into a private temp project;
// Firebase CLI refuses rules paths outside its configuration directory.
if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('isolated-node-24-required');
for (const key of ['GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CLOUD_PROJECT', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_DATABASE_EMULATOR_HOST']) {
  if (Object.hasOwn(process.env, key)) throw new Error('clean-emulator-environment-required');
}
if (process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== 'demo-geoguess-admission') throw new Error('demo-project-required');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'geoguess-creation-emulator-'));
try {
  fs.copyFileSync(path.join(__dirname, 'firebase.emulator.json'), path.join(temp, 'firebase.json'));
  fs.copyFileSync(path.resolve(__dirname, '../../tests/integration/event-runtime/rules.json'), path.join(temp, 'rules.json'));
  // Fixed installed CLI, fixed demo project, fixed loopback config; no login or
  // service-account file is accepted by this fixture process.
  const command = `${process.execPath} --test ${path.join(__dirname, 'creation.emulator.cjs')}`;
  const result = spawnSync(process.execPath, ['/workspace/.geoguess-emulator-tools/node_modules/firebase-tools/lib/bin/firebase.js',
    'emulators:exec', '--only', 'auth,database', '--project', 'demo-geoguess-admission', '--config', path.join(temp, 'firebase.json'), command],
  { cwd: temp, stdio: 'inherit', env: process.env, timeout: 150000, killSignal: 'SIGTERM' });
  process.exitCode = result.status === 0 && !result.error && !result.signal ? 0 : 1;
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
