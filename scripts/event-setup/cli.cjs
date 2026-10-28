#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const { provision } = require('./core.cjs');
const allowedErrors = new Set(['invalid-target', 'invalid-input', 'target-mismatch', 'invalid-event', 'invalid-round', 'emulator-target-required', 'host-lookup-failed', 'invalid-host', 'event-exists', 'create-failed']);
async function main(args) {
    const values = {};
    for (let index = 0; index < args.length; index++) {
        const key = args[index];
        if (key === '--apply-emulator' && !values[key]) values[key] = true;
        else if (['--input', '--project', '--database-url', '--event-id'].includes(key) && !Object.hasOwn(values, key) && args[index + 1] && !args[index + 1].startsWith('--')) values[key] = args[++index];
        else throw new Error('invalid-arguments');
    }
    if (!values['--input'] || !values['--project'] || !values['--database-url'] || !values['--event-id']) throw new Error('invalid-arguments');
    let input;
    try {
        const stat = fs.statSync(values['--input']);
        if (!stat.isFile() || stat.size > 65536) throw new Error();
        input = JSON.parse(fs.readFileSync(values['--input'], 'utf8'));
    } catch { throw new Error('invalid-input'); }
    const target = { projectId: values['--project'], databaseUrl: values['--database-url'], eventId: values['--event-id'] };
    const options = { apply: values['--apply-emulator'] === true };
    // Pure dry-run never loads an adapter, initializes a provider or performs network I/O.
    if (options.apply) options.adapter = require('./emulator.cjs').emulatorAdapter(target);
    return provision(input, target, options);
}
if (require.main === module) main(process.argv.slice(2)).then(result => console.log(JSON.stringify(result))).catch(error => {
    console.error(JSON.stringify({ status: 'failed', code: allowedErrors.has(error.code || error.message) ? (error.code || error.message) : 'setup-failed' }));
    process.exitCode = 1;
});
module.exports = { main };
