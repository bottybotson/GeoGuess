'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { stage, SERVER_FILES } = require('./stage.cjs');
test('complete reproducible staging includes byte-identical canonical validator/lock/modules and excludes operator/test/credential files', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'creation-stage-'));
  try {
    const dist = path.join(temp, 'dist'); fs.mkdirSync(path.join(dist, 'js'), { recursive: true });
    fs.writeFileSync(path.join(dist, 'index.html'), '<html>synthetic</html>');
    fs.writeFileSync(path.join(dist, 'js/app.js'), 'synthetic');
    const a = path.join(temp, 'a'), b = path.join(temp, 'b');
    const first = stage({ dist, output: a }), second = stage({ dist, output: b });
    assert.deepEqual(first, second);
    assert.deepEqual(fs.readFileSync(path.join(a, 'seed-core.cjs')), fs.readFileSync(path.resolve(__dirname, '../../scripts/event-setup/core.cjs')));
    assert.deepEqual(require(path.join(a, 'validator.cjs')).loadValidator(), require(path.join(a, 'seed-core.cjs')));
    assert.deepEqual(new Set(first.files.map(file => file.path)), new Set([...SERVER_FILES, 'seed-core.cjs', 'dist/index.html', 'dist/js/app.js']));
    for (const file of first.files) {
      const bytes = fs.readFileSync(path.join(a, file.path));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
      assert.equal(bytes.length, file.bytes);
      if (file.path !== '.gcloudignore' && !file.path.startsWith('dist/')) assert.match(fs.readFileSync(path.join(a, '.gcloudignore'), 'utf8'), new RegExp(`!${file.path.replaceAll('.', '\\.')}(?:\\n|$)`));
    }
    assert.equal(first.files.some(file => /test|firewall|stage\.cjs|credential/.test(file.path)), false);
    assert.throws(() => stage({ dist, output: a }), /fresh-external-staging-required/);
    assert.throws(() => stage({ dist, output: path.join(__dirname, 'unsafe-stage') }), /fresh-external-staging-required/);
    fs.symlinkSync(path.join(dist, 'index.html'), path.join(dist, 'secret.js'));
    assert.throws(() => stage({ dist, output: path.join(temp, 'unsafe') }), /staging-symlink-refused/);
    assert.equal(fs.existsSync(path.join(temp, 'unsafe')), false);
    fs.unlinkSync(path.join(dist, 'secret.js')); fs.writeFileSync(path.join(dist, '.env'), 'synthetic');
    assert.throws(() => stage({ dist, output: path.join(temp, 'unsafe') }), /unexpected-dist-file/);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('candidate App Engine handler ordering reserves every /api path before static and SPA', () => {
  const yaml = fs.readFileSync(path.join(__dirname, 'app.yaml'), 'utf8');
  const handlers = [...yaml.matchAll(/^  - url: (.+)\n([\s\S]*?)(?=^  - url: |$(?![\s\S]))/gm)];
  assert.equal(handlers.length, 3);
  assert.equal(handlers[0][1], '/api(/.*)?'); assert.match(handlers[0][2], /script: auto/);
  const route = pathname => handlers.find(entry => new RegExp(`^(?:${entry[1]})$`).test(pathname));
  for (const pathname of ['/api', '/api/', '/api/event-creations', '/api/a.json', '/api/a.js', '/api/event-creations.json']) assert.match(route(pathname)[2], /script: auto/);
  assert.match(route('/js/app.js')[2], /static_files: dist\/\\1/);
  assert.match(route('/event/fresh/host')[2], /static_files: dist\/index.html/);
  assert.match(yaml, /min_instances: 0/); assert.match(yaml, /max_instances: 1/);
  assert.equal((yaml.match(/Cache-Control: no-store/g) || []).length, 2);
});
