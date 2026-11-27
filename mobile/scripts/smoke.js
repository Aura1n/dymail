'use strict';

/* Boots the headless core on this machine and checks the bridge end to end.
 *   node mobile/scripts/smoke.js
 * Needs Node 18+ (global fetch). Uses a throw-away data directory. */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dymail-smoke-'));
process.env.DYMAIL_DATA_DIR = dataDir;
process.env.DYMAIL_DEV = '1';

let failures = 0;
function check(name, condition, detail) {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

(async () => {
  const core = require('../core/index.js');
  const { port, token } = await core.ready;
  const base = `http://127.0.0.1:${port}`;
  const rpc = async (channel, payload, tk = token) => {
    const res = await fetch(`${base}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dymail-token': tk },
      body: JSON.stringify({ channel, payload })
    });
    return { status: res.status, body: await res.json() };
  };

  console.log(`core listening on 127.0.0.1:${port}, data in ${dataDir}`);

  let r = await rpc('app:info', {});
  check('app:info answers', r.status === 200 && r.body.ok === true && r.body.data.version, JSON.stringify(r.body));

  r = await rpc('app:info', {}, 'wrong-token');
  check('wrong token is rejected', r.status === 401);

  r = await rpc('nope:nothing', {});
  check('unknown channel is rejected', r.status === 404);

  r = await rpc('accounts:list', {});
  check('accounts:list returns an array', r.body.ok === true && Array.isArray(r.body.data), JSON.stringify(r.body));

  r = await rpc('settings:update', { theme: 'dark', signature: 'smoke test' });
  check('settings:update stores values', r.body.ok === true && r.body.data.theme === 'dark', JSON.stringify(r.body));

  r = await rpc('settings:get', {});
  check('settings:get reads them back', r.body.ok === true && r.body.data.signature === 'smoke test');

  r = await rpc('accounts:save', { email: 'not-an-email', imap: {}, smtp: {} });
  check('invalid account is refused with a message', r.body.ok === false && /邮箱/.test(r.body.error), JSON.stringify(r.body));

  r = await rpc('mobile:stage-file', { name: '../evil/a.txt', data: Buffer.from('hello').toString('base64') });
  check('stage-file stores bytes and returns a path', r.body.ok === true && fs.readFileSync(r.body.data.path, 'utf8') === 'hello', JSON.stringify(r.body));
  check('stage-file neutralises path separators in the name', r.body.ok === true && r.body.data.name === '.._evil_a.txt' && path.basename(r.body.data.path) === '.._evil_a.txt', r.body.ok ? r.body.data.name : '');

  r = await rpc('mobile:stage-file', { name: 'empty.txt', data: '' });
  check('stage-file refuses empty content', r.body.ok === false);

  r = await rpc('mobile:poll', {});
  check('mobile:poll answers (no accounts yet, so nothing to check)', r.body.ok === true, JSON.stringify(r.body));

  const events = await fetch(`${base}/events?token=${encodeURIComponent(token)}`);
  check('event stream opens', events.status === 200 && /event-stream/.test(events.headers.get('content-type')));
  await events.body.cancel();

  const bad = await fetch(`${base}/events?token=nope`);
  check('event stream rejects a bad token', bad.status === 401);

  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error('smoke test crashed:', err);
  process.exit(1);
});
