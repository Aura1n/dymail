'use strict';

/* Headless Dymail core.
 *
 * Runs the unchanged desktop main process on plain Node (via electron-shim) and exposes its IPC
 * handlers on a loopback-only HTTP bridge, so the mobile WebView talks to it exactly like the
 * desktop renderer talks to the preload:
 *
 *   POST /rpc     {channel, payload}  header X-Dymail-Token  ->  {ok, data} | {ok:false, error}
 *   GET  /events  ?token=...          Server-Sent Events: one event per push (mail:push, mail:status, ...)
 *
 * Environment
 *   DYMAIL_DATA_DIR     where accounts / mail cache live (private app dir on the phone)
 *   DYMAIL_MASTER_KEY   base64 32-byte key from the Android Keystore; without it credentials are not saved
 *   DYMAIL_TOKEN        shared secret for the bridge (random if omitted)
 *   DYMAIL_PORT         0 = pick a free port (default)
 *   DYMAIL_ORIGINS      comma list of allowed web origins (default: Capacitor's)
 *   DYMAIL_DEV=1        desktop testing only: any origin allowed, throw-away master key kept on disk,
 *                       and core.json written next to the data
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const DEV = process.env.DYMAIL_DEV === '1';
const DATA = path.resolve(process.env.DYMAIL_DATA_DIR || path.join(os.homedir(), '.dymail-mobile-dev'));
fs.mkdirSync(DATA, { recursive: true });

/* The desktop code already has a test hook for its data folder; it also skips the
   single-instance lock, which is what we want here. */
process.env.DYMALL_USERDATA = DATA;

if (!process.env.DYMAIL_MASTER_KEY && DEV) {
  const keyFile = path.join(DATA, 'dev-master.key');
  if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, crypto.randomBytes(32).toString('base64'));
  process.env.DYMAIL_MASTER_KEY = fs.readFileSync(keyFile, 'utf8').trim();
}

/* Phone build: esbuild bundles everything and aliases `electron` to the shim at build time, and
   defines DYMAIL_BUNDLED as "1" so this branch (and the dynamic require below) disappears.
   Desktop testing (smoke.js, dev.js) takes the runtime-patch path instead. */
if (!process.env.DYMAIL_BUNDLED) {
  const shimPath = require.resolve('./electron-shim');
  const resolve = Module._resolveFilename;
  Module._resolveFilename = function patched(request, ...rest) {
    return request === 'electron' ? shimPath : resolve.call(this, request, ...rest);
  };
}

const shim = require('./electron-shim');
const { bus, handlers } = shim.__internals;
const { checkUpdate } = require('./update');
const { createNotifier } = require('./notifier');

if (process.env.DYMAIL_BUNDLED) {
  require('../../src/main/main.js');
} else {
  require(process.env.DYMAIL_MAIN || path.join(__dirname, '..', '..', 'src', 'main', 'main.js'));
}

const token = process.env.DYMAIL_TOKEN || crypto.randomBytes(24).toString('hex');
const allowed = new Set(
  (process.env.DYMAIL_ORIGINS || 'https://localhost,http://localhost,capacitor://localhost').split(',').map((s) => s.trim()).filter(Boolean)
);
const MAX_BODY = 50 * 1024 * 1024;
const streams = new Set();

