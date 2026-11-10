'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const ROOT = path.resolve(__dirname, '../..');
const SERVER_FILES = Object.freeze(['app.yaml', 'package.json', 'package-lock.json', 'server.cjs', 'policy.cjs', 'http.cjs', 'runtime.cjs', 'creation.cjs', 'store.cjs', 'validator.cjs', '.gcloudignore']);
const inside = (parent, child) => child === parent || child.startsWith(`${parent}${path.sep}`);
function stage({ dist, output }) {
  if (typeof dist !== 'string' || typeof output !== 'string') throw new Error('staging-paths-required');
  const source = fs.realpathSync(dist);
  if (!fs.lstatSync(dist).isDirectory() || fs.lstatSync(dist).isSymbolicLink()) throw new Error('dist-directory-required');
  const destination = path.join(fs.realpathSync(path.dirname(path.resolve(output))), path.basename(output));
  if (inside(ROOT, destination) || inside(source, destination) || fs.existsSync(destination)) throw new Error('fresh-external-staging-required');
  const files = new Map();
  const collect = (location, relative) => {
    const stat = fs.lstatSync(location);
    if (stat.isSymbolicLink()) throw new Error('staging-symlink-refused');
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(location).sort()) {
        if (entry.startsWith('.')) throw new Error('unexpected-dist-file');
        collect(path.join(location, entry), `${relative}/${entry}`);
      }
    } else if (stat.isFile() && /\.(html|css|js|json|map|png|jpg|jpeg|gif|svg|ico|webp|avif|woff|woff2|ttf|eot|txt|xml|webmanifest)$/.test(relative)) {
      // Only index.html is served as HTML by the reviewed SPA handler.
      if (relative.endsWith('.html') && relative !== 'dist/index.html') throw new Error('unexpected-dist-file');
      files.set(relative, fs.readFileSync(location));
    } else throw new Error('unexpected-dist-file');
  };
  collect(source, 'dist');
  if (!files.has('dist/index.html')) throw new Error('dist-index-required');
  for (const name of SERVER_FILES) {
    const file = path.join(__dirname, name);
    if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) throw new Error('server-file-required');
    files.set(name, fs.readFileSync(file));
  }
  files.set('seed-core.cjs', fs.readFileSync(path.join(ROOT, 'scripts/event-setup/core.cjs')));
  const manifest = { formatVersion: 1, activation: 'issue-81-review-required', runtime: 'nodejs22',
    validatorSource: 'scripts/event-setup/core.cjs',
    files: [...files].sort(([a], [b]) => a.localeCompare(b)).map(([name, bytes]) => ({ path: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })) };
  fs.mkdirSync(destination, { mode: 0o700 });
  try {
    for (const [name, bytes] of files) {
      const location = path.join(destination, name);
      fs.mkdirSync(path.dirname(location), { recursive: true, mode: 0o700 });
      fs.writeFileSync(location, bytes, { flag: 'wx', mode: 0o600 });
    }
    // Audit artifact remains in staging but is excluded from the upload.
    fs.writeFileSync(path.join(destination, 'staging-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  } catch (error) { fs.rmSync(destination, { recursive: true, force: true }); throw error; }
  return manifest;
}
if (require.main === module) {
  try {
    if (process.argv.length !== 4) throw new Error('usage');
    const result = stage({ dist: process.argv[2], output: process.argv[3] });
    console.log(JSON.stringify({ status: 'staged-for-review', files: result.files.length }));
  } catch { console.error(JSON.stringify({ error: 'staging-refused' })); process.exitCode = 1; }
}
module.exports = { stage, SERVER_FILES };
