'use strict';

/* A stand-in for the `electron` module, so the desktop main process (src/main/main.js and the
   mail / store / oauth / scheduler modules behind it) can run unchanged on plain Node —
   which is what nodejs-mobile is. Nothing in src/ is modified.

   - ipcMain.handle()      -> recorded; core/index.js exposes the handlers over a local HTTP bridge
   - BrowserWindow         -> a permissive fake whose webContents.send() becomes a push event
   - safeStorage           -> AES-256-GCM with a master key handed in by the native shell
                              (Android Keystore). With no key it reports "unavailable", and the
                              store then refuses to save credentials, exactly like the desktop
                              behaviour when DPAPI is missing.
   - shell / clipboard     -> forwarded to the native shell as "native" commands
   - dialog                -> no dialogs on a phone: attachments go straight to the downloads dir */

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const bus = new EventEmitter(); // 'event' (channel, payload) and 'native' (command)
const handlers = new Map();
const dirs = {};
const noop = () => undefined;

function getPath(name) {
  if (dirs[name]) return dirs[name];
  const base = dirs.userData || path.join(os.tmpdir(), 'dymail');
  if (name === 'downloads' || name === 'documents') {
    const dir = process.env.DYMAIL_DOWNLOADS || path.join(base, 'downloads');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
  return base;
}

class App extends EventEmitter {
  constructor() {
    super();
    this.isPackaged = true;
  }
  whenReady() { return Promise.resolve(); }
  getVersion() {
    /* The phone app has its own version line (mobile/version.json); the native shell can override it
       with the installed APK's versionName so the update check compares the right number. */
    if (process.env.DYMAIL_APP_VERSION) return process.env.DYMAIL_APP_VERSION;
    try {
      return require('../version.json').version;
    } catch {
      return '0.0.0';
    }
  }
  getPath(name) { return getPath(name); }
  setPath(name, value) { dirs[name] = value; }
  requestSingleInstanceLock() { return true; }
  getLoginItemSettings() { return { openAtLogin: false }; }
  setName() {}
  setAppUserModelId() {}
  setLoginItemSettings() {}
  quit() { bus.emit('native', { type: 'quit' }); }
  exit() { process.exit(0); }
}

const windows = [];

/* Unknown members become no-ops (never thenable), so desktop-only window calls can't throw. */
const lenient = (target) =>
  new Proxy(target, {
    get: (t, key) => (key in t ? t[key] : typeof key === 'symbol' || key === 'then' ? undefined : noop)
  });

function fakeWindow() {
  const win = new EventEmitter();
  win.webContents = lenient(
    Object.assign(new EventEmitter(), {
      send: (channel, payload) => bus.emit('event', channel, payload),
      session: { setPermissionRequestHandler: noop },
      getURL: () => '',
      isDestroyed: () => false
    })
  );
  win.isDestroyed = () => false;
  win.isMinimized = () => false;
  win.isVisible = () => true;
  win.getBounds = () => ({ x: 0, y: 0, width: 0, height: 0 });
  win.loadFile = () => Promise.resolve();
  win.loadURL = () => Promise.resolve();
  /* Anything else the desktop code pokes at (show, focus, setTitleBarOverlay…) is a no-op. */
  return lenient(win);
}

class BrowserWindow {
  constructor() {
    const win = fakeWindow();
    windows.push(win);
    return win;
  }
  static getAllWindows() { return windows; }
}

class Tray {
  constructor() {
    return new Proxy(this, { get: (t, k) => (k in t ? t[k] : typeof k === 'symbol' || k === 'then' ? undefined : noop) });
  }
}

class Notification extends EventEmitter {
  static isSupported() { return false; } // the native shell raises notifications from push events
  show() {}
}

const nativeTheme = Object.assign(new EventEmitter(), { themeSource: 'system', shouldUseDarkColors: false });

function masterKey() {
  const raw = process.env.DYMAIL_MASTER_KEY;
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64');
  return key.length === 32 ? key : null;
}

const safeStorage = {
  isEncryptionAvailable: () => Boolean(masterKey()),
  encryptString(text) {
    const key = masterKey();
    if (!key) throw new Error('系统加密服务不可用');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]);
  },
  decryptString(buffer) {
    const key = masterKey();
    if (!key) throw new Error('系统加密服务不可用');
    const iv = buffer.subarray(0, 12);
    const tag = buffer.subarray(12, 28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString('utf8');
  }
};

const dialog = {
  showErrorBox: (title, content) => console.error(`[dialog] ${title}: ${content}`),
  showMessageBox: async () => ({ response: 0 }),
  showOpenDialog: async () => ({ canceled: false, filePaths: [getPath('downloads')] }),
  showSaveDialog: async (_win, options) => ({ canceled: false, filePath: (options && options.defaultPath) || path.join(getPath('downloads'), 'attachment') })
};

module.exports = {
  app: new App(),
  BrowserWindow,
  Tray,
  Notification,
  Menu: { buildFromTemplate: () => ({}), setApplicationMenu: noop },
  ipcMain: {
    handle: (channel, fn) => handlers.set(channel, fn),
    removeHandler: (channel) => handlers.delete(channel),
    on: noop
  },
  dialog,
  shell: {
    openExternal: async (url) => { bus.emit('native', { type: 'open', url: String(url) }); },
    showItemInFolder: (file) => bus.emit('native', { type: 'reveal', path: String(file) })
  },
  clipboard: { writeText: (text) => bus.emit('native', { type: 'copy', text: String(text) }) },
  screen: { getAllDisplays: () => [] },
  protocol: { registerSchemesAsPrivileged: noop, handle: noop },
  nativeTheme,
  safeStorage,
  session: {},
  nativeImage: {},
  __internals: { bus, handlers }
};