function tokenOk(candidate) {
  const a = Buffer.from(String(candidate || ''));
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && (DEV || allowed.has(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'content-type, x-dymail-token');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('请求过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  const url = new URL(req.url, 'http://127.0.0.1');

  if (req.method === 'GET' && url.pathname === '/events') {
    if (!tokenOk(url.searchParams.get('token'))) return json(res, 401, { ok: false, error: '未授权' });
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write(': ready\n\n');
    streams.add(res);
    req.on('close', () => streams.delete(res));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/rpc') {
    if (!tokenOk(req.headers['x-dymail-token'])) return json(res, 401, { ok: false, error: '未授权' });
    let message;
    try {
      message = JSON.parse(await readBody(req));
    } catch {
      return json(res, 400, { ok: false, error: '请求格式无效' });
    }
    const handler = handlers.get(String(message && message.channel));
    if (!handler) return json(res, 404, { ok: false, error: '未知操作' });
    try {
      return json(res, 200, await handler({ sender: 'mobile' }, message.payload));
    } catch (err) {
      return json(res, 500, { ok: false, error: err && err.message ? err.message : '操作失败' });
    }
  }

  json(res, 404, { ok: false, error: 'Not found' });
});

function push(event, payload) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(payload === undefined ? null : payload)}\n\n`;
  for (const res of streams) res.write(frame);
}
bus.on('event', (channel, payload) => push(channel, payload));
bus.on('native', (command) => push('native', command));
setInterval(() => {
  for (const res of streams) res.write(': ping\n\n');
}, 20000).unref();

async function waitForHandlers() {
  const started = Date.now();
  while (!handlers.has('app:info')) {
    if (Date.now() - started > 15000) throw new Error('核心启动超时');
    await new Promise((r) => setTimeout(r, 40));
  }
}

/* ---- phone-only channels (same {ok,data} envelope the desktop handlers use) ---- */

const MAX_STAGED_BYTES = 25 * 1024 * 1024; // the mail layer refuses more than this in total anyway
const STAGE_DIR = path.join(DATA, 'outgoing');
const STAGE_TTL_MS = 24 * 60 * 60 * 1000;

const ok = (data) => ({ ok: true, data });
const fail = (err) => ({ ok: false, error: String(err && err.message ? err.message : '操作失败').slice(0, 400) });

function safeName(name) {
  const cleaned = String(name || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\.+$/, '')
    .trim()
    .slice(0, 120);
  return cleaned || 'file';
}

function sweepStaged() {
  try {
    for (const entry of fs.readdirSync(STAGE_DIR)) {
      const dir = path.join(STAGE_DIR, entry);
      try {
        if (Date.now() - fs.statSync(dir).mtimeMs > STAGE_TTL_MS) fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
  } catch {}
}

/* The core calls its own handlers the way the desktop renderer would, minus the HTTP hop. */
let notifier = null;
function callHandler(channel, payload) {
  const handler = handlers.get(channel);
  if (!handler) return Promise.reject(new Error(`no handler for ${channel}`));
  return Promise.resolve(handler({ sender: 'core' }, payload || {})).then((result) => {
    if (!result || result.ok !== true) throw new Error((result && result.error) || '操作失败');
    return result.data;
  });
}

function registerMobileHandlers() {
  /* The WebView can only hand over file *contents*, while the mail layer wants a path: park the bytes
     in a private folder and return the path. Drafts copy it again, plain sends read it directly. */
  handlers.set('mobile:stage-file', async (_event, payload) => {
    try {
      const name = safeName(payload && payload.name);
      const data = String((payload && payload.data) || '');
      if (!data) throw new Error('文件内容为空');
      if (data.length > Math.ceil((MAX_STAGED_BYTES * 4) / 3) + 8) throw new Error('附件不能超过 25 MB');
      const bytes = Buffer.from(data, 'base64');
      if (!bytes.length) throw new Error('文件内容无效');
      if (bytes.length > MAX_STAGED_BYTES) throw new Error('附件不能超过 25 MB');
      const dir = path.join(STAGE_DIR, crypto.randomUUID());
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, name);
      fs.writeFileSync(file, bytes);
      return ok({ name, size: bytes.length, path: file });
    } catch (err) {
      return fail(err);
    }
  });

  /* Which OAuth logins this build can offer. The client IDs come from oauth-config.js, whose
     env reads are replaced at bundle time (build-www.js). Without an ID the sign-in button
     would only produce an error, so the UI hides it and guides to app passwords instead. */
  handlers.set('mobile:oauth-providers', async () => {
    try {
      const clients = require('../../src/main/oauth-config');
      return ok({
        google: Boolean(clients.google && clients.google.clientId),
        microsoft: Boolean(clients.microsoft && clients.microsoft.clientId)
      });
    } catch (err) {
      return fail(err);
    }
  });

  /* Reads the update source from the same saved setting the desktop uses (settings.updateRepo). */
  handlers.set('mobile:update-check', async () => {
    try {
      const saved = await handlers.get('settings:get')({}, {});
      const settings = saved && saved.ok ? saved.data : {};
      return ok(await checkUpdate({ repo: String(settings.updateRepo || '').trim(), current: shim.app.getVersion() }));
    } catch (err) {
      return fail(err);
    }
  });

  /* The shell's heartbeat: re-check every mailbox now. Catches mail the push connection missed, e.g. because
     the network dropped it silently while the phone slept. */
  handlers.set('mobile:poll', async () => {
    try {
      if (notifier) await notifier.checkAll();
      return ok({ at: Date.now() });
    } catch (err) {
      return fail(err);
    }
  });

  sweepStaged();
  setInterval(sweepStaged, 6 * 60 * 60 * 1000).unref();
}

async function start() {
  await waitForHandlers();
  registerMobileHandlers();
  notifier = createNotifier({ call: callHandler, bus, dataDir: DATA });
  notifier.start();
  await new Promise((resolveListen) => server.listen(Number(process.env.DYMAIL_PORT) || 0, '127.0.0.1', resolveListen));
  const info = { port: server.address().port, token };
  /* The native shell reads this single line to learn where the bridge is. */
  console.log(`DYMAIL_CORE_READY ${JSON.stringify(info)}`);
  if (DEV) fs.writeFileSync(path.join(DATA, 'core.json'), JSON.stringify(info));
  return info;
}

const ready = start().catch((err) => {
  console.error('DYMAIL_CORE_FAILED', err && err.message ? err.message : err);
  process.exit(1);
});

module.exports = { ready, server, handlers };
