'use strict';

/* Preview the mobile UI in a desktop browser.
 *
 *   node mobile/scripts/dev.js              demo data      -> http://localhost:5173/?demo=1
 *   node mobile/scripts/dev.js --core       real core too  -> prints a URL with ?core=…&token=…
 *
 * Open the printed URL in Chrome and switch on device emulation (F12, Ctrl+Shift+M) for a phone-sized view. */

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..', 'www');
const port = Number(process.env.PORT) || 5173;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

http
  .createServer((req, res) => {
    const clean = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.normalize(path.join(root, clean === '/' ? 'index.html' : clean));
    if (!file.startsWith(root)) {
      res.writeHead(403);
      return res.end();
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end('Not found');
      }
      res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(data);
    });
  })
  .listen(port, '127.0.0.1', async () => {
    console.log(`UI preview     http://localhost:${port}/?demo=1`);
    if (process.argv.includes('--core')) {
      process.env.DYMAIL_DEV = '1';
      process.env.DYMAIL_DATA_DIR = process.env.DYMAIL_DATA_DIR || path.join(os.homedir(), '.dymail-mobile-dev');
      const { port: corePort, token } = await require('../core/index.js').ready;
      console.log(`Real core      http://localhost:${port}/?core=${encodeURIComponent(`http://127.0.0.1:${corePort}`)}&token=${token}`);
      console.log(`Data folder    ${process.env.DYMAIL_DATA_DIR}`);
    }
  });
