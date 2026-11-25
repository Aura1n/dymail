'use strict';

/* GitHub Releases 自动更新：检查、下载、校验、安装。
   下载地址由主进程自己从 API 重新解析，渲染层只传版本号，避免被引导去下载任意文件。
   安装包优先用 GitHub 资产里的 sha256 digest 校验，没有 digest 的老版本才放行。 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const PROGRESS_INTERVAL_MS = 160;
const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000;

function compareVersions(a, b) {
  const left = String(a || '')
    .split('.')
    .map((part) => Number(String(part).replace(/\D/g, '')) || 0);
  const right = String(b || '')
    .split('.')
    .map((part) => Number(String(part).replace(/\D/g, '')) || 0);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const l = left[i] || 0;
    const r = right[i] || 0;
    if (l !== r) return l > r ? 1 : -1;
  }
  return 0;
}

function versionOf(release) {
  return String((release && (release.tag_name || release.name)) || '')
    .replace(/^v/i, '')
    .trim();
}

/* 安装版装 Setup，便携版下非 Setup 的 exe，避免把便携用户悄悄转成安装版。 */
function pickAsset(assets, portable) {
  const list = (Array.isArray(assets) ? assets : []).filter((asset) => /\.exe$/i.test(String(asset.name || '')));
  const setup = list.filter((asset) => /setup/i.test(String(asset.name || '')));
  const plain = list.filter((asset) => !/setup/i.test(String(asset.name || '')));
  return (portable ? plain[0] : setup[0]) || plain[0] || setup[0] || null;
}

class UpdateService {
  constructor({ store, app, send, fetchImpl = globalThis.fetch, spawnImpl = spawn } = {}) {
    this.store = store;
    this.app = app;
    this.send = typeof send === 'function' ? send : () => {};
    this.fetchImpl = fetchImpl;
    this.spawnImpl = spawnImpl;
    this.job = null;
  }

  _repo() {
    const repo = String(this.store.getSettings().updateRepo || '').trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('未配置更新源，请填写 owner/repo');
    return repo;
  }

