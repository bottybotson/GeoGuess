#!/usr/bin/env node
'use strict';
// Preserve both reviewed protocols while gating every authorization at its source.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const format = "root.child('events').child($event).child('public').child('formatVersion')";
const v1Guard = `!${format}.exists()`;
const v2Guard = `${format}.isNumber() && ${format}.val() == 2`;
const read = name => JSON.parse(fs.readFileSync(path.join(__dirname, `../${name}/rules.json`), 'utf8')).rules.events.$event;
const permit = (value, guard) => value === false || value === undefined ? false : `(${guard}) && (${value})`;
const either = (a, b) => a === false ? b : b === false ? a : `(${a}) || (${b})`;
function combine(a = {}, b = {}) {
    const result = {};
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (key === '.read' || key === '.write') result[key] = either(permit(a[key], v1Guard), permit(b[key], v2Guard));
        else if (key === '.validate') {
            result[key] = a[key] === b[key] ? a[key] : either(permit(a[key], v1Guard), permit(b[key], v2Guard));
        } else result[key] = combine(a[key], b[key]);
    }
    return result;
}
const event = combine(read('event-round'), read('event-session'));
// This public leaf is the only unguarded grant, and cannot write trusted version.
event.public.formatVersion = { '.read': true };
for (const node of [event, event.public, event.private, event.public.rounds, event.public.rounds.$round]) {
    assert.ok(!node['.read'] && !node['.write'], 'No ancestor authorization is allowed');
}
const rules = { rules: { '.read': false, '.write': false, events: { $event: event } } };
fs.writeFileSync(path.join(__dirname, 'rules.json'), `${JSON.stringify(rules, null, 2)}\n`);
