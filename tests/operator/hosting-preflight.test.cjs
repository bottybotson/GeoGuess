'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { getHostingPreflightErrors, readBuildEnvironment, runHostingPreflight } = require('../../scripts/hosting-preflight.cjs');

function makeBuild(t, { index = true, bundle = true } = {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'geoguess-hosting-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    if (index) fs.writeFileSync(path.join(directory, 'index.html'), '<div id="app"></div>');
    if (bundle) {
        fs.mkdirSync(path.join(directory, 'js'));
        fs.writeFileSync(path.join(directory, 'js', 'app.js'), '/* built app */');
    }
    return directory;
}

test('accepts default root hosting configuration with a built app', t => {
    const build = makeBuild(t);
    assert.deepEqual(getHostingPreflightErrors({}, build), []);
    assert.deepEqual(getHostingPreflightErrors({ VUE_APP_PUBLIC_PATH: '/' }, build), []);
});

test('rejects an explicitly selected Firebase emulator build', t => {
    const errors = getHostingPreflightErrors({ VUE_APP_EVENT_EMULATORS: 'true' }, makeBuild(t));
    assert.equal(errors.length, 1);
    assert.match(errors[0], /emulators/);
});

test('allows emulator flag values other than explicit true', t => {
    const build = makeBuild(t);
    assert.deepEqual(getHostingPreflightErrors({ VUE_APP_EVENT_EMULATORS: 'false' }, build), []);
    assert.deepEqual(getHostingPreflightErrors({ VUE_APP_EVENT_EMULATORS: '' }, build), []);
});

test('reads Vue CLI production env files while giving the shell the final say', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'geoguess-env-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    fs.writeFileSync(path.join(directory, '.env.production'), 'VUE_APP_EVENT_EMULATORS=true\nVUE_APP_PUBLIC_PATH="/preview/"\n');
    fs.writeFileSync(path.join(directory, '.env.production.local'), 'VUE_APP_EVENT_EMULATORS=false\n');

    assert.deepEqual(readBuildEnvironment(directory, {}), {
        VUE_APP_EVENT_EMULATORS: 'false',
        VUE_APP_PUBLIC_PATH: '/preview/'
    });
    assert.deepEqual(readBuildEnvironment(directory, { VUE_APP_EVENT_EMULATORS: 'true' }), {
        VUE_APP_EVENT_EMULATORS: 'true',
        VUE_APP_PUBLIC_PATH: '/preview/'
    });
});

test('fails closed when checked dotenv build settings use variable interpolation', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'geoguess-interpolated-env-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    fs.writeFileSync(path.join(directory, '.env.production'), [
        'EMULATOR_FLAG=true',
        'VUE_APP_EVENT_EMULATORS=${EMULATOR_FLAG}',
        'VUE_APP_PUBLIC_PATH=$DEPLOY_PATH'
    ].join('\n'));

    const errors = getHostingPreflightErrors(readBuildEnvironment(directory, {}), '/unused-build', false);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /Do not use dotenv variable interpolation/);
    assert.doesNotMatch(errors[0], /EMULATOR_FLAG|DEPLOY_PATH/);
});

test('configuration-only mode can run before the production build', () => {
    assert.deepEqual(getHostingPreflightErrors({}, '/missing-build', false), []);
});

test('rejects public paths incompatible with root hosting without echoing their value', t => {
    const build = makeBuild(t);
    for (const publicPath of ['/preview/', 'https://cdn.example/app/', './']) {
        const errors = getHostingPreflightErrors({ VUE_APP_PUBLIC_PATH: publicPath }, build);
        assert.equal(errors.length, 1);
        assert.match(errors[0], /VUE_APP_PUBLIC_PATH/);
        assert.doesNotMatch(errors[0], new RegExp(publicPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
});

test('rejects missing HTML or JavaScript bundle output', t => {
    assert.ok(getHostingPreflightErrors({}, makeBuild(t, { index: false })).some(error => /index.html/.test(error)));
    assert.ok(getHostingPreflightErrors({}, makeBuild(t, { bundle: false })).some(error => /JavaScript bundle/.test(error)));
});

test('reports invalid deployment settings and returns a failing status', t => {
    const messages = [];
    const output = { log: message => messages.push(message), error: message => messages.push(message) };
    const build = makeBuild(t);
    const status = runHostingPreflight({
        VUE_APP_EVENT_EMULATORS: 'true',
        VUE_APP_PUBLIC_PATH: '/subpath/'
    }, output, build);

    assert.equal(status, 1);
    assert.equal(messages.length, 2);
    assert.ok(messages.every(message => message.startsWith('Hosting preflight failed:')));
});
