'use strict';
const { isIP } = require('node:net');

function firewallManifest(addresses) {
  if (!Array.isArray(addresses) || !addresses.length || addresses.length > 999) {
    throw new Error('A nonempty exact IPv4 allowlist of at most 999 entries is required');
  }
  if (Array.from(addresses).some(address => typeof address !== 'string' || isIP(address) !== 4)) {
    throw new Error('Only exact IPv4 addresses are accepted');
  }
  if (new Set(addresses).size !== addresses.length) throw new Error('Duplicate address');
  return { ingressRules: [
    ...addresses.map((address, index) => ({ priority: 1000 + index, sourceRange: `${address}/32`, action: 'ALLOW' })),
    // REQUIRED: batchUpdate adds allow-all if the final wildcard rule is absent.
    { priority: 2147483647, sourceRange: '*', action: 'DENY' }
  ] };
}

if (require.main === module) {
  const fs = require('node:fs');
  const path = require('node:path');
  let descriptor;
  try {
    if (process.argv.length !== 4) throw new Error('Private input and output files required');
    const project = fs.realpathSync(path.resolve(__dirname, '../..'));
    const insideProject = candidate => candidate === project || candidate.startsWith(`${project}${path.sep}`);
    if (!fs.lstatSync(process.argv[2]).isFile()) throw new Error('Regular input file required');
    const source = fs.realpathSync(process.argv[2]);
    const destination = path.resolve(process.argv[3]);
    const parent = fs.realpathSync(path.dirname(destination));
    if (insideProject(path.resolve(process.argv[2])) || insideProject(source) ||
        insideProject(destination) || insideProject(parent)) throw new Error('Files must be outside checkout');
    const values = fs.readFileSync(source, 'utf8').trim().split(/\r?\n/);
    const manifest = firewallManifest(values);
    descriptor = fs.openSync(path.join(parent, path.basename(destination)), 'wx', 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(manifest, null, 2)}\n`);
    process.stdout.write(`Firewall manifest written (${values.length} allowed addresses).\n`);
  } catch {
    // Do not echo input values or paths: the allowlist is private configuration.
    console.error('Manifest refused: require a private regular input and new output outside checkout');
    process.exitCode = 1;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}
module.exports = { firewallManifest };
