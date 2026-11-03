'use strict';
const fs = require('node:fs');
const path = require('node:path');
function loadValidator() {
  // The staging step copies the canonical source byte-for-byte. There is no
  // maintained backend/frontend fork of this privileged schema validator.
  const staged = path.join(__dirname, 'seed-core.cjs');
  return require(fs.existsSync(staged) ? staged : path.resolve(__dirname, '../../scripts/event-setup/core.cjs'));
}
module.exports = { loadValidator };
