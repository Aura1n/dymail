'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { app, safeStorage } = require('electron');

const COLORS = ['#0a84ff', '#34a853', '#ff9f0a', '#e5484d', '#8e5cf7', '#00a3a3', '#d6409f', '#6b7280'];
const DEFAULT_UPDATE_REPO = 'Aura1n/dymail';

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
  updateLastCheck: 0
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

class Store {
  constructor() {
    this.dir = app.getPath('userData');
    this.file = path.join(this.dir, 'dymail.json');
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
    return { ...this.data.settings };
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
    this.data.settings = next;
    this._persist();
    return { ...next };
  }

  getWindowBounds() {
    return this.data.ui && this.data.ui.bounds ? this.data.ui.bounds : null;
  }

  setWindowBounds(bounds) {
    this.data.ui = { ...(this.data.ui || {}), bounds };
    this._persist();
  }

  _publicAccount(account) {
    return {
      id: account.id,
      email: account.email,
      name: account.name || '',
      color: account.color,
      imap: { ...account.imap },
      smtp: { ...account.smtp },
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

  saveAccount(input, password) {
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
    if (!password && !(existing && existing.passEnc)) {
      throw new Error('请输入密码或授权码');
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
      passEnc: password ? this._encrypt(password) : existing.passEnc,
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
    const drafts = this.data.drafts.filter((draft) => !accountId || draft.accountId === accountId);
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
    return this.data.drafts.filter((draft) => draft.accountId === accountId).length;
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
    const payloadEnc = this._encrypt(JSON.stringify(payload));
    const now = new Date().toISOString();
    if (draft) {
      draft.payloadEnc = payloadEnc;
      draft.attachments = attachments;
      draft.updatedAt = now;
    } else {
      draft = {
        id,
        accountId,
        payloadEnc,
        attachments,
        createdAt: now,
        updatedAt: now
      };
      this.data.drafts.push(draft);
    }
    this._persist();
    return { id, accountId, updatedAt: now };
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
}

module.exports = {
  Store,
  DEFAULT_SETTINGS,
  sanitizeFileName
};
