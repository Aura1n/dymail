'use strict';

/* Update check for the Android build.
 *
 * The desktop updater (src/main/updater.js) looks for a Windows .exe in the latest GitHub release,
 * installs it by spawning the installer, and compares against the desktop version. None of that
 * applies on a phone, so this is a separate, much smaller check:
 *   - it scans the recent releases for the newest one that ships an .apk,
 *   - compares that version with the installed APK version,
 *   - and hands back a download link. The download itself happens in the system browser; Android
 *     then asks the user to confirm the install. Nothing here downloads or installs anything.
 * `fetchImpl` is injectable so the logic can be tested without a network. */

const API = 'https://api.github.com';

function versionOf(tag) {
  const match = String(tag || '').match(/(\d+(?:\.\d+)*)/);
  return match ? match[1] : '';
}

function compareVersions(a, b) {
  const left = String(a || '').split('.').map((part) => Number(part.replace(/\D/g, '')) || 0);
  const right = String(b || '').split('.').map((part) => Number(part.replace(/\D/g, '')) || 0);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const l = left[i] || 0;
    const r = right[i] || 0;
    if (l !== r) return l > r ? 1 : -1;
  }
  return 0;
}

/* A release may carry several APKs (debug build, per-ABI splits); prefer a universal/arm64 release build. */
function pickApk(assets) {
  const apks = (Array.isArray(assets) ? assets : []).filter((asset) => /\.apk$/i.test(String(asset && asset.name)));
  const score = (asset) => {
    const name = String(asset.name);
    return (/debug/i.test(name) ? -2 : 0) + (/universal|arm64/i.test(name) ? 1 : 0);
  };
  apks.sort((x, y) => score(y) - score(x));
  return apks[0] || null;
}

async function checkUpdate({ repo, current, fetchImpl = globalThis.fetch, timeoutMs = 12000 }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(String(repo || ''))) throw new Error('未配置更新源，请填写 owner/repo');
  let response;
  try {
    response = await fetchImpl(`${API}/repos/${repo}/releases?per_page=20`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'Dymail-Mobile' },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch {
    throw new Error('无法连接更新源，请检查网络');
  }
  if (response.status === 404) throw new Error('该仓库不存在或还没有发布版本');
  if (response.status === 403 || response.status === 429) throw new Error('更新源请求过于频繁，请稍后再试');
  if (!response.ok) throw new Error(`更新源返回 ${response.status}`);
  const releases = await response.json();
  if (!Array.isArray(releases)) throw new Error('更新源返回了无法识别的内容');

  let best = null;
  for (const release of releases) {
    if (!release || release.draft) continue;
    /* 手机版对自己的发布用 android-* 标签，并按“预发布”发布：桌面版的发布页要留给 Windows，
       普通发布一旦排在最前，装了 1.4.x 的桌面用户就会在检查更新时拿到没有 exe 的版本。
       所以 android-* 的预发布照收，其他预发布跳过。 */
    const androidChannel = /^android-/i.test(String(release.tag_name || ''));
    if (release.prerelease && !androidChannel) continue;
    const apk = pickApk(release.assets);
    const version = versionOf(release.tag_name || release.name);
    if (!apk || !version) continue;
    if (!best || compareVersions(version, best.version) > 0) best = { release, apk, version };
  }

  const prefix = `https://github.com/${repo}/`;
  const page = `${prefix}releases`;
  const onlyGithub = (url, fallback) => (typeof url === 'string' && url.startsWith(prefix) ? url : fallback);

  if (!best) {
    return {
      current,
      latest: current,
      hasUpdate: false,
      notes: '',
      url: page,
      page,
      assetName: '',
      assetSize: 0,
      sha256: '',
      note: '发布页还没有 Android 安装包（.apk）',
      checkedAt: Date.now()
    };
  }

  const releasePage = onlyGithub(best.release.html_url, page);
  const digest = /^sha256:([0-9a-f]{64})$/i.exec(String(best.apk.digest || ''));
  return {
    current,
    latest: best.version,
    hasUpdate: compareVersions(best.version, current) > 0,
    notes: String(best.release.body || '').slice(0, 4000),
    url: onlyGithub(best.apk.browser_download_url, releasePage),
    page: releasePage,
    assetName: String(best.apk.name || ''),
    assetSize: Number(best.apk.size) || 0,
    sha256: digest ? digest[1].toLowerCase() : '',
    checkedAt: Date.now()
  };
}

module.exports = { checkUpdate, compareVersions, versionOf, pickApk };
