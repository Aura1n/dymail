'use strict';

/* Checks the Android update logic against canned GitHub responses (no network needed).
 *   node mobile/scripts/test-update.js */

const assert = require('node:assert/strict');
const { checkUpdate, compareVersions, versionOf, pickApk } = require('../core/update');

let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL ${name} — ${err.message}`);
  }
}

const reply = (status, body) => async () => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const REPO = 'acme/dymail';
const dl = (name) => `https://github.com/${REPO}/releases/download/x/${name}`;
const release = (tag, assets, extra = {}) => ({
  tag_name: tag,
  html_url: `https://github.com/${REPO}/releases/tag/${tag}`,
  body: `notes ${tag}`,
  draft: false,
  prerelease: false,
  assets,
  ...extra
});
const apk = (name, extra = {}) => ({ name, size: 1234, browser_download_url: dl(name), ...extra });

(async () => {
  await test('version parsing and ordering', () => {
    assert.equal(versionOf('android-v0.2.10'), '0.2.10');
    assert.equal(versionOf('nothing'), '');
    assert.equal(compareVersions('0.2.10', '0.2.9'), 1);
    assert.equal(compareVersions('1.0', '1.0.0'), 0);
    assert.equal(compareVersions('0.1.0', '0.2.0'), -1);
  });

  await test('prefers a release apk over debug', () => {
    assert.equal(pickApk([apk('app-debug.apk'), apk('app-release.apk')]).name, 'app-release.apk');
    assert.equal(pickApk([{ name: 'Dymail-Setup.exe' }]), null);
  });

  await test('finds the newest release that has an apk, ignoring desktop-only ones', async () => {
    const list = [
      release('v1.4.2', [{ name: 'Dymail-Setup-1.4.2.exe', browser_download_url: dl('x.exe') }]),
      release('android-v0.3.0', [apk('dymail-0.3.0.apk', { digest: `sha256:${'a'.repeat(64)}` })]),
      release('android-v0.2.0', [apk('dymail-0.2.0.apk')])
    ];
    const r = await checkUpdate({ repo: REPO, current: '0.2.0', fetchImpl: reply(200, list) });
    assert.equal(r.hasUpdate, true);
    assert.equal(r.latest, '0.3.0');
    assert.equal(r.assetName, 'dymail-0.3.0.apk');
    assert.equal(r.sha256, 'a'.repeat(64));
    assert.equal(r.url, dl('dymail-0.3.0.apk'));
    assert.equal(r.notes, 'notes android-v0.3.0');
  });

  await test('says up to date when the installed version is the newest', async () => {
    const r = await checkUpdate({ repo: REPO, current: '0.3.0', fetchImpl: reply(200, [release('v0.3.0', [apk('a.apk')])]) });
    assert.equal(r.hasUpdate, false);
    assert.equal(r.latest, '0.3.0');
  });

  await test('skips drafts and prereleases', async () => {
    const list = [release('v9.0.0', [apk('a.apk')], { draft: true }), release('v8.0.0', [apk('b.apk')], { prerelease: true })];
    const r = await checkUpdate({ repo: REPO, current: '0.1.0', fetchImpl: reply(200, list) });
    assert.equal(r.hasUpdate, false);
    assert.match(r.note, /apk/);
  });

  await test('picks up android-* prereleases (the phone channel) but not other prereleases', async () => {
    const list = [
      release('android-v0.4.5', [apk('Dymail-Android-0.4.5.apk')], { prerelease: true }),
      release('v9.0.0', [apk('other.apk')], { prerelease: true }),
      release('android-v0.4.0', [apk('Dymail-Android-0.4.0.apk')], { prerelease: true })
    ];
    const r = await checkUpdate({ repo: REPO, current: '0.4.0', fetchImpl: reply(200, list) });
    assert.equal(r.latest, '0.4.5');
    assert.equal(r.assetName, 'Dymail-Android-0.4.5.apk');
    assert.equal(r.hasUpdate, true);
  });

  await test('reports a clear note when no release ships an apk', async () => {
    const r = await checkUpdate({ repo: REPO, current: '0.1.0', fetchImpl: reply(200, [release('v1.4.1', [{ name: 'x.exe' }])]) });
    assert.equal(r.hasUpdate, false);
    assert.equal(r.url, `https://github.com/${REPO}/releases`);
    assert.ok(r.note);
  });

  await test('refuses download links that are not on the configured repo', async () => {
    const evil = apk('a.apk', { browser_download_url: 'https://evil.example/a.apk' });
    const r = await checkUpdate({ repo: REPO, current: '0.1.0', fetchImpl: reply(200, [release('v1.0.0', [evil])]) });
    assert.equal(r.hasUpdate, true);
    assert.ok(r.url.startsWith(`https://github.com/${REPO}/`), r.url);
  });

  await test('maps HTTP and network failures to readable errors', async () => {
    await assert.rejects(checkUpdate({ repo: REPO, current: '1', fetchImpl: reply(404, {}) }), /不存在|发布/);
    await assert.rejects(checkUpdate({ repo: REPO, current: '1', fetchImpl: reply(403, {}) }), /频繁/);
    await assert.rejects(checkUpdate({ repo: REPO, current: '1', fetchImpl: reply(500, {}) }), /500/);
    await assert.rejects(checkUpdate({ repo: REPO, current: '1', fetchImpl: async () => { throw new Error('offline'); } }), /无法连接/);
    await assert.rejects(checkUpdate({ repo: 'not a repo', current: '1', fetchImpl: reply(200, []) }), /更新源/);
  });

  console.log(failed ? `\n${failed} test(s) failed` : '\nall update tests passed');
  process.exit(failed ? 1 : 0);
})();
