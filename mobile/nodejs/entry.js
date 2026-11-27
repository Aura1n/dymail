'use strict';

/* Entry point of the Node.js project that runs inside the Android app (capacitor-nodejs).
 *
 * Bundled by scripts/build-www.js into dist/nodejs/index.js. `bridge` is provided by the runtime and
 * is the only module left external. What this file does:
 *   1. picks the private data directory the runtime gives us,
 *   2. makes sure there is a master key for credential encryption,
 *   3. boots the headless core (core/index.js -> the unchanged desktop main process),
 *   4. tells the WebView where the local bridge listens.
 *
 * Handshake: the page can load before or after the core is up, and may reload while it keeps running,
 * so the page asks for the address ("get-core") until it gets an answer; the core also announces it
 * once when ready. */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { channel, getDataPath } = require('bridge');

const base = path.join(getDataPath(), 'dymail');
const dataDir = path.join(base, 'data');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(path.join(base, 'downloads'), { recursive: true });

process.env.DYMAIL_DATA_DIR = dataDir;
process.env.DYMAIL_DOWNLOADS = path.join(base, 'downloads');

/* Credentials are encrypted with this key. Until a hardware-backed key (Android Keystore) is wired in
   through a native plugin, it lives in the app's private storage next to the data it protects, so it
   keeps other apps out but not someone with root or a full device backup. A key supplied through
   DYMAIL_MASTER_KEY always wins, which is the hook for that later hardening. */
if (!process.env.DYMAIL_MASTER_KEY) {
  const keyFile = path.join(base, 'master.key');
  let key = '';
  try {
    key = fs.readFileSync(keyFile, 'utf8').trim();
  } catch {
    /* first start */
  }
  if (Buffer.from(key, 'base64').length !== 32) {
    key = crypto.randomBytes(32).toString('base64');
    fs.writeFileSync(keyFile, key, { mode: 0o600 });
  }
  process.env.DYMAIL_MASTER_KEY = key;
}

let info = null;

channel.on('get-core', () => {
  if (info) channel.send('core-ready', info);
});

try {
  require('../core/index.js')
    .ready.then((started) => {
      info = { port: started.port, token: started.token };
      channel.send('core-ready', info);
    })
    .catch((err) => {
      channel.send('core-failed', String(err && err.message ? err.message : err));
    });
} catch (err) {
  channel.send('core-failed', String(err && err.message ? err.message : err));
  throw err;
}
