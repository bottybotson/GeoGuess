'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { firewallManifest } = require('./firewall.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('exact IPv4 ALLOW rules precede the explicit universal DENY', () => {
  const manifest = firewallManifest(['203.0.113.7', '203.0.113.8']);
  assert.deepEqual(manifest.ingressRules, [
    { priority: 1000, sourceRange: '203.0.113.7/32', action: 'ALLOW' },
    { priority: 1001, sourceRange: '203.0.113.8/32', action: 'ALLOW' },
    { priority: 2147483647, sourceRange: '*', action: 'DENY' }
  ]);
  // The API contract defines '*' as BOTH 0/0 and ::/0; never omit this rule.
  const fallback = manifest.ingressRules.at(-1);
  assert.equal(fallback.sourceRange, '*');
  assert.equal(fallback.action, 'DENY');
  assert.equal(fallback.priority, 2147483647);
  assert.equal(manifest.ingressRules.filter(rule => rule.action === 'ALLOW').every(rule => rule.sourceRange.endsWith('/32')), true);
});

test('empty, wildcard, malformed, broad, duplicate and IPv6 inputs fail closed', () => {
  for (const addresses of [undefined, null, '', [], Array(1), [''], ['*'], ['0.0.0.0/0'], ['::/0'], ['::1'], ['203.0.113.7/24'], ['203.0.113.999'], ['203.0.113.07'], [' 203.0.113.7'], ['203.0.113.7 '], ['203.0.113.7,203.0.113.8'], ['203.0.113.7', ''], ['203.0.113.7', '203.0.113.7'], [7], Array(1000).fill('203.0.113.7')]) {
    assert.throws(() => firewallManifest(addresses));
  }
});

test('CLI writes exclusively outside checkout with private permissions and no address output', t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'firewall-cli-'));
  const checkout = fs.mkdtempSync(path.join(__dirname, 'privacy-fixture-'));
  t.after(() => {
    fs.rmSync(temporary, { recursive: true, force: true });
    fs.rmSync(checkout, { recursive: true, force: true });
  });
  const input = path.join(temporary, 'input');
  const output = path.join(temporary, 'output');
  fs.writeFileSync(input, '203.0.113.7\n');
  const run = (...args) => spawnSync(process.execPath, [path.join(__dirname, 'firewall.cjs'), ...args], { encoding: 'utf8' });
  function noEcho(result) {
    assert.doesNotMatch(result.stdout + result.stderr, /203\.0\.113|firewall-cli-|privacy-fixture-/);
  }
  function refused(...args) {
    const result = run(...args);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    noEcho(result);
  }
  refused();
  refused(input);
  refused(path.join(temporary, 'absent'), output);
  refused(input, path.join(temporary, 'absent-parent', 'output'));
  const privateInput = path.join(checkout, 'input');
  fs.writeFileSync(privateInput, '203.0.113.7\n');
  refused(privateInput, output);
  refused(input, path.join(checkout, 'output'));
  assert.equal(fs.existsSync(output), false);
  fs.symlinkSync(input, path.join(temporary, 'input-link'));
  refused(path.join(temporary, 'input-link'), output);
  fs.symlinkSync(input, path.join(temporary, 'output-link'));
  refused(input, path.join(temporary, 'output-link'));
  fs.symlinkSync(checkout, path.join(temporary, 'checkout-link'));
  refused(input, path.join(temporary, 'checkout-link', 'output'));
  const success = run(input, output);
  assert.equal(success.status, 0);
  assert.equal(success.stdout, 'Firewall manifest written (1 allowed addresses).\n');
  assert.equal(success.stderr, '');
  noEcho(success);
  assert.equal(fs.statSync(output).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(fs.readFileSync(output, 'utf8')), firewallManifest(['203.0.113.7']));
  const original = fs.readFileSync(output, 'utf8');
  refused(input, output);
  assert.equal(fs.readFileSync(output, 'utf8'), original);
  fs.writeFileSync(input, '203.0.113.999\n');
  refused(input, path.join(temporary, 'invalid-output'));
  assert.equal(fs.existsSync(path.join(temporary, 'invalid-output')), false);
});
