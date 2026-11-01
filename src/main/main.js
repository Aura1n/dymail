'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  dialog,
  shell,
  screen,
  protocol,
  nativeTheme,
  Tray,
  Notification
} = require('electron');
const { Store } = require('./store');
const { MailService } = require('./mail');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'mailview',
    privileges: { standard: true, secure: true, supportFetchAPI: false, corsEnabled: false }
  }
]);

app.setName('Dymail');
app.setAppUserModelId('com.dymail.client');
if (process.env.DYMALL_USERDATA) {
  app.setPath('userData', path.resolve(process.env.DYMALL_USERDATA));
}

const isDev = process.argv.includes('--dev');
const isTest = Boolean(process.env.DYMALL_SHOT || process.env.DYMALL_USERDATA || process.env.DYMALL_DEMO);
const wantDemo = process.env.DYMALL_DEMO === '1';
let mainWindow = null;
let store = null;
let mail = null;
let tray = null;
let isQuitting = false;
const trayIconPath = path.join(__dirname, '../../assets/tray.png');

const MAX_MAIL_DOCUMENTS = 16;
const MAX_MAIL_DOCUMENT_BYTES = 40 * 1024 * 1024;
const mailDocuments = new Map();

function rememberDocument(document) {
  if (typeof document !== 'string' || !document) throw new Error('邮件内容无效');
  if (Buffer.byteLength(document, 'utf8') > MAX_MAIL_DOCUMENT_BYTES) throw new Error('邮件内容过大');
  const id = crypto.randomUUID();
  mailDocuments.set(id, document);
  while (mailDocuments.size > MAX_MAIL_DOCUMENTS) {
    mailDocuments.delete(mailDocuments.keys().next().value);
  }
  return id;
}

function mailDocumentResponse(request) {
  let id = '';
  try {
    id = new URL(request.url).pathname.replace(/^\//, '');
  } catch {}
  const document = /^[0-9a-f-]{36}$/i.test(id) ? mailDocuments.get(id) : null;
  if (!document) return new Response('Not Found', { status: 404 });
  return new Response(document, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    }
  });
}

if (!isTest && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(boot).catch((err) => {
    dialog.showErrorBox('Dymail', String(err && err.message ? err.message : err));
    app.quit();
  });
}

function buildMenu() {
  if (process.platform === 'darwin') {
    const template = [
      { role: 'appMenu' },
      { role: 'editMenu' },
      { role: 'windowMenu' }
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  } else {
    Menu.setApplicationMenu(null);
  }
}

function screenBounds() {
  const saved = store.getWindowBounds();
  if (!saved) return {};
  const width = Number(saved.width);
  const height = Number(saved.height);
  const x = Number(saved.x);
  const y = Number(saved.y);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return {};
  if (width < 900 || height < 600) return {};
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { width: Math.min(width, 1650), height: Math.min(height, 1100) };
  }
  const visible = screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    return x < area.x + area.width - 120 && x + width > area.x + 120 && y < area.y + area.height - 80 && y + height > area.y + 40;
  });
  if (!visible) return { width: Math.min(width, 1650), height: Math.min(height, 1100) };
  return { x, y, width: Math.min(width, 1650), height: Math.min(height, 1100) };
}

const TITLEBAR_HEIGHT = 52;

function syncThemeSource() {
  const theme = store && ['light', 'dark'].includes(store.getSettings().theme) ? store.getSettings().theme : 'system';
  nativeTheme.themeSource = theme;
}

function titleBarChrome() {
  const dark = nativeTheme.shouldUseDarkColors;
  return dark
    ? { color: '#1d1d20', symbolColor: '#f2f2f7', background: '#1d1d20' }
    : { color: '#f5f5f7', symbolColor: '#3c3c43', background: '#f7f7f9' };
}

function applyTitleBarChrome(win) {
  if (!win || win.isDestroyed() || process.platform === 'darwin') return false;
  const chrome = titleBarChrome();
  try {
    win.setTitleBarOverlay({
      color: chrome.color,
      symbolColor: chrome.symbolColor,
      height: TITLEBAR_HEIGHT
    });
    return true;
  } catch {
    return false;
  }
}

