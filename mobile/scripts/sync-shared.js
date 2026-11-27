'use strict';

/* Keeps the two files the mobile UI shares with the desktop renderer in step.
 *   node mobile/scripts/sync-shared.js
 * demo.js (sample mailbox) and sanitize.js (HTML mail cleaning) are copied, never edited here. */

const fs = require('node:fs');
const path = require('node:path');

const from = path.join(__dirname, '..', '..', 'src', 'renderer');
const to = path.join(__dirname, '..', 'www', 'shared');
fs.mkdirSync(to, { recursive: true });
for (const name of ['demo.js', 'sanitize.js']) {
  fs.copyFileSync(path.join(from, name), path.join(to, name));
  console.log(`copied ${name}`);
}
