'use strict';
/* 假的 GitHub API + 本地字节流，覆盖检查、下载、摘要校验、安装分支。 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { UpdateService, compareVersions, pickAsset } = require('../../src/main/updater');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dymail-updater-'));
const payload = crypto.randomBytes(1024 * 512);
const digest = `sha256:${crypto.createHash('sha256').update(payload).digest('hex')}`;

function release(digestValue) {
  return {
    tag_name: 'v1.4.0',
    name: '1.4.0',
    body: 'notes',
    html_url: 'https://github.com/owner/repo/releases/tag/v1.4.0',
    assets: [
      {
        name: 'Dymail-Setup-1.4.0.exe',
        size: payload.length,
        browser_download_url: 'https://download.test/Dymail-Setup-1.4.0.exe',
        digest: digestValue
      },
      {
        name: 'Dymail-1.4.0.exe',
        size: payload.length,
        browser_download_url: 'https://download.test/Dymail-1.4.0.exe',
        digest: digestValue
      }
    ]
  };
}

function makeFetch(digestValue) {
  return async (url) => {
    if (String(url).startsWith('https://api.github.com/')) {
      return new Response(JSON.stringify(release(digestValue)), { status: 200 });
    }
    if (String(url).startsWith('https://download.test/')) {
      return new Response(payload, {
        status: 200,
        headers: { 'content-length': String(payload.length) }
      });
    }
    throw new Error(`unexpected ${url}`);
  };
}

let quitCalls = 0;
const app = {
  getVersion: () => '1.3.3',
  isPackaged: true,
  getPath: () => tempRoot,
  quit: () => {
    quitCalls += 1;
  }
};
const store = { getSettings: () => ({ updateRepo: 'owner/repo' }) };

(async () => {
  assert.equal(compareVersions('1.4.0', '1.3.3'), 1);
  assert.equal(compareVersions('1.3.3', '1.4'), -1);
  assert.equal(compareVersions('1.2', '1.2.0'), 0);
  assert.equal(pickAsset(release(digest).assets, false).name, 'Dymail-Setup-1.4.0.exe');
  assert.equal(pickAsset(release(digest).assets, true).name, 'Dymail-1.4.0.exe');

  const events = [];
  const service = new UpdateService({
    store,
    app,
    send: (channel, event) => events.push({ channel, event }),
    fetchImpl: makeFetch(digest),
    spawnImpl: () => ({ unref() {} })
  });

  const checked = await service.check();
  assert.equal(checked.hasUpdate, true);
  assert.equal(checked.latest, '1.4.0');
  assert.equal(checked.assetName, 'Dymail-Setup-1.4.0.exe');

  const info = await service.startDownload('1.4.0');
  assert.equal(info.verified, true);
  assert.equal(info.size, payload.length);
  const file = path.join(tempRoot, 'dymail-update', 'Dymail-Setup-1.4.0.exe');
  assert.ok(fs.existsSync(file), 'installer not written');
  assert.deepEqual(fs.readFileSync(file), payload);
  assert.ok(events.some((item) => item.event.phase === 'ready'));

  /* 摘要不匹配时必须删除文件并报错。 */
  const badService = new UpdateService({
    store,
    app,
    send: () => {},
    fetchImpl: makeFetch('sha256:deadbeef'),
    spawnImpl: () => ({ unref() {} })
  });
  await assert.rejects(() => badService.startDownload('1.4.0'), /校验失败/);
  assert.ok(!fs.existsSync(file), 'corrupt installer left behind');

  /* 安装分支：安装版直接静默安装。 */
  let spawned = null;
  service.spawnImpl = (command, args) => {
    spawned = { command, args };
    return { unref() {} };
  };
  await service.startDownload('1.4.0');
  assert.equal(service.install(), true);
  assert.equal(spawned.command, file);
  assert.deepEqual(spawned.args, ['/S', '--updated']);

  /* 便携版：写延时脚本，退出后再启动新 exe。 */
  process.env.PORTABLE_EXECUTABLE_FILE = path.join(tempRoot, 'Dymail-1.3.3.exe');
  const portableEvents = [];
  const portable = new UpdateService({
    store,
    app,
    send: (channel, event) => portableEvents.push(event),
    fetchImpl: makeFetch(digest),
    spawnImpl: (command, args) => {
      spawned = { command, args };
      return { unref() {} };
    }
  });
  await portable.startDownload('1.4.0');
  portable.install();
  assert.equal(spawned.command, 'cmd.exe');
  const helper = spawned.args[1];
  assert.ok(fs.existsSync(helper), 'portable relaunch helper missing');
  const script = fs.readFileSync(helper, 'utf8');
  assert.ok(script.includes('Dymail-1.4.0.exe'));
  delete process.env.PORTABLE_EXECUTABLE_FILE;

  /* 开发模式拒绝下载。 */
  const devService = new UpdateService({ store, app: { ...app, isPackaged: false }, send: () => {}, fetchImpl: makeFetch(digest) });
  await assert.rejects(() => devService.startDownload('1.4.0'), /开发模式/);

  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.ok(quitCalls >= 1, 'app.quit not called after install');

  console.log('updater check + download + digest + install OK');
})().catch((err) => {
  console.error('FAILED:', err);
  process.exitCode = 1;
});