  async _release() {
    const repo = this._repo();
    let response;
    try {
      response = await this.fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, {
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'Dymail' }
      });
    } catch {
      throw new Error('无法连接更新源，请检查网络');
    }
    if (response.status === 404) throw new Error('该仓库还没有发布版本');
    if (!response.ok) throw new Error(`更新源返回 ${response.status}`);
    const release = await response.json();
    const latest = versionOf(release);
    if (!/^\d+(\.\d+)*/.test(latest)) throw new Error('无法识别最新版本号');
    return { release, latest };
  }

  _progress(event) {
    try {
      this.send('update:progress', event);
    } catch {}
  }

  async check() {
    const { release, latest } = await this._release();
    const current = this.app.getVersion();
    const portable = Boolean(process.env.PORTABLE_EXECUTABLE_FILE);
    const asset = pickAsset(release.assets, portable);
    const installer = pickAsset(release.assets, false);
    const page = String(release.html_url || `https://github.com/${this._repo()}/releases`);
    return {
      current,
      latest,
      hasUpdate: compareVersions(latest, current) > 0,
      notes: String(release.body || '').slice(0, 4000),
      /* 留一个网页地址给“手动下载”，自动安装走 update:download。 */
      url: installer && installer.browser_download_url ? String(installer.browser_download_url) : page,
      page,
      assetName: asset ? String(asset.name || '') : '',
      assetSize: asset ? Number(asset.size) || 0 : 0,
      checkedAt: Date.now()
    };
  }

  async startDownload(version) {
    if (this.job && this.job.status === 'downloading') throw new Error('正在下载更新，请稍候');
    if (!this.app.isPackaged) throw new Error('开发模式不下载安装包，请使用安装版或便携版');
    const { release, latest } = await this._release();
    if (version && String(version) !== latest) throw new Error('更新源版本已变化，请重新检查更新');
    const portable = Boolean(process.env.PORTABLE_EXECUTABLE_FILE);
    const asset = pickAsset(release.assets, portable);
    if (!asset) throw new Error('该版本没有可用的 Windows 安装程序');
    const url = String(asset.browser_download_url || '');
    if (!/^https:\/\//i.test(url)) throw new Error('下载地址无效');

    const dir = path.join(this.app.getPath('temp'), 'dymail-update');
    await fsp.mkdir(dir, { recursive: true });
    const safeName = String(asset.name || `Dymail-${latest}.exe`).replace(/[^\w.-]+/g, '_');
    const filePath = path.join(dir, safeName);
    await fsp.rm(filePath, { force: true });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    this.job = {
      version: latest,
      status: 'downloading',
      filePath,
      assetName: safeName,
      total: Number(asset.size) || 0,
      received: 0,
      controller
    };
    this._progress({ phase: 'downloading', received: 0, total: this.job.total, percent: 0 });

    let response;
    try {
      response = await this.fetchImpl(url, { signal: controller.signal, redirect: 'follow' });
    } catch (err) {
      clearTimeout(timer);
      this.job = null;
      throw new Error(err && err.name === 'AbortError' ? '下载超时，请重试' : '下载失败，请检查网络');
    }
    if (!response.ok || !response.body) {
      clearTimeout(timer);
      this.job = null;
      throw new Error(`下载失败（${response.status}）`);
    }
    const total = Number(response.headers.get('content-length')) || this.job.total || 0;
    this.job.total = total;

    const hash = crypto.createHash('sha256');
    let received = 0;
    let lastEmit = 0;
    const meter = new Transform({
      transform: (chunk, _encoding, callback) => {
        received += chunk.length;
        hash.update(chunk);
        const now = Date.now();
        if (now - lastEmit > PROGRESS_INTERVAL_MS || (total && received >= total)) {
          lastEmit = now;
          const percent = total ? Math.min(100, Math.round((received / total) * 100)) : 0;
          this._progress({ phase: 'downloading', received, total, percent });
        }
        callback(null, chunk);
      }
    });

    try {
      const body = response.body;
      const source = body && typeof body.getReader === 'function' ? Readable.fromWeb(body) : Readable.from(body);
      await pipeline(source, meter, fs.createWriteStream(filePath));
    } catch (err) {
      clearTimeout(timer);
      await fsp.rm(filePath, { force: true }).catch(() => {});
      const cancelled = err && err.name === 'AbortError';
      this.job = null;
      throw new Error(cancelled ? '已取消下载' : '下载中断，请重试');
    }
    clearTimeout(timer);

    const digest = String(asset.digest || '');
    const verified = digest.startsWith('sha256:');
    if (verified && hash.digest('hex') !== digest.slice(7).toLowerCase()) {
      await fsp.rm(filePath, { force: true }).catch(() => {});
      this.job = null;
      throw new Error('安装包校验失败，已删除下载文件，请重试');
    }

    this.job = {
      version: latest,
      status: 'ready',
      filePath,
      assetName: safeName,
      total: received,
      received,
      verified
    };
    this._progress({ phase: 'ready', version: latest, received, total: received, percent: 100, verified });
    return { version: latest, size: received, name: safeName, verified };
  }

  cancel() {
    const job = this.job;
    if (!job || job.status !== 'downloading' || !job.controller) return false;
    job.controller.abort();
    return true;
  }

  install() {
    const job = this.job;
    if (!job || job.status !== 'ready') throw new Error('还没有下载完成的更新');
    if (!this.app.isPackaged) throw new Error('开发模式不执行安装，请使用安装版或便携版');
    if (process.platform !== 'win32') throw new Error('自动安装仅支持 Windows');
    if (!fs.existsSync(job.filePath)) throw new Error('安装包已不存在，请重新下载');

    const portable = Boolean(process.env.PORTABLE_EXECUTABLE_FILE);
    if (portable) {
      /* 便携版不能覆盖正在运行的 exe：写一个延时脚本，等本进程退出后再启动新版本。 */
      const helper = path.join(path.dirname(job.filePath), 'dymail-relaunch.cmd');
      fs.writeFileSync(
        helper,
        `@echo off\r\nping 127.0.0.1 -n 5 > nul\r\nstart "" "${job.filePath}"\r\ndel "%~f0"\r\n`,
        'utf8'
      );
      this.spawnImpl('cmd.exe', ['/c', helper], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else {
      this.spawnImpl(job.filePath, ['/S', '--updated'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    }

    job.status = 'installing';
    this._progress({ phase: 'installing', version: job.version });
    setTimeout(() => this.app.quit(), 300);
    return true;
  }
}

module.exports = { UpdateService, compareVersions, pickAsset, versionOf };
