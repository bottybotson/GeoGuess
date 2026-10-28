'use strict';

const fs = require('node:fs');
const path = require('node:path');

const BUILD_ENV_FILES = ['.env.production.local', '.env.production', '.env.local', '.env'];
const INTERPOLATED_VALUE = Symbol('interpolated build setting');

function readBuildEnvironment(cwd = process.cwd(), processEnvironment = process.env) {
    const fileEnvironment = {};
    for (const filename of BUILD_ENV_FILES) {
        const filePath = path.join(cwd, filename);
        if (!fs.existsSync(filePath)) continue;

        for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
            const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
            if (!match) continue;
            const name = match[1];
            if (name !== 'VUE_APP_EVENT_EMULATORS' && name !== 'VUE_APP_PUBLIC_PATH') continue;
            let value = match[2].trim();
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            } else {
                value = value.replace(/\s+#.*$/, '').trim();
            }
            if (fileEnvironment[name] === undefined) {
                // dotenv-expand can change the value Vue CLI compiles. Refuse interpolated
                // values here instead of trying to reproduce its expansion semantics.
                const interpolates = /(^|[^\\])\$(?:\{[^}]*\}|[A-Za-z0-9_]+)/.test(value);
                fileEnvironment[name] = interpolates ? INTERPOLATED_VALUE : value;
            }
        }
    }

    const environment = { ...fileEnvironment, ...processEnvironment };
    return environment;
}

function getHostingPreflightErrors(env = process.env, buildDirectory = path.resolve(process.cwd(), 'dist'), checkBuild = true) {
    const errors = [];

    if (env.VUE_APP_EVENT_EMULATORS === 'true') {
        errors.push('VUE_APP_EVENT_EMULATORS=true selects Firebase emulators; unset it or set it to false before a public hosting build.');
    }
    const interpolatedSetting = env.VUE_APP_EVENT_EMULATORS === INTERPOLATED_VALUE ||
        env.VUE_APP_PUBLIC_PATH === INTERPOLATED_VALUE;
    if (interpolatedSetting) {
        errors.push('Do not use dotenv variable interpolation for VUE_APP_EVENT_EMULATORS or VUE_APP_PUBLIC_PATH; set either value literally so the hosting preflight can verify it.');
    }

    const publicPath = env.VUE_APP_PUBLIC_PATH;
    if (!interpolatedSetting && publicPath && publicPath !== '/') {
        errors.push('VUE_APP_PUBLIC_PATH must be "/" for this root-hosted history-mode app.');
    }

    if (checkBuild) {
        const indexPath = path.join(buildDirectory, 'index.html');
        if (!fs.existsSync(indexPath) || !fs.statSync(indexPath).isFile()) {
            errors.push('Build output is missing dist/index.html; run the production build first.');
        }

        const hasBundle = ['js', 'assets'].some(directory => {
            const candidate = path.join(buildDirectory, directory);
            return fs.existsSync(candidate) && fs.statSync(candidate).isDirectory() &&
                fs.readdirSync(candidate).some(file => /\.(?:js|mjs)$/i.test(file));
        });
        if (!hasBundle) {
            errors.push('Build output is missing a JavaScript bundle under dist/js or dist/assets.');
        }
    }

    return errors;
}

function runHostingPreflight(env = process.env, output = console, buildDirectory = path.resolve(process.cwd(), 'dist'), checkBuild = true) {
    const errors = getHostingPreflightErrors(env, buildDirectory, checkBuild);
    if (errors.length > 0) {
        errors.forEach(error => output.error(`Hosting preflight failed: ${error}`));
        return 1;
    }

    output.log(checkBuild
        ? 'Hosting preflight passed: build output is present, public path is root, and emulator mode is not explicitly enabled.'
        : 'Hosting configuration preflight passed.');
    return 0;
}

if (require.main === module) {
    const configOnly = process.argv.includes('--config-only');
    process.exitCode = runHostingPreflight(
        readBuildEnvironment(),
        console,
        path.resolve(process.cwd(), 'dist'),
        !configOnly
    );
}

module.exports = { getHostingPreflightErrors, readBuildEnvironment, runHostingPreflight };
