'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { app, safeStorage } = require('electron');
const { normalizeRule } = require('./filters');

const COLORS = ['#0a84ff', '#34a853', '#ff9f0a', '#e5484d', '#8e5cf7', '#00a3a3', '#d6409f', '#6b7280'];
const DEFAULT_UPDATE_REPO = 'Aura1n/dymail';

const TRASH_PURGE_STEPS = [0, 15, 30, 60, 90];

const DEFAULT_SETTINGS = {
  theme: 'system',
  refreshSeconds: 60,
  signature: '',
  remoteImages: 'allow',
  notifyNewMail: true,
  closeToTray: true,
  updateCheck: true,
  updateRepo: DEFAULT_UPDATE_REPO,
  updateSkipped: '',
  updateLastCheck: 0,
  deeplKey: '',
  trashPurgeDays: 30,
  trashPurgeAt: 0
};

function sanitizeFileName(name) {
  return String(name || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\.+$/, '')
    .trim()
    .slice(0, 120);
}

function isInside(dir, file) {
  const rel = path.relative(path.resolve(dir), path.resolve(file));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function cleanServer(server, label) {
  const host = String(server && server.host ? server.host : '').trim();
  if (!host || /\s/.test(host) || host.length > 255) {
    throw new Error(`${label} 服务器地址无效`);
  }
  const port = Number(server && server.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${label} 端口无效`);
  }
  return { host, port, secure: server.secure !== false };
}

function cleanText(value, max) {
  return String(value == null ? '' : value).slice(0, max);
}

function cleanSendAt(value) {
  const text = cleanText(value, 40).trim();
  if (!text) return '';
  const at = Date.parse(text);
  if (!Number.isFinite(at)) throw new Error('定时发送时间无效');
  return new Date(at).toISOString();
}

function cleanEmail(value) {
  const email = cleanText(value, 320).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('邮箱地址格式不正确');
  return email;
}

class Store {
  constructor() {
    this.dir = app.getPath('userData');
    this.file = path.join(this.dir, 'dymail.json');
    this.contactsFile = path.join(this.dir, 'contacts.json');
    this.draftsDir = path.join(this.dir, 'drafts');
    fs.mkdirSync(this.draftsDir, { recursive: true });
    this.data = this._load();
  }

  _load() {
    const empty = {
      version: 1,
      accounts: [],
      settings: { ...DEFAULT_SETTINGS },
      drafts: [],
      rules: [],
      blacklist: [],
      filterApplied: {},
      ui: {}
    };
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      return {
        version: 1,
        accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
        settings: {
          ...DEFAULT_SETTINGS,
          ...(parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {})
        },
        drafts: Array.isArray(parsed.drafts) ? parsed.drafts : [],
        rules: Array.isArray(parsed.rules) ? parsed.rules : [],
        blacklist: Array.isArray(parsed.blacklist) ? parsed.blacklist : [],
        filterApplied:
          parsed.filterApplied && typeof parsed.filterApplied === 'object' ? parsed.filterApplied : {},
        ui: parsed.ui && typeof parsed.ui === 'object' ? parsed.ui : {}
      };
    } catch (err) {
      if (err && err.code !== 'ENOENT') {
        try {
          fs.renameSync(this.file, `${this.file}.corrupt-${Date.now()}`);
        } catch {}
      }
      return empty;
    }
  }

  _persist() {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }

  _encrypt(text) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('系统加密服务不可用，无法安全保存密码');
    }
    return safeStorage.encryptString(String(text)).toString('base64');
  }

  _decrypt(encoded) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('系统加密服务不可用');
    }
    return safeStorage.decryptString(Buffer.from(encoded, 'base64'));
  }

  getSettings() {
    const { deeplKey, ...rest } = this.data.settings;
    return { ...rest, hasDeeplKey: Boolean(deeplKey) };
  }

  /* The translation key is a credential, so it is stored like the account
     passwords and never handed to the renderer. */
  setDeeplKey(key) {
    const value = String(key == null ? '' : key).trim().slice(0, 200);
    const next = { ...this.data.settings };
    if (!value) {
      next.deeplKey = '';
    } else {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('系统加密服务不可用，无法保存密钥');
      next.deeplKey = this._encrypt(value);
    }
    this.data.settings = next;
    this._persist();
    return { hasDeeplKey: Boolean(next.deeplKey) };
  }

  getDeeplKey() {
    const encoded = this.data.settings && this.data.settings.deeplKey;
    if (!encoded) return '';
    try {
      return this._decrypt(encoded);
    } catch {
      return '';
    }
  }

  updateSettings(patch) {
    const next = { ...this.data.settings };
    if (patch && ['system', 'light', 'dark'].includes(patch.theme)) next.theme = patch.theme;
    const seconds = Number(patch && patch.refreshSeconds);
    if ([0, 30, 60, 120, 300].includes(seconds)) next.refreshSeconds = seconds;
    if (patch && typeof patch.signature === 'string') next.signature = patch.signature.slice(0, 20000);
    if (patch && ['allow', 'block'].includes(patch.remoteImages)) next.remoteImages = patch.remoteImages;
    for (const flag of ['notifyNewMail', 'closeToTray', 'updateCheck']) {
      if (patch && typeof patch[flag] === 'boolean') next[flag] = patch[flag];
    }
    if (patch && typeof patch.updateSkipped === 'string') next.updateSkipped = patch.updateSkipped.trim().slice(0, 40);
    if (patch && Number.isFinite(Number(patch.updateLastCheck))) {
      next.updateLastCheck = Math.max(0, Math.floor(Number(patch.updateLastCheck)));
    }
    if (patch && typeof patch.updateRepo === 'string') {
      const repo = patch.updateRepo.trim().slice(0, 120);
      if (repo && !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('仓库格式应为 owner/repo');
      next.updateRepo = repo;
    }
    if (patch && TRASH_PURGE_STEPS.includes(Number(patch.trashPurgeDays))) {
      next.trashPurgeDays = Number(patch.trashPurgeDays);
    }
    this.data.settings = next;
    this._persist();
    return this.getSettings();
  }

  /* When the trash was last emptied, so the automatic purge runs at most once a
     day however often the app is opened or synced. */
  markTrashPurged(at) {
    const next = { ...this.data.settings };
    next.trashPurgeAt = Math.max(0, Math.floor(Number(at) || 0));
    this.data.settings = next;
    this._persist();
    return next.trashPurgeAt;
  }

  getWindowBounds() {
    return this.data.ui && this.data.ui.bounds ? this.data.ui.bounds : null;
  }

  setWindowBounds(bounds) {
    this.data.ui = { ...(this.data.ui || {}), bounds };
    this._persist();
  }

  _publicAccount(account) {
    const oauth = account.authType === 'oauth2' ? account.oauth || {} : null;
    return {
      id: account.id,
      email: account.email,
      name: account.name || '',
      color: account.color,
      imap: { ...account.imap },
      smtp: { ...account.smtp },
      authType: account.authType === 'oauth2' ? 'oauth2' : 'password',
      oauthProvider: oauth ? oauth.provider || '' : '',
      oauthEmail: oauth ? oauth.email || '' : '',
      oauthExpiresAt: oauth ? Number(oauth.expiresAt) || 0 : 0,
      hasOAuth: Boolean(oauth && oauth.refreshEnc),
      hasPassword: Boolean(account.passEnc),
      createdAt: account.createdAt
    };
  }

  listAccounts() {
    return this.data.accounts.map((account) => this._publicAccount(account));
  }

  getAccount(id) {
    const account = this.data.accounts.find((item) => item.id === id);
    if (!account) return null;
    return {
      ...this._publicAccount(account),
      passEnc: account.passEnc
    };
  }

  getPassword(id) {
    const account = this.data.accounts.find((item) => item.id === id);
    if (!account || !account.passEnc) return null;
    return this._decrypt(account.passEnc);
  }

  /* 授权令牌与密码同级别对待：只以加密形式落盘，读取时按需解密。 */
  getOAuthRecord(id) {
    const account = this.data.accounts.find((item) => item.id === id);
    if (!account || account.authType !== 'oauth2' || !account.oauth) return null;
    const read = (encoded) => {
      if (!encoded) return '';
      try {
        return this._decrypt(encoded);
      } catch {
        return '';
      }
    };
    return {
      provider: String(account.oauth.provider || ''),
      email: String(account.oauth.email || ''),
      scope: String(account.oauth.scope || ''),
      expiresAt: Number(account.oauth.expiresAt) || 0,
      accessToken: read(account.oauth.accessEnc),
      refreshToken: read(account.oauth.refreshEnc)
    };
  }

  /* 刷新会换发新的 refresh token，每次都要整条覆盖，不能只更新 access token。 */
  updateOAuth(id, tokens) {
    const index = this.data.accounts.findIndex((item) => item.id === id);
    if (index < 0) throw new Error('账户不存在');
    const account = this.data.accounts[index];
    if (account.authType !== 'oauth2') throw new Error('该账户未使用 OAuth 登录');
    const previous = account.oauth || {};
    const oauth = {
      provider: String((tokens && tokens.provider) || previous.provider || ''),
      email: String((tokens && tokens.email) || previous.email || ''),
      scope: String((tokens && tokens.scope) || previous.scope || ''),
      expiresAt: Math.max(0, Number(tokens && tokens.expiresAt) || 0),
      refreshEnc: tokens && tokens.refreshToken ? this._encrypt(tokens.refreshToken) : previous.refreshEnc || '',
      accessEnc: tokens && tokens.accessToken ? this._encrypt(tokens.accessToken) : previous.accessEnc || '',
      authorizedAt: tokens && tokens.authorizedAt ? tokens.authorizedAt : previous.authorizedAt || new Date().toISOString()
    };
    this.data.accounts[index] = { ...account, oauth };
    this._persist();
    return this._publicAccount(this.data.accounts[index]);
  }

  _oauthRecord(input) {
    return {
      provider: cleanText(input.provider, 20),
      email: cleanText(input.email, 320).trim(),
      scope: cleanText(input.scope, 1000),
      expiresAt: Math.max(0, Number(input.expiresAt) || 0),
      refreshEnc: input.refreshToken ? this._encrypt(input.refreshToken) : '',
      accessEnc: input.accessToken ? this._encrypt(input.accessToken) : '',
      authorizedAt: new Date().toISOString()
    };
  }

  saveAccount(input, password, oauth) {
    if (!input || typeof input !== 'object') throw new Error('账户信息无效');
    const email = cleanText(input.email, 320).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('邮箱地址格式不正确');
    }
    const id = input.id ? String(input.id) : '';
    const index = id ? this.data.accounts.findIndex((item) => item.id === id) : -1;
    const existing = index >= 0 ? this.data.accounts[index] : null;
    if (this.data.accounts.some((item, i) => i !== index && item.email.toLowerCase() === email.toLowerCase())) {
      throw new Error('该邮箱已添加');
    }
    const authType = input.authType === 'oauth2' ? 'oauth2' : 'password';
    if (authType === 'password' && !password && !(existing && existing.passEnc)) {
      throw new Error('请输入密码或授权码');
    }
    let oauthRecord = null;
    if (authType === 'oauth2') {
      oauthRecord = oauth ? this._oauthRecord(oauth) : existing && existing.oauth ? existing.oauth : null;
      if (!oauthRecord || !oauthRecord.refreshEnc) throw new Error('缺少 OAuth 授权信息，请重新登录');
    }
    const imap = cleanServer(input.imap, 'IMAP');
    const smtp = cleanServer(input.smtp, 'SMTP');
    const record = {
      id: existing ? existing.id : crypto.randomUUID(),
      email,
      name: cleanText(input.name, 120).trim(),
      color: existing ? existing.color : COLORS[this.data.accounts.length % COLORS.length],
      imap,
      smtp,
      authType,
      /* 切换登录方式时清掉另一种凭据，避免留下已经失效的秘密。 */
      passEnc: authType === 'password' ? (password ? this._encrypt(password) : existing ? existing.passEnc : '') : '',
      oauth: oauthRecord,
      createdAt: existing ? existing.createdAt : new Date().toISOString()
    };
    if (existing) {
      this.data.accounts[index] = record;
    } else {
      this.data.accounts.push(record);
    }
    this._persist();
    return this._publicAccount(record);
  }

  removeAccount(id) {
    const index = this.data.accounts.findIndex((item) => item.id === id);
    if (index < 0) return false;
    this.data.accounts.splice(index, 1);
    this._persist();
    return true;
  }

  _draftPayload(draft) {
    try {
      const json = this._decrypt(draft.payloadEnc);
      const data = JSON.parse(json);
      return {
        kind: ['new', 'reply', 'replyAll', 'forward'].includes(data.kind) ? data.kind : 'new',
        to: cleanText(data.to, 30000),
        cc: cleanText(data.cc, 30000),
        bcc: cleanText(data.bcc, 30000),
        subject: cleanText(data.subject, 2000),
        html: cleanText(data.html, 2 * 1024 * 1024),
        inReplyTo: cleanText(data.inReplyTo, 2000),
        references: cleanText(data.references, 20000)
      };
    } catch {
      return null;
    }
  }

  async listDrafts(accountId) {
    const drafts = this.data.drafts.filter((draft) => !draft.sendAt && (!accountId || draft.accountId === accountId));
    return drafts
      .map((draft) => {
        const payload = this._draftPayload(draft);
        if (!payload) return null;
        return {
          id: draft.id,
          accountId: draft.accountId,
          subject: payload.subject,
          updatedAt: draft.updatedAt,
          attachmentCount: Array.isArray(draft.attachments) ? draft.attachments.length : 0
        };
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  draftCount(accountId) {
    return this.data.drafts.filter((draft) => !draft.sendAt && draft.accountId === accountId).length;
  }

  async listScheduled(accountId) {
    const records = this.data.drafts.filter(
      (draft) => draft.sendAt && (!accountId || draft.accountId === accountId)
    );
    return records
      .map((draft) => {
        const payload = this._draftPayload(draft);
        if (!payload) return null;
        return {
          id: draft.id,
          accountId: draft.accountId,
          subject: payload.subject,
          to: payload.to,
          sendAt: draft.sendAt,
          updatedAt: draft.updatedAt,
          attachmentCount: Array.isArray(draft.attachments) ? draft.attachments.length : 0,
          attempts: Number(draft.attempts) || 0,
          lastError: String(draft.lastError || ''),
          nextAttempt: Number(draft.nextAttempt) || 0
        };
      })
      .filter(Boolean)
      .sort((a, b) => new Date(a.sendAt) - new Date(b.sendAt));
  }

  async getDraft(id) {
    const draft = this.data.drafts.find((item) => item.id === id);
    if (!draft) return null;
    const payload = this._draftPayload(draft);
    if (!payload) return null;
    const attachments = [];
    for (const item of Array.isArray(draft.attachments) ? draft.attachments : []) {
      try {
        const stat = await fsp.stat(item.path);
        if (stat.isFile()) {
          attachments.push({ name: item.name, path: item.path, size: stat.size });
        }
      } catch {}
    }
    return {
      id: draft.id,
      accountId: draft.accountId,
      ...payload,
      attachments,
      sendAt: String(draft.sendAt || ''),
      attempts: Number(draft.attempts) || 0,
      lastError: String(draft.lastError || ''),
      nextAttempt: Number(draft.nextAttempt) || 0,
      updatedAt: draft.updatedAt
    };
  }

  async saveDraft(input) {
    if (!input || typeof input !== 'object') throw new Error('草稿内容无效');
    const accountId = String(input.accountId || '');
    if (!this.data.accounts.some((account) => account.id === accountId)) {
      throw new Error('账户不存在');
    }
    let draft = input.id ? this.data.drafts.find((item) => item.id === input.id) : null;
    if (draft && draft.accountId !== accountId) throw new Error('草稿账户不匹配');
    const id = draft ? draft.id : crypto.randomUUID();
    const dir = path.join(this.draftsDir, id);
    await fsp.mkdir(dir, { recursive: true });

    const attachments = [];
    const rawAttachments = Array.isArray(input.attachments) ? input.attachments.slice(0, 20) : [];
    for (const item of rawAttachments) {
      if (!item || typeof item.path !== 'string') continue;
      const source = path.resolve(item.path);
      if (isInside(dir, source)) {
        try {
          const stat = await fsp.stat(source);
          if (stat.isFile()) {
            attachments.push({ name: cleanText(item.name, 255) || path.basename(source), path: source, size: stat.size });
          }
        } catch {}
        continue;
      }
      try {
        const stat = await fsp.stat(source);
        if (!stat.isFile()) continue;
        if (stat.size > 50 * 1024 * 1024) throw new Error(`附件过大：${item.name || path.basename(source)}`);
        const safeName = sanitizeFileName(item.name || path.basename(source)) || 'file';
        let target = path.join(dir, safeName);
        if (fs.existsSync(target)) {
          target = path.join(dir, `${crypto.randomUUID().slice(0, 8)}-${safeName}`);
        }
        await fsp.copyFile(source, target);
        attachments.push({ name: safeName, path: target, size: stat.size });
      } catch (err) {
        if (err && err.code === 'ENOENT') continue;
        throw err;
      }
    }

    const keep = new Set(attachments.map((item) => path.resolve(item.path)));
    for (const entry of await fsp.readdir(dir)) {
      const full = path.join(dir, entry);
      if (keep.has(path.resolve(full))) continue;
      try {
        const stat = await fsp.stat(full);
        if (stat.isFile()) await fsp.rm(full, { force: true });
      } catch {}
    }

    const payload = {
      kind: ['new', 'reply', 'replyAll', 'forward'].includes(input.kind) ? input.kind : 'new',
      to: cleanText(input.to, 30000),
      cc: cleanText(input.cc, 30000),
      bcc: cleanText(input.bcc, 30000),
      subject: cleanText(input.subject, 2000),
      html: cleanText(input.html, 2 * 1024 * 1024),
      inReplyTo: cleanText(input.inReplyTo, 2000),
      references: cleanText(input.references, 20000)
    };
    const sendAt = cleanSendAt(input.sendAt);
    const payloadEnc = this._encrypt(JSON.stringify(payload));
    const now = new Date().toISOString();
    if (draft) {
      draft.payloadEnc = payloadEnc;
      draft.attachments = attachments;
      draft.sendAt = sendAt;
      draft.updatedAt = now;
      if (!sendAt) {
        draft.attempts = 0;
        draft.lastError = '';
        draft.nextAttempt = 0;
      }
    } else {
      draft = {
        id,
        accountId,
        payloadEnc,
        attachments,
        sendAt,
        attempts: 0,
        lastError: '',
        nextAttempt: 0,
        createdAt: now,
        updatedAt: now
      };
      this.data.drafts.push(draft);
    }
    this._persist();
    return { id, accountId, updatedAt: now, sendAt };
  }

  async deleteDraft(id) {
    const draft = this.data.drafts.find((item) => item.id === id);
    if (!draft) return false;
    this.data.drafts = this.data.drafts.filter((item) => item.id !== id);
    this._persist();
    try {
      await fsp.rm(path.join(this.draftsDir, draft.id), { recursive: true, force: true });
    } catch {}
    return true;
  }

  async removeAccountDrafts(accountId) {
    const drafts = this.data.drafts.filter((item) => item.accountId === accountId);
    if (!drafts.length) return;
    this.data.drafts = this.data.drafts.filter((item) => item.accountId !== accountId);
    this._persist();
    for (const draft of drafts) {
      try {
        await fsp.rm(path.join(this.draftsDir, draft.id), { recursive: true, force: true });
      } catch {}
    }
  }

  scheduledCount(accountId) {
    return this.data.drafts.filter(
      (draft) => draft.sendAt && (!accountId || draft.accountId === accountId)
    ).length;
  }

  async markScheduledError(id, message, nextAttempt) {
    const draft = this.data.drafts.find((item) => item.id === id);
    if (!draft) return false;
    draft.attempts = (Number(draft.attempts) || 0) + 1;
    draft.lastError = cleanText(message, 400);
    draft.nextAttempt = Math.max(0, Math.floor(Number(nextAttempt) || 0));
    this._persist();
    return true;
  }

  async clearSchedule(id) {
    const draft = this.data.drafts.find((item) => item.id === id);
    if (!draft) return false;
    draft.sendAt = '';
    draft.attempts = 0;
    draft.lastError = '';
    draft.nextAttempt = 0;
    draft.updatedAt = new Date().toISOString();
    this._persist();
    return true;
  }

  /* ---------------------------------------------------------------- */
  /* Rules, blacklist and filter bookkeeping                           */
  /* ---------------------------------------------------------------- */

  listRules() {
    return this.data.rules
      .map((rule) => {
        try {
          return normalizeRule(rule, Number(rule.createdAt) || Date.now());
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  saveRule(input) {
    const now = Date.now();
    const rule = normalizeRule(input, now);
    /* Every save starts a fresh window: old mail that was never judged under
       the previous condition should not suddenly be moved retroactively. */
    rule.since = now;
    const id = rule.id || crypto.randomUUID();
    const index = rule.id ? this.data.rules.findIndex((item) => item.id === rule.id) : -1;
    const record = {
      ...rule,
      id,
      createdAt: index >= 0 ? Number(this.data.rules[index].createdAt) || now : now
    };
    if (index >= 0) this.data.rules[index] = record;
    else this.data.rules.push(record);
    this._persist();
    return record;
  }

  deleteRule(id) {
    const next = this.data.rules.filter((item) => item.id !== id);
    if (next.length === this.data.rules.length) return false;
    this.data.rules = next;
    this._persist();
    return true;
  }

  listBlacklist() {
    return this.data.blacklist
      .map((entry) => ({
        email: cleanText(entry && entry.email, 320).trim().toLowerCase(),
        addedAt: Number(entry && entry.addedAt) || 0
      }))
      .filter((entry) => entry.email);
  }

  addBlacklist(value) {
    const email = cleanEmail(value).toLowerCase();
    if (this.listBlacklist().some((entry) => entry.email === email)) {
      throw new Error('该地址已在黑名单中');
    }
    this.data.blacklist.push({ email, addedAt: Date.now() });
    this._persist();
    return this.listBlacklist();
  }

  removeBlacklist(value) {
    const email = cleanText(value, 320).trim().toLowerCase();
    const next = this.data.blacklist.filter((entry) => String(entry.email).toLowerCase() !== email);
    if (next.length === this.data.blacklist.length) return false;
    this.data.blacklist = next;
    this._persist();
    return true;
  }

  isFilterApplied(key) {
    return Boolean(key && this.data.filterApplied[key]);
  }

  markFilterApplied(keys) {
    const list = (Array.isArray(keys) ? keys : []).filter(Boolean);
    if (!list.length) return;
    const now = Date.now();
    for (const key of list) this.data.filterApplied[key] = now;
    const entries = Object.entries(this.data.filterApplied);
    if (entries.length > 5000) {
      entries.sort((a, b) => Number(b[1]) - Number(a[1]));
      this.data.filterApplied = Object.fromEntries(entries.slice(0, 5000));
    }
    this._persist();
  }

  /* Contacts live in their own plain-text file so they can be edited outside
     the app; they are re-read on every request rather than cached. */
  _readContacts() {
    let raw;
    try {
      raw = fs.readFileSync(this.contactsFile, 'utf8');
    } catch (err) {
      if (err && err.code === 'ENOENT') return [];
      throw new Error('无法读取联系人文件');
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`联系人文件不是合法 JSON，请检查 ${this.contactsFile}`);
    }
    const list = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.contacts) ? parsed.contacts : null;
    if (!list) throw new Error('联系人文件应是一个数组');
    return list
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({
        name: cleanText(item.name, 120).trim(),
        email: cleanText(item.email, 320).trim()
      }))
      .filter((item) => item.email);
  }

  _writeContacts(list) {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.contactsFile}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(list, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, this.contactsFile);
  }

  listContacts() {
    return this._readContacts().sort((a, b) => {
      const left = (a.name || a.email).localeCompare(b.name || b.email, 'zh-Hans-CN');
      return left || a.email.localeCompare(b.email);
    });
  }

  saveContact(input) {
    const name = cleanText(input && input.name, 120).trim();
    const email = cleanText(input && input.email, 320).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('联系人邮箱格式不正确');
    const original = cleanText(input && input.originalEmail, 320).trim().toLowerCase();
    const list = this._readContacts();
    const index = original ? list.findIndex((item) => item.email.toLowerCase() === original) : -1;
    if (index < 0 && list.some((item) => item.email.toLowerCase() === email.toLowerCase())) {
      throw new Error('该联系人已存在');
    }
    const record = { name: name || email, email };
    if (index >= 0) list[index] = record;
    else list.push(record);
    this._writeContacts(list);
    return record;
  }

  deleteContact(email) {
    const target = cleanText(email, 320).trim().toLowerCase();
    if (!target) return false;
    const list = this._readContacts();
    const next = list.filter((item) => item.email.toLowerCase() !== target);
    if (next.length === list.length) return false;
    this._writeContacts(next);
    return true;
  }
}

module.exports = {
  Store,
  DEFAULT_SETTINGS,
  sanitizeFileName
};
