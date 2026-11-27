'use strict';

/* Runs the bundled phone core (dist/nodejs/index.js) on this computer, with a stand-in for the
 * runtime's `bridge` module, and checks it comes up and answers.
 *   node mobile/scripts/build-www.js && node mobile/scripts/test-bundle.js
 * It proves the esbuild bundle works (every dependency resolved, the electron alias in effect, the
 * handshake message sent). It does not prove it works on Android: that runtime is Node 18 without Intl. */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const bundle = path.join(__dirname, '..', 'dist', 'nodejs', 'index.js');
if (!fs.existsSync(bundle)) {
  console.error('dist/nodejs/index.js not found. Run: node mobile/scripts/build-www.js');
  process.exit(1);
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dymail-bundle-'));
const stub = path.join(work, 'modules', 'bridge');
fs.mkdirSync(stub, { recursive: true });
fs.writeFileSync(
  path.join(stub, 'index.js'),
  `const { EventEmitter } = require('events');
const channel = new EventEmitter();
channel.send = (name, ...args) => console.log('CHANNEL ' + JSON.stringify({ name, args }));
module.exports = { channel, getDataPath: () => process.env.STUB_DATA, onPause() {}, onResume() {} };
`
);

let failures = 0;
function check(name, ok, detail) {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` — ${detail}` : ''}`);
}

const child = spawn(process.execPath, [bundle], {
  env: { ...process.env, NODE_PATH: path.join(work, 'modules'), STUB_DATA: path.join(work, 'appdata') },
  stdio: ['ignore', 'pipe', 'pipe']
});
let out = '';
let err = '';
child.stdout.on('data', (chunk) => { out += chunk; });
child.stderr.on('data', (chunk) => { err += chunk; });

const finish = (code) => {
  try { child.kill(); } catch { /* already gone */ }
  console.log(failures ? `\n${failures} check(s) failed` : '\nbundle test passed');
  process.exit(code);
};

(async () => {
  const started = Date.now();
  let message = null;
  while (Date.now() - started < 20000 && !message) {
    const line = out.split('\n').find((l) => l.startsWith('CHANNEL ') && l.includes('"core-'));
    if (line) message = JSON.parse(line.slice(8));
    if (child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  console.log(`bundle: ${(fs.statSync(bundle).size / 1048576).toFixed(2)} MB`);
  check('process stays up', child.exitCode === null, `exited with ${child.exitCode}`);
  check('announces core-ready', Boolean(message && message.name === 'core-ready'), message ? JSON.stringify(message) : (err || out).slice(-800));
  if (!message || message.name !== 'core-ready') return finish(1);

  const { port, token } = message.args[0];
  const rpc = async (channel, payload) => {
    const res = await fetch(`http://127.0.0.1:${port}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dymail-token': token, origin: 'http://localhost' },
      body: JSON.stringify({ channel, payload })
    });
    return { status: res.status, headers: res.headers, body: await res.json() };
  };

  let r = await rpc('app:info', {});
  check('app:info answers through the bundle', r.body.ok === true && Boolean(r.body.data.version), JSON.stringify(r.body));
  check('reports the phone version, not the desktop one', r.body.ok === true && r.body.data.version === JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'version.json'), 'utf8')).version, r.body.ok ? r.body.data.version : '');
  check('allows the Capacitor page origin (CORS)', r.headers.get('access-control-allow-origin') === 'http://localhost', String(r.headers.get('access-control-allow-origin')));

  r = await rpc('accounts:list', {});
  check('accounts:list works', r.body.ok === true && Array.isArray(r.body.data), JSON.stringify(r.body));

  const staged = await rpc('mobile:stage-file', { name: 'a.txt', data: Buffer.from('x').toString('base64') });
  check('stage-file writes under the app data dir', staged.body.ok === true && staged.body.data.path.startsWith(path.join(work, 'appdata')), JSON.stringify(staged.body));

  r = await rpc('mobile:poll', {});
  check('mobile:poll answers through the bundle', r.body.ok === true, JSON.stringify(r.body));

  r = await rpc('settings:update', { signature: 'bundle test' });
  const keyFile = path.join(work, 'appdata', 'dymail', 'master.key');
  check('creates the master key file', fs.existsSync(keyFile) && Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'base64').length === 32);

  child.stdout.removeAllListeners('data');
  const again = out.split('\n').filter((l) => l.includes('"core-ready"')).length;
  check('announced exactly once on its own', again === 1, `seen ${again}`);

  finish(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  finish(1);
});