function compareVersions(a, b) {
  const left = String(a).split('.').map((part) => parseInt(part, 10) || 0);
  const right = String(b).split('.').map((part) => parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const x = left[i] || 0;
    const y = right[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function destroyTray() {
  if (!tray) return;
  tray.destroy();
  tray = null;
}

function syncTray() {
  if (!store || store.getSettings().closeToTray === false || process.platform === 'darwin') {
    destroyTray();
    return;
  }
  if (tray || !fs.existsSync(trayIconPath)) return;
  tray = new Tray(trayIconPath);
  tray.setToolTip('Dymail');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开 Dymail', click: () => showMainWindow() },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ])
  );
  tray.on('click', () => showMainWindow());
}

function createWindow() {
  const iconPath = path.join(__dirname, '../../assets/icon.png');
  const bounds = screenBounds();
  const chrome = titleBarChrome();
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 640,
    ...bounds,
    show: false,
    backgroundColor: chrome.background,
    title: 'Dymail',
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' }
      : {
          titleBarStyle: 'hidden',
          titleBarOverlay: {
            color: chrome.color,
            symbolColor: chrome.symbolColor,
            height: TITLEBAR_HEIGHT
          }
        }),
    ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?:|mailto:)/i.test(url)) {
      shell.openExternal(url).catch(() => {});
    }
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) {
      event.preventDefault();
      if (/^(https?:|mailto:)/i.test(url)) shell.openExternal(url).catch(() => {});
    }
  });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

  win.once('ready-to-show', () => {
    win.show();
    applyTitleBarChrome(win);
    if (isDev) win.webContents.openDevTools({ mode: 'detach' });
  });
  win.on('close', (event) => {
    try {
      const current = win.getNormalBounds();
      store.setWindowBounds(current);
    } catch {}
    if (!isQuitting && tray && store.getSettings().closeToTray !== false) {
      event.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => {
    mainWindow = null;
  });

  const file = path.join(__dirname, '../renderer/index.html');
  const loadOptions = wantDemo ? { query: { demo: '1' } } : undefined;
  win.loadFile(file, loadOptions);

  if (process.env.DYMALL_SHOT) {
    const outFile = path.resolve(process.env.DYMALL_SHOT);
    win.webContents.once('did-finish-load', async () => {
      try {
        await new Promise((resolve) => setTimeout(resolve, Number(process.env.DYMALL_SHOT_BOOT) || 1400));
        if (process.env.DYMALL_SHOT_SCRIPT) {
          const result = await win.webContents.executeJavaScript(process.env.DYMALL_SHOT_SCRIPT, true);
          if (process.env.DYMALL_SHOT_DUMP) {
            await fsp.writeFile(
              path.resolve(process.env.DYMALL_SHOT_DUMP),
              typeof result === 'string' ? result : JSON.stringify(result, null, 2)
            );
          }
        }
        await new Promise((resolve) => setTimeout(resolve, Number(process.env.DYMALL_SHOT_DELAY) || 700));
        const image = await win.webContents.capturePage();
        await fsp.mkdir(path.dirname(outFile), { recursive: true });
        await fsp.writeFile(outFile, image.toPNG());
        if (process.env.DYMALL_SHOT_CLOSE) {
          const report = [];
          for (let round = 0; round < 2; round++) {
            win.close();
            await new Promise((resolve) => setTimeout(resolve, 400));
            report.push(`tray=${Boolean(tray)} visible=${win.isVisible()} destroyed=${win.isDestroyed()}`);
            if (win.isDestroyed()) break;
            if (!win.isVisible()) showMainWindow();
            await new Promise((resolve) => setTimeout(resolve, 300));
          }
          if (process.env.DYMALL_SHOT_DUMP) {
            await fsp.appendFile(path.resolve(process.env.DYMALL_SHOT_DUMP), `\ncloseRounds=[${report.join(' | ')}]`);
          }
        }
      } catch (err) {
        console.error('screenshot failed', err);
      } finally {
        app.quit();
      }
    });
  }

  return win;
}

function ok(data) {
  return { ok: true, data };
}

function fail(err) {
  const message = err && err.message ? String(err.message) : '操作失败';
  return { ok: false, error: message.slice(0, 400) };
}

function handle(channel, handler) {
  ipcMain.handle(channel, async (event, payload) => {
    try {
      return ok(await handler(payload || {}, event));
    } catch (err) {
      console.error(`[ipc:${channel}]`, err && err.message ? err.message : err);
      return fail(err);
    }
  });
}

function text(value, max) {
  if (typeof value !== 'string') throw new Error('参数无效');
  if (max && value.length > max) throw new Error('参数过长');
  return value;
}

function serverConfig(input, label) {
  if (!input || typeof input !== 'object') throw new Error(`${label} 设置无效`);
  const host = String(input.host || '').trim();
  if (!host || /\s/.test(host) || host.length > 255) throw new Error(`${label} 服务器地址无效`);
  const port = Number(input.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${label} 端口无效`);
  return { host, port, secure: input.secure !== false };
}

function uids(value) {
  if (!Array.isArray(value) || !value.length || value.length > 500) throw new Error('邮件参数无效');
  const result = value.map(Number).filter((uid) => Number.isInteger(uid) && uid > 0);
  if (!result.length) throw new Error('邮件参数无效');
  return result;
}

function registerIpc() {
  handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    packaged: app.isPackaged
  }));

  handle('app:open', (payload) => {
    const url = String(payload.url || '');
    if (!/^https?:\/\//i.test(url)) throw new Error('只允许打开 http(s) 链接');
    shell.openExternal(url);
    return true;
  });

  handle('app:notify', (payload) => {
    if (!Notification.isSupported()) return false;
    const notification = new Notification({
      title: text(payload.title, 160) || 'Dymail',
      body: text(payload.body, 800),
      icon: fs.existsSync(trayIconPath) ? trayIconPath : undefined
    });
    notification.on('click', () => showMainWindow());
    notification.show();
    return true;
  });

  handle('update:check', async () => {
    const repo = String(store.getSettings().updateRepo || '').trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('未配置更新源，请填写 owner/repo');
    const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'Dymail' }
    });
    if (response.status === 404) throw new Error('该仓库还没有发布版本');
    if (!response.ok) throw new Error(`更新源返回 ${response.status}`);
    const release = await response.json();
    const latest = String(release.tag_name || release.name || '').replace(/^v/i, '').trim();
    if (!/^\d+(\.\d+)*/.test(latest)) throw new Error('无法识别最新版本号');
    const current = app.getVersion();
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const exeAssets = assets.filter((asset) => /\.exe$/i.test(String(asset.name || '')));
    const installer = exeAssets.find((asset) => /setup/i.test(String(asset.name || ''))) || exeAssets[0];
    const page = String(release.html_url || `https://github.com/${repo}/releases`);
    return {
      current,
      latest,
      hasUpdate: compareVersions(latest, current) > 0,
      notes: String(release.body || '').slice(0, 4000),
      url: installer && installer.browser_download_url ? String(installer.browser_download_url) : page,
      page,
      checkedAt: Date.now()
    };
  });

  handle('accounts:list', () => store.listAccounts());

  handle('accounts:save', async (payload) => {
    const email = text(payload.email, 320).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('邮箱地址格式不正确');
    const id = payload.id ? text(payload.id, 100) : '';
    const existing = id ? store.getAccount(id) : null;
    if (id && !existing) throw new Error('账户不存在');
    const duplicate = store
      .listAccounts()
      .find((account) => account.email.toLowerCase() === email.toLowerCase() && account.id !== id);
    if (duplicate) throw new Error('该邮箱已添加');
    const imap = serverConfig(payload.imap, 'IMAP');
    const smtp = serverConfig(payload.smtp, 'SMTP');
    const name = payload.name == null ? '' : text(payload.name, 120);
    let password = null;
    if (typeof payload.password === 'string' && payload.password.length) {
      if (payload.password.length > 1024) throw new Error('密码过长');
      password = payload.password;
    } else if (existing) {
      try {
        password = store.getPassword(existing.id);
      } catch {
        throw new Error('无法读取已保存的密码，请重新输入');
      }
    }
    if (!password) throw new Error('请输入密码或授权码');
    await mail.testConnection({ email, imap, smtp }, password);
    const saved = store.saveAccount(
      { id: id || undefined, email, name, imap, smtp },
      typeof payload.password === 'string' && payload.password.length ? password : null
    );
    mail.reset(saved.id);
    return saved;
  });

  handle('accounts:remove', async (payload) => {
    const id = text(payload.id, 100);
    const account = store.getAccount(id);
    if (!account) return false;
    mail.reset(id);
    store.removeAccount(id);
    await store.removeAccountDrafts(id);
    return true;
  });

  handle('folders:sync', () => mail.sync());

  handle('mail:list', (payload) => {
    const accountId = text(payload.accountId, 100);
    const mailboxPath = text(payload.path, 1024);
    return mail.list({
      accountId,
      path: mailboxPath,
      cursor: payload.cursor,
      limit: payload.limit
    });
  });

  handle('mail:document', (payload) => {
    const document = text(payload.document, MAX_MAIL_DOCUMENT_BYTES / 2);
    return `mailview://doc/${rememberDocument(document)}`;
  });

  handle('mail:list-unified', (payload) => {
    const cursors = payload.cursors && typeof payload.cursors === 'object' ? payload.cursors : null;
    return mail.listUnified({ cursors, limit: payload.limit });
  });

  handle('mail:search', (payload) => {
    const accountId = payload.accountId ? text(payload.accountId, 100) : null;
    const mailboxPath = payload.path ? text(payload.path, 1024) : null;
    return mail.search({
      accountId,
      path: mailboxPath,
      query: text(payload.query, 200)
    });
  });

  handle('mail:read', (payload) =>
    mail.read({
      accountId: text(payload.accountId, 100),
      path: text(payload.path, 1024),
      uid: payload.uid
    })
  );

  handle('mail:set-flags', (payload) =>
    mail.setFlags({
      accountId: text(payload.accountId, 100),
      path: text(payload.path, 1024),
      uids: uids(payload.uids),
      add: Array.isArray(payload.add) ? payload.add : [],
      remove: Array.isArray(payload.remove) ? payload.remove : []
    })
  );

  handle('mail:mark-all-read', (payload) =>
    mail.markAllRead({
      accountId: text(payload.accountId, 100),
      path: text(payload.path, 1024)
    })
  );

  handle('mail:move', (payload) =>
    mail.move({
      accountId: text(payload.accountId, 100),
      path: text(payload.path, 1024),
      uid: payload.uid,
      target: payload.target
    })
  );

  handle('mail:delete-permanent', (payload) =>
    mail.deletePermanent({
      accountId: text(payload.accountId, 100),
      path: text(payload.path, 1024),
      uid: payload.uid
    })
  );

  handle('mail:save-attachment', (payload) =>
    mail.saveAttachment({
      accountId: text(payload.accountId, 100),
      path: text(payload.path, 1024),
      uid: payload.uid,
      index: payload.index,
      name: typeof payload.name === 'string' ? payload.name.slice(0, 255) : '',
      window: mainWindow
    })
  );

  handle('compose:send', (payload) => {
    const accountId = text(payload.accountId, 100);
    return mail.send({
      accountId,
      to: typeof payload.to === 'string' ? payload.to : '',
      cc: typeof payload.cc === 'string' ? payload.cc : '',
      bcc: typeof payload.bcc === 'string' ? payload.bcc : '',
      subject: typeof payload.subject === 'string' ? payload.subject : '',
      html: typeof payload.html === 'string' ? payload.html : '',
      text: typeof payload.text === 'string' ? payload.text : '',
      inReplyTo: typeof payload.inReplyTo === 'string' ? payload.inReplyTo : '',
      references: typeof payload.references === 'string' ? payload.references : '',
      attachments: Array.isArray(payload.attachments) ? payload.attachments.slice(0, 20) : []
    });
  });

  handle('drafts:list', (payload) => {
    const accountId = payload.accountId ? text(payload.accountId, 100) : '';
    return store.listDrafts(accountId);
  });

  handle('drafts:get', async (payload) => {
    const draft = await store.getDraft(text(payload.id, 100));
    if (!draft) throw new Error('草稿不存在');
    return draft;
  });

  handle('drafts:save', (payload) => {
    if (!payload || typeof payload !== 'object') throw new Error('草稿内容无效');
    return store.saveDraft(payload);
  });

  handle('drafts:remove', (payload) => store.deleteDraft(text(payload.id, 100)));

  handle('settings:get', () => store.getSettings());

  handle('settings:update', (payload) => {
    const settings = store.updateSettings(payload || {});
    syncThemeSource();
    applyTitleBarChrome(mainWindow);
    syncTray();
    return settings;
  });

  handle('files:pick', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections']
    });
    if (result.canceled) return [];
    const files = [];
    for (const file of result.filePaths.slice(0, 20)) {
      try {
        const stat = await fsp.stat(file);
        if (stat.isFile()) {
          files.push({ path: file, name: path.basename(file), size: stat.size });
        }
      } catch {}
    }
    return files;
  });

  handle('dialog:confirm', async (payload) => {
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: String(payload.title || 'Dymail').slice(0, 200),
      message: String(payload.message || '').slice(0, 500),
      detail: payload.detail ? String(payload.detail).slice(0, 1000) : undefined,
      buttons: [String(payload.confirmLabel || '确定').slice(0, 40), String(payload.cancelLabel || '取消').slice(0, 40)],
      defaultId: payload.danger ? 1 : 0,
      cancelId: 1,
      noLink: true
    });
    return result.response === 0;
  });

  handle('window:set-chrome', (payload) => {
    if (process.platform !== 'win32' || !mainWindow || mainWindow.isDestroyed()) return false;
    const color = String(payload.color || '');
    const symbolColor = String(payload.symbolColor || '');
    if (!/^#[0-9a-f]{6}$/i.test(color) || !/^#[0-9a-f]{6}$/i.test(symbolColor)) {
      throw new Error('颜色无效');
    }
    try {
      mainWindow.setTitleBarOverlay({ color, symbolColor, height: TITLEBAR_HEIGHT });
      return true;
    } catch {
      return false;
    }
  });
}

async function boot() {
  protocol.handle('mailview', mailDocumentResponse);
  store = new Store();
  mail = new MailService(store);
  buildMenu();
  registerIpc();
  syncThemeSource();
  nativeTheme.on('updated', () => applyTitleBarChrome(mainWindow));
  mainWindow = createWindow();
  syncTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });
}

app.on('before-quit', () => {
  isQuitting = true;
  destroyTray();
  if (mail) mail.disconnectAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
