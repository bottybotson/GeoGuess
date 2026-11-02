#!/usr/bin/env node
'use strict';
// Preserve the original SDK8 lobby assertions; allow only its new pure version
// validator dependency in the existing isolated source-module loader.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const filename = path.join(__dirname, '../event-admission/lobby-client.cjs');
let source = fs.readFileSync(filename, 'utf8');
const before = "        assert.equal(id, './admission', 'Unexpected app dependency in isolated lobby fixture');\n        return sourceModule(path.join(path.dirname(filename), 'admission.js'));";
const after = "        assert.ok(['./admission', './version'].includes(id), 'Unexpected app dependency in isolated lobby fixture');\n        return sourceModule(path.join(path.dirname(filename), `${id.slice(2)}.js`));";
assert.equal(source.split(before).length - 1, 1, 'Isolated dependency-loader anchor drifted');
source = source.replace(before, after);
const fixtureModule = new Module(filename, module);
fixtureModule.filename = filename;
fixtureModule.paths = Module._nodeModulePaths(path.dirname(filename));
fixtureModule._compile(source, filename);
