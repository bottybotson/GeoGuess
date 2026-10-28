#!/usr/bin/env node
'use strict';
// Execute the original assertions, adapting only fixture setup to the stricter
// one-round host contract. No source admission test file is changed or skipped.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const filename = path.join(__dirname, '../event-admission/admission.cjs');
let source = fs.readFileSync(filename, 'utf8');
function replaceExactly(before, after, count = 1) {
    assert.equal(source.split(before).length - 1, count, `Admission setup anchor drifted: ${before}`);
    source = source.split(before).join(after);
}
replaceExactly("fs.readFileSync(path.join(__dirname, 'rules.json'), 'utf8')", `fs.readFileSync(${JSON.stringify(path.join(__dirname, 'rules.json'))}, 'utf8')`);
replaceExactly("env.authenticatedContext(uid).database()", "env.authenticatedContext(uid, uid === 'organizer' ? { firebase: { sign_in_provider: 'password' } } : {}).database()");
replaceExactly("private: { setup: 'private-fixture', answers: { r1: 42 }, guesses: { guest: 7 } }", "private: { setup: 'private-fixture', answers: { r1: 42 }, guesses: { guest: 7 }, round: { id: 'r1', panoramaId: 'fixture-only', heading: 0, pitch: 0, answer: {lat: 0, lng: 0}, difficulty: 2000 } }");
const start = "update(ref(db('organizer')), { [`${pub}/phase`]: 'guessing', [`${pub}/round`]: { id: 'r1', panoramaId: 'fixture-only', heading: 0, pitch: 0 } })";
replaceExactly("set(ref(db('organizer'), `${pub}/phase`), 'guessing')", start, 4);
// Non-lobby admission guards are independent from phase-transition permissions.
// Include the new closed phase, retaining guessing/reveal/complete assertions.
replaceExactly("['guessing', 'reveal', 'complete']", "['guessing', 'closed', 'reveal', 'complete']");
replaceExactly("await set(ref(db('organizer'), `${pub}/phase`), phase);", "await trusted(database => set(ref(database, `${pub}/phase`), phase));");
// The one-round smoke requires at least one admitted player before start.
replaceExactly(`    await assertSucceeds(${start});`, `    await claim(db('start_support'), 'start_support', 's50');\n    await assertSucceeds(${start});`);
replaceExactly("test('join racing host start follows authoritative accepted state order', async () => {", "test('join racing host start follows authoritative accepted state order', async () => {\n    await claim(db('race_support'), 'race_support', 's50');");
replaceExactly("    before.public.phase = 'guessing';", "    before.public.phase = 'guessing';\n    before.public.round = { id: 'r1', panoramaId: 'fixture-only', heading: 0, pitch: 0 };");
const fixtureModule = new Module(filename, module);
fixtureModule.filename = filename;
fixtureModule.paths = Module._nodeModulePaths(path.dirname(filename));
fixtureModule._compile(source, filename);
