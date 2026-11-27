'use strict';

const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { app, dialog } = require('electron');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const nodemailer = require('nodemailer');
const MailComposer = require('nodemailer/lib/mail-composer');
const addressparser = require('nodemailer/lib/addressparser');
const { sanitizeFileName } = require('./store');
const { normalizeSubject, planMessage } = require('./filters');

const ROLE_ORDER = ['inbox', 'sent', 'drafts', 'junk', 'trash', 'archive'];
const MAX_MESSAGE_BYTES = 30 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
/* One UID EXPUNGE per chunk keeps the sequence set short enough for every
   server's command length limit while still batching the delete. */
const TRASH_PURGE_CHUNK = 200;
const ALLOWED_FLAGS = new Set(['\\Seen', '\\Flagged', '\\Answered']);
const SPECIAL_ROLES = {
  '\\inbox': 'inbox',
  '\\sent': 'sent',
  '\\drafts': 'drafts',
  '\\junk': 'junk',
  '\\trash': 'trash',
  '\\archive': 'archive'
};
const NAME_RULES = [
  ['inbox', /^inbox$/i],
  ['sent', /^(sent|sent items|sent messages|sent mail|已发送|已发送邮件|已发邮件)$/i],
  ['drafts', /^(drafts|草稿|草稿箱)$/i],
  ['junk', /^(junk|junk e-mail|junk email|spam|垃圾邮件|广告邮件)$/i],
  ['trash', /^(trash|deleted items|deleted messages|deleted|bin|已删除|已删除邮件|垃圾桶)$/i],
  ['archive', /^(archive|archives|归档|存档|归档邮件)$/i]
];

function cleanText(value, max) {
  return String(value == null ? '' : value).slice(0, max);
}

function hasFlag(flags, name) {
  if (!flags) return false;
  const target = name.toLowerCase();
  for (const flag of flags) {
    if (String(flag).toLowerCase() === target) return true;
  }
  return false;
}

function isoDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeAddresses(obj) {
  if (!obj) return [];
  const value = Array.isArray(obj) ? obj : obj.value;
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      name: String(item && item.name ? item.name : '').trim(),
      address: String(item && item.address ? item.address : '').trim()
    }))
    .filter((item) => item.address);
}

function primaryAddress(obj) {
  const list = normalizeAddresses(obj);
  return list[0] || null;
}

function normalizeReferences(value) {
  if (Array.isArray(value)) return value.join(' ').replace(/[\r\n]+/g, ' ').trim();
  return String(value || '').replace(/[\r\n]+/g, ' ').trim();
}

function isAuthFailure(err) {
  const code = String((err && err.code) || '').toUpperCase();
  const lower = String((err && err.message) || '').toLowerCase();
  return Boolean(
    (err && err.authenticationFailed) ||
      code === 'EAUTH' ||
      code.includes('AUTHENTICATIONFAILED') ||
      lower.includes('authentication failed') ||
      lower.includes('invalid credentials') ||
      lower.includes('login failed') ||
      lower.includes('username and password not accepted') ||
      lower.includes('invalid username or password')
  );
}

// Workspace mailboxes use the same hosts as consumer Gmail, so the host alone
// is enough to know Google is the one rejecting the credentials.
function isGoogleMail(account) {
  const hosts = [account && account.imap && account.imap.host, account && account.smtp && account.smtp.host]
    .map((host) => String(host || '').toLowerCase());
  const domain = String((account && account.email) || '').split('@').pop().toLowerCase();
  return (
    hosts.some((host) => /(^|\.)(gmail|googlemail)\.com$/.test(host)) || domain === 'gmail.com' || domain === 'googlemail.com'
  );
}

// QQ / Foxmail reject the QQ login password outright; only the generated auth code works.
function isQQMail(account) {
  const hosts = [account && account.imap && account.imap.host, account && account.smtp && account.smtp.host]
    .map((host) => String(host || '').toLowerCase());
  const domain = String((account && account.email) || '').split('@').pop().toLowerCase();
  return (
    hosts.some((host) => /(^|\.)(qq|foxmail)\.com$/.test(host)) || domain === 'qq.com' || domain === 'foxmail.com'
  );
}

function friendlyError(err, prefix, account) {
  const code = String((err && err.code) || '').toUpperCase();
  const message = String((err && err.message) || '');
  const lower = message.toLowerCase();
  let text = '';
  if (isAuthFailure(err)) {
    text =
      account && account.authType === 'oauth2'
        ? 'OAuth 授权已失效，请在账户设置中重新授权'
        : isGoogleMail(account)
          ? 'Gmail 不接受账号密码：请在 Google 账号开启两步验证，再生成 16 位「应用专用密码」填入密码框；企业或学校域名通常只能改用 OAuth 登录'
          : isQQMail(account)
            ? 'QQ 邮箱不接受 QQ 密码：请在网页版邮箱「设置 → 账号与安全 → 安全设置」开启 IMAP/SMTP 服务，生成 16 位授权码填入；修改 QQ 密码后旧授权码会全部失效，需重新生成'
            : '邮箱或密码不正确，或需要应用授权码';
  } else if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || lower.includes('getaddrinfo')) {
    text = '无法解析邮件服务器地址';
  } else if (code === 'ECONNREFUSED') {
    text = '邮件服务器拒绝连接';
  } else if (code === 'ETIMEDOUT' || lower.includes('timed out') || lower.includes('timeout')) {
    text = '连接邮件服务器超时';
  } else if (lower.includes('certificate') || lower.includes('self signed')) {
    text = '服务器证书校验失败';
  } else if (lower.includes('too large') || lower.includes('max size') || lower.includes('message size')) {
    text = '邮件或附件体积超过服务器限制';
  } else if (lower.includes('invalid recipient') || lower.includes('recipient address')) {
    text = '收件人地址无效';
  } else if (
    lower.includes('nonexistent') ||
    (lower.includes('mailbox') && (lower.includes('not found') || lower.includes('does not exist')))
  ) {
    text = '邮件文件夹不存在';
  } else {
    text = message.replace(/\s+/g, ' ').trim().slice(0, 180) || '操作失败';
  }
  return prefix ? `${prefix}${text}` : text;
}

function roleFromSpecial(value) {
  if (!value) return null;
  return SPECIAL_ROLES[String(value).toLowerCase()] || null;
}

function roleFromName(name) {
  const clean = String(name || '').trim();
  for (const [role, regex] of NAME_RULES) {
    if (regex.test(clean)) return role;
  }
  return null;
}

function isSelectable(box) {
  if (!box || !box.flags) return true;
  return !(hasFlag(box.flags, '\\Noselect') || hasFlag(box.flags, '\\NonExistent'));
}

function compressUids(uids) {
  const unique = [...new Set(uids.map(Number).filter((uid) => Number.isInteger(uid) && uid > 0))].sort((a, b) => a - b);
  const parts = [];
  let start = null;
  let prev = null;
  for (const uid of unique) {
    if (start == null) {
      start = uid;
      prev = uid;
      continue;
    }
    if (uid === prev + 1) {
      prev = uid;
      continue;
    }
    parts.push(start === prev ? String(start) : `${start}:${prev}`);
    start = uid;
    prev = uid;
  }
  if (start != null) parts.push(start === prev ? String(start) : `${start}:${prev}`);
  return parts.join(',');
}

/* Move and delete take either one uid or a whole batch, because a mailbox
   selected with 50 checked mails should cost one IMAP command, not 50. */
function uidSet(uid, uids) {
  const list = Array.isArray(uids) && uids.length ? uids : [uid];
  if (list.length > 500) throw new Error('一次最多操作 500 封邮件');
  const range = compressUids(list);
  if (!range) throw new Error('邮件不存在');
  return range;
}

function compileMessage(options) {
  return new Promise((resolve, reject) => {
    const composer = new MailComposer(options);
    composer.compile().build((err, message) => {
      if (err) reject(err);
      else resolve(message);
    });
  });
}

/* New mail arrives over a dedicated IDLE connection per account; the poll timer
   stays as a slow safety net. Retries back off, and rejected credentials stop the
   watcher so the provider is not hammered or locked. */
const IDLE_RETRY_MS = [30000, 60000, 120000, 300000];
const IDLE_MAX_IDLE_MS = 25 * 60 * 1000;
const IDLE_AUTO_DELAY_MS = 1000;

class MailService {
  constructor(store, options = {}) {
    this.store = store;
    this.oauth = options.oauth || null;
    this.sessions = new Map();
    this.parseCache = new Map();
    this.watchers = new Map();
    this.onNewMail = null;
    /* 每个账户最近的连接状态，供渲染层画连接指示灯。 */
    this.statuses = new Map();
    this.onStatus = null;
    this.idleRetryMs =
      Array.isArray(options.idleRetryMs) && options.idleRetryMs.length ? options.idleRetryMs : IDLE_RETRY_MS;
  }

  /* only online/offline/error/connecting are meaningful to the sidebar; identical
     repeats are suppressed so a reconnect loop does not flood the renderer. */
  _setStatus(accountId, state, error = '') {
    const previous = this.statuses.get(accountId);
    const next = {
      accountId,
      state,
      error: error ? String(error).slice(0, 400) : '',
      at: Date.now()
    };
    if (previous && previous.state === next.state && previous.error === next.error) return;
    this.statuses.set(accountId, next);
    if (typeof this.onStatus === 'function') {
      try {
        this.onStatus(next);
      } catch {}
    }
  }

  statusList() {
    return [...this.statuses.values()];
  }

  _session(accountId) {
    const account = this.store.getAccount(accountId);
    if (!account) throw new Error('账户不存在');
    let session = this.sessions.get(accountId);
    if (!session) {
      session = {
        client: null,
        queue: Promise.resolve(),
        folders: null,
        lastStatus: null
      };
      this.sessions.set(accountId, session);
    }
    return { account, session };
  }

  _enqueue(accountId, task) {
    const { account, session } = this._session(accountId);
    const run = session.queue.then(() => task(account, session));
    session.queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  /* ---- INBOX watchers (IMAP IDLE) ---------------------------------- */

  watchAll() {
    for (const account of this.store.listAccounts()) this.watch(account.id);
  }

  watch(accountId) {
    const account = this.store.getAccount(accountId);
    if (!account) return;
    this.unwatch(account.id);
    const state = { stopped: false, client: null, retry: 0, timer: null };
    this.watchers.set(account.id, state);
    this._setStatus(account.id, 'connecting');
    this._watchLoop(account, state);
  }

  unwatch(accountId) {
    const state = this.watchers.get(accountId);
    if (!state) return;
    state.stopped = true;
    this.watchers.delete(accountId);
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    const client = state.client;
    state.client = null;
    if (client) {
      try {
        client.close();
      } catch {}
    }
  }

  unwatchAll() {
    for (const accountId of [...this.watchers.keys()]) this.unwatch(accountId);
  }

  _watchRetry(account, state) {
    if (state.stopped || state.timer) return;
    const index = Math.min(state.retry, this.idleRetryMs.length - 1);
    const delay = this.idleRetryMs[index];
    state.retry += 1;
    state.timer = setTimeout(() => {
      state.timer = null;
      this._watchLoop(account, state);
    }, delay);
    if (state.timer.unref) state.timer.unref();
  }

  async _watchLoop(account, state) {
    if (state.stopped) return;
    let auth = null;
    try {
      auth = await this._authFor(account);
    } catch (err) {
      /* 授权彻底失效时停止重试，避免反复失败把账号锁掉；等用户重新授权后再启动。 */
      if (err && err.message && err.message.includes('重新授权')) return;
      this._watchRetry(account, state);
      return;
    }
    let client;
    try {
      client = new ImapFlow({
        ...this._clientOptions(account, auth),
        autoIdleDelay: IDLE_AUTO_DELAY_MS,
        maxIdleTime: IDLE_MAX_IDLE_MS
      });
    } catch {
      this._watchRetry(account, state);
      return;
    }
    state.client = client;
    client.on('error', () => {});
    client.on('close', () => {
      if (state.client === client) state.client = null;
      if (!state.stopped) this._setStatus(account.id, 'offline');
      this._watchRetry(account, state);
    });
    client.on('exists', (data) => {
      if (state.client !== client) return;
      if (Number(data.count) <= Number(data.prevCount)) return;
      state.retry = 0;
      if (typeof this.onNewMail === 'function') {
        try {
          this.onNewMail(account.id, data.path, Number(data.count));
        } catch {}
      }
    });
    try {
      await client.connect();
      await client.mailboxOpen('INBOX');
      state.retry = 0;
      this._setStatus(account.id, 'online');
    } catch (err) {
      if (state.client === client) state.client = null;
      try {
        client.close();
      } catch {}
      if (isAuthFailure(err)) {
        this._setStatus(account.id, 'error', friendlyError(err, '', account));
        this.unwatch(account.id);
        return;
      }
      this._setStatus(account.id, 'offline');
      this._watchRetry(account, state);
    }
  }

  /* One account's folder status, for refreshes triggered by a push instead of
     the full sync, which would re-STATUS every account on every new message. */
  async syncOne(accountId) {
    const account = this.store.getAccount(accountId);
    if (!account) throw new Error('账户不存在');
    try {
      const folders = await this._enqueue(account.id, async (acct, session) => {
        const client = await this._connect(acct, session);
        const list = await this._loadFolders(acct, session, client, true);
        const withStatus = await this._statusFolders(client, list);
        session.lastStatus = withStatus;
        return withStatus;
      });
      return {
        ...account,
        folders,
        draftCount: this.store.draftCount(account.id),
        error: null
      };
    } catch (err) {
      this._setStatus(account.id, 'error', friendlyError(err, '', account));
      const session = this.sessions.get(account.id);
      const cached = (session && (session.lastStatus || session.folders)) || [];
      return {
        ...account,
        folders: cached,
        draftCount: this.store.draftCount(account.id),
        error: friendlyError(err, '', account)
      };
    }
  }

  reset(accountId) {
    this.unwatch(accountId);
    this._setStatus(accountId, 'offline');
    const session = this.sessions.get(accountId);
    if (!session) return;
    if (session.client) {
      try {
        session.client.close();
      } catch {}
    }
    this.sessions.delete(accountId);
  }

  disconnectAll() {
    this.unwatchAll();
    for (const session of this.sessions.values()) {
      if (session.client) {
        try {
          session.client.close();
        } catch {}
      }
    }
    this.sessions.clear();
  }

  /* 统一解析登录凭据：OAuth 账户取（必要时刷新）访问令牌，其余账户读加密密码。 */
  async _authFor(account) {
    if (account.authType === 'oauth2') {
      if (!this.oauth) throw new Error('OAuth 登录模块不可用');
      const accessToken = await this.oauth.accessToken(account.id);
      return { user: account.email, accessToken };
    }
    let pass;
    try {
      pass = this.store.getPassword(account.id);
    } catch {
      throw new Error('无法读取账户密码');
    }
    if (!pass) throw new Error('账户缺少密码');
    return { user: account.email, pass };
  }

  _clientOptions(account, auth) {
    return {
      host: account.imap.host,
      port: account.imap.port,
      secure: account.imap.secure,
      auth: auth.accessToken
        ? { user: account.email, accessToken: auth.accessToken }
        : { user: account.email, pass: auth.pass },
      logger: false,
      connectionTimeout: 20000,
      greetingTimeout: 20000,
      socketTimeout: 180000
    };
  }

  _transport(account, auth) {
    return nodemailer.createTransport({
      host: account.smtp.host,
      port: account.smtp.port,
      secure: account.smtp.secure,
      requireTLS: !account.smtp.secure,
      auth: auth.accessToken
        ? { type: 'OAuth2', user: account.email, accessToken: auth.accessToken }
        : { user: account.email, pass: auth.pass },
      connectionTimeout: 20000,
      greetingTimeout: 20000,
      socketTimeout: 60000
    });
  }

  async _connect(account, session) {
    if (session.client && session.client.usable) return session.client;
    if (session.client) {
      try {
        session.client.close();
      } catch {}
      session.client = null;
    }
    const auth = await this._authFor(account);
    const client = new ImapFlow(this._clientOptions(account, auth));
    client.on('error', () => {});
    client.on('close', () => {
      if (session.client === client) session.client = null;
    });
    try {
      await client.connect();
    } catch (err) {
      this._setStatus(
        account.id,
        isAuthFailure(err) ? 'error' : 'offline',
        isAuthFailure(err) ? friendlyError(err, '', account) : ''
      );
      throw err;
    }
    session.client = client;
    this._setStatus(account.id, 'online');
    return client;
  }

  async testConnection(config, credential) {
    const account = {
      email: config.email,
      imap: config.imap,
      smtp: config.smtp,
      authType: config.authType === 'oauth2' ? 'oauth2' : 'password'
    };
    const auth =
      typeof credential === 'string' ? { pass: credential } : credential || {};
    if (!auth.accessToken && !auth.pass) throw new Error('缺少登录凭据');
    const client = new ImapFlow(this._clientOptions(account, auth));
    client.on('error', () => {});
    let imapError = null;
    try {
      await client.connect();
    } catch (err) {
      imapError = err;
    }
    try {
      await client.logout();
    } catch {
      try {
        client.close();
      } catch {}
    }
    if (imapError) throw new Error(friendlyError(imapError, 'IMAP：', account));

    const transport = this._transport(account, auth);
    try {
      await transport.verify();
    } catch (err) {
      throw new Error(friendlyError(err, 'SMTP：', account));
    } finally {
      try {
        transport.close();
      } catch {}
    }
    return true;
  }

  async _loadFolders(account, session, client, refresh) {
    if (!refresh && session.folders) return session.folders;
    const list = await client.list();
    const chosen = new Map();
    for (const box of list) {
      if (!isSelectable(box)) continue;
      const role = roleFromSpecial(box.specialUse);
      if (role && !chosen.has(role)) chosen.set(role, box);
    }
    for (const box of list) {
      if (!isSelectable(box)) continue;
      const role = roleFromName(box.name);
      if (role && !chosen.has(role)) chosen.set(role, box);
    }
    if (!chosen.has('inbox')) {
      const inbox = list.find((box) => isSelectable(box) && String(box.path).toUpperCase() === 'INBOX');
      chosen.set('inbox', inbox || { path: 'INBOX', name: 'Inbox', delimiter: '/' });
    }
    const folders = [];
    for (const role of ROLE_ORDER) {
      const box = chosen.get(role);
      if (!box) continue;
      folders.push({
        role,
        path: box.path,
        name: box.name || box.path,
        delimiter: box.delimiter || '/'
      });
    }
    session.folders = folders;
    return folders;
  }

  async _statusFolders(client, folders) {
    const result = [];
    for (const folder of folders) {
      let unseen = null;
      let total = null;
      try {
        const status = await client.status(folder.path, { messages: true, unseen: true });
        if (status) {
          unseen = Number(status.unseen) || 0;
          total = Number(status.messages) || 0;
        }
      } catch {}
      result.push({ ...folder, unseen, total });
    }
    return result;
  }

  async sync() {
    const accounts = this.store.listAccounts();
    return Promise.all(
      accounts.map(async (account) => {
        try {
          const folders = await this._enqueue(account.id, async (acct, session) => {
            const client = await this._connect(acct, session);
            const list = await this._loadFolders(acct, session, client, true);
            const withStatus = await this._statusFolders(client, list);
            session.lastStatus = withStatus;
            return withStatus;
          });
          return {
            ...account,
            folders,
            draftCount: this.store.draftCount(account.id),
            error: null
          };
        } catch (err) {
          this._setStatus(account.id, 'error', friendlyError(err, '', account));
          const session = this.sessions.get(account.id);
          const cached = (session && (session.lastStatus || session.folders)) || [];
          return {
            ...account,
            folders: cached,
            draftCount: this.store.draftCount(account.id),
            error: friendlyError(err, '', account)
          };
        }
      })
    );
  }

  async _ensureMailbox(client, pathName) {
    if (client.mailbox && client.mailbox.path === pathName) return client.mailbox;
    return client.mailboxOpen(pathName);
  }

  _summary(account, mailboxPath, msg) {
    const envelope = msg.envelope || {};
    const from = primaryAddress(envelope.from);
    const to = normalizeAddresses(envelope.to);
    const date = isoDate(envelope.date) || isoDate(msg.internalDate);
    const subject = cleanText(envelope.subject, 2000).trim();
    return {
      accountId: account.id,
      accountEmail: account.email,
      accountName: account.name || '',
      accountColor: account.color,
      path: mailboxPath,
      uid: Number(msg.uid),
      seq: Number(msg.seq),
      subject,
      from,
      to,
      date,
      timestamp: date ? Date.parse(date) : 0,
      seen: hasFlag(msg.flags, '\\Seen'),
      flagged: hasFlag(msg.flags, '\\Flagged'),
      answered: hasFlag(msg.flags, '\\Answered')
    };
  }

  async _fetchRange(client, account, mailboxPath, start, end) {
    const messages = [];
    for await (const msg of client.fetch(`${start}:${end}`, {
      uid: true,
      envelope: true,
      flags: true,
      internalDate: true
    })) {
      if (hasFlag(msg.flags, '\\Deleted')) continue;
      messages.push(this._summary(account, mailboxPath, msg));
    }
    messages.sort((a, b) => b.seq - a.seq);
    return messages;
  }

  _clampLimit(value) {
    const limit = Number(value) || 40;
    return Math.max(10, Math.min(100, Math.floor(limit)));
  }

  async list({ accountId, path: mailboxPath, cursor, limit }) {
    const accountKey = String(accountId || '');
    if (!accountKey) throw new Error('账户不存在');
    if (typeof mailboxPath !== 'string' || !mailboxPath) throw new Error('文件夹无效');
    const pageSize = this._clampLimit(limit);
    const cursorNumber = Number(cursor) > 0 ? Number(cursor) : null;
    return this._enqueue(accountKey, async (account, session) => {
      const client = await this._connect(account, session);
      const mailbox = await this._ensureMailbox(client, mailboxPath);
      const exists = Number(mailbox.exists) || 0;
      if (!exists) return { messages: [], cursor: null, total: 0 };
      const end = cursorNumber ? Math.min(cursorNumber, exists) : exists;
      if (end < 1) return { messages: [], cursor: null, total: exists };
      const start = Math.max(1, end - pageSize + 1);
      const messages = await this._fetchRange(client, account, mailboxPath, start, end);
      return {
        messages,
        cursor: start > 1 ? start - 1 : null,
        total: exists
      };
    });
  }

  /* Aggregates one folder role across every account, newest first. Accounts
     without that folder simply contribute nothing to the view. */
  async listUnified({ cursors, limit, role }) {
    const wantedRole = role || 'inbox';
    const pageSize = this._clampLimit(limit);
    const accounts = this.store.listAccounts();
    const results = await Promise.allSettled(
      accounts.map((account) =>
        this._enqueue(account.id, async (acct, session) => {
          const client = await this._connect(acct, session);
          let folders = await this._loadFolders(acct, session, client, false);
          let box = folders.find((folder) => folder.role === wantedRole);
          if (!box && wantedRole !== 'inbox') {
            folders = await this._loadFolders(acct, session, client, true);
            box = folders.find((folder) => folder.role === wantedRole);
          }
          if (!box) {
            if (wantedRole !== 'inbox') return { accountId: acct.id, messages: [], cursor: null };
            throw new Error('未找到收件箱');
          }
          const mailbox = await this._ensureMailbox(client, box.path);
          const exists = Number(mailbox.exists) || 0;
          const cursorValue = cursors && Number(cursors[acct.id]) > 0 ? Number(cursors[acct.id]) : null;
          if (!exists || (cursorValue != null && cursorValue < 1)) {
            return { accountId: acct.id, messages: [], cursor: null };
          }
          const end = cursorValue ? Math.min(cursorValue, exists) : exists;
          const start = Math.max(1, end - pageSize + 1);
          const messages = await this._fetchRange(client, acct, box.path, start, end);
          return {
            accountId: acct.id,
            messages,
            cursor: start > 1 ? start - 1 : null
          };
        })
      )
    );
    const messages = [];
    const nextCursors = {};
    const errors = [];
    results.forEach((result, index) => {
      const account = accounts[index];
      if (result.status === 'fulfilled') {
        messages.push(...result.value.messages);
        nextCursors[account.id] = result.value.cursor;
      } else {
        nextCursors[account.id] = cursors && cursors[account.id] ? cursors[account.id] : null;
        errors.push({
          accountId: account.id,
          accountEmail: account.email,
          error: friendlyError(result.reason, '', account)
        });
      }
    });
    messages.sort((a, b) => b.timestamp - a.timestamp || b.seq - a.seq);
    return { messages, cursors: nextCursors, errors };
  }

  // Archived mail is the Archive folder of every account, so it reuses the
  // unified paging with a different role.
  async listArchived(options) {
    return this.listUnified({ ...options, role: 'archive' });
  }

  // Starred mail aggregates the flagged messages of every account inbox. The
  // cursor is an index into each account's sorted UID list, so paging walks
  // backwards through the mailboxes the same way listUnified does.
  async listStarred({ cursors, limit }) {
    const pageSize = this._clampLimit(limit);
    const accounts = this.store.listAccounts();
    const results = await Promise.allSettled(
      accounts.map((account) =>
        this._enqueue(account.id, async (acct, session) => {
          const client = await this._connect(acct, session);
          const folders = await this._loadFolders(acct, session, client, false);
          const inbox = folders.find((folder) => folder.role === 'inbox');
          if (!inbox) throw new Error('未找到收件箱');
          await this._ensureMailbox(client, inbox.path);
          const found = await client.search({ flagged: true }, { uid: true });
          const uids = (Array.isArray(found) ? found : []).map(Number).filter((uid) => uid > 0).sort((a, b) => a - b);
          const wanted = cursors && Number(cursors[acct.id]) > 0 ? Math.min(Number(cursors[acct.id]), uids.length) : uids.length;
          if (wanted < 1) return { accountId: acct.id, messages: [], cursor: null };
          const start = Math.max(1, wanted - pageSize + 1);
          const range = compressUids(uids.slice(start - 1, wanted));
          const messages = [];
          if (range) {
            for await (const msg of client.fetch(
              range,
              { uid: true, envelope: true, flags: true, internalDate: true },
              { uid: true }
            )) {
              if (hasFlag(msg.flags, '\\Deleted')) continue;
              messages.push(this._summary(acct, inbox.path, msg));
            }
          }
          return { accountId: acct.id, messages, cursor: start > 1 ? start - 1 : null };
        })
      )
    );
    const messages = [];
    const nextCursors = {};
    const errors = [];
    results.forEach((result, index) => {
      const account = accounts[index];
      if (result.status === 'fulfilled') {
        messages.push(...result.value.messages);
        nextCursors[account.id] = result.value.cursor;
      } else {
        nextCursors[account.id] = cursors && cursors[account.id] ? cursors[account.id] : null;
        errors.push({
          accountId: account.id,
          accountEmail: account.email,
          error: friendlyError(result.reason, '', account)
        });
      }
    });
    messages.sort((a, b) => b.timestamp - a.timestamp || b.seq - a.seq);
    return { messages, cursors: nextCursors, errors };
  }

  async _searchAccount(account, query, folderPath, take) {
    return this._enqueue(account.id, async (acct, session) => {
      const client = await this._connect(acct, session);
      const folders = await this._loadFolders(acct, session, client, false);
      let pathName = folderPath;
      if (!pathName) {
        const inbox = folders.find((folder) => folder.role === 'inbox');
        if (!inbox) throw new Error('未找到收件箱');
        pathName = inbox.path;
      }
      await this._ensureMailbox(client, pathName);
      const found = await client.search({ text: query }, { uid: true });
      if (!found || !found.length) return [];
      const uids = found.slice(-take);
      const range = compressUids(uids);
      if (!range) return [];
      const messages = [];
      for await (const msg of client.fetch(
        range,
        { uid: true, envelope: true, flags: true, internalDate: true },
        { uid: true }
      )) {
        if (hasFlag(msg.flags, '\\Deleted')) continue;
        messages.push(this._summary(acct, pathName, msg));
      }
      messages.sort((a, b) => b.timestamp - a.timestamp || b.seq - a.seq);
      return messages;
    });
  }

  async search({ accountId, path: mailboxPath, query }) {
    const text = cleanText(query, 200).trim();
    if (!text) return { messages: [], errors: [] };
    if (accountId) {
      const account = this.store.getAccount(accountId);
      if (!account) throw new Error('账户不存在');
      const messages = await this._searchAccount(account, text, mailboxPath || null, 80);
      return { messages, errors: [] };
    }
    const accounts = this.store.listAccounts();
    const results = await Promise.allSettled(
      accounts.map((account) => this._searchAccount(account, text, null, 40))
    );
    const messages = [];
    const errors = [];
    results.forEach((result, index) => {
      const account = accounts[index];
      if (result.status === 'fulfilled') {
        messages.push(...result.value);
      } else {
        errors.push({
          accountId: account.id,
          accountEmail: account.email,
          error: friendlyError(result.reason, '', account)
        });
      }
    });
    messages.sort((a, b) => b.timestamp - a.timestamp || b.seq - a.seq);
    return { messages: messages.slice(0, 120), errors };
  }

  /* Collects every message in one conversation: the same normalized subject
     across Inbox, Sent and Archive, so replies from both directions appear
     together even when the list only showed one folder. */
  async thread({ accountId, subject, path: currentPath }) {
    const key = String(accountId || '');
    if (!key) throw new Error('账户不存在');
    const normalized = normalizeSubject(subject);
    if (!normalized) return { messages: [], subject: '' };
    return this._enqueue(key, async (account, session) => {
      const client = await this._connect(account, session);
      const folders = await this._loadFolders(account, session, client, false);
      const paths = new Set();
      if (typeof currentPath === 'string' && currentPath) paths.add(currentPath);
      for (const role of ['inbox', 'sent', 'archive']) {
        const folder = folders.find((item) => item.role === role);
        if (folder) paths.add(folder.path);
      }
      const messages = [];
      const seen = new Set();
      for (const mailboxPath of paths) {
        try {
          await this._ensureMailbox(client, mailboxPath);
          const found = await client.search({ subject: normalized }, { uid: true });
          const uids = (Array.isArray(found) ? found : [])
            .map(Number)
            .filter((uid) => uid > 0)
            .slice(-200);
          const range = compressUids(uids);
          if (!range) continue;
          for await (const msg of client.fetch(
            range,
            { uid: true, envelope: true, flags: true, internalDate: true },
            { uid: true }
          )) {
            if (hasFlag(msg.flags, '\\Deleted')) continue;
            const summary = this._summary(account, mailboxPath, msg);
            if (normalizeSubject(summary.subject).toLowerCase() !== normalized.toLowerCase()) continue;
            const dedupe = `${mailboxPath}\u0000${summary.uid}`;
            if (seen.has(dedupe)) continue;
            seen.add(dedupe);
            messages.push(summary);
          }
        } catch {}
      }
      messages.sort((a, b) => a.timestamp - b.timestamp || a.uid - b.uid);
      return { subject: normalized, messages };
    });
  }

  /* Applies blacklist and rules to freshly listed inbox summaries. Operations
     are grouped per folder so a mailbox costs one flag call and one move. */
  async runFilters(messages) {
    const rules = this.store.listRules();
    const blacklist = this.store.listBlacklist();
    if ((!rules.length && !blacklist.length) || !Array.isArray(messages) || !messages.length) {
      return { processed: 0, blocked: 0, moved: 0 };
    }
    if (this.filtering) return { processed: 0, blocked: 0, moved: 0, skipped: true };
    this.filtering = true;
    const groups = new Map();
    let matched = 0;
    let blocked = 0;
    try {
      for (const message of messages) {
        if (!message || !message.accountId || !message.path || !message.uid) continue;
        const key = `${message.accountId}\u0000${message.path}\u0000${message.uid}`;
        if (this.store.isFilterApplied(key)) continue;
        const plan = planMessage({ rules, blacklist, message });
        if (!plan.actions.length) continue;
        matched += 1;
        if (plan.blocked) blocked += 1;
        const target = plan.actions.includes('trash')
          ? 'trash'
          : plan.actions.includes('archive')
            ? 'archive'
            : '';
        const flags = [];
        if (plan.actions.includes('read')) flags.push('\\Seen');
        if (plan.actions.includes('star')) flags.push('\\Flagged');
        const groupKey = `${message.accountId}\u0000${message.path}\u0000${target}`;
        let group = groups.get(groupKey);
        if (!group) {
          group = {
            accountId: message.accountId,
            path: message.path,
            target,
            uids: [],
            keys: [],
            flags: new Set()
          };
          groups.set(groupKey, group);
        }
        group.uids.push(Number(message.uid));
        group.keys.push(key);
        for (const flag of flags) group.flags.add(flag);
      }

      let moved = 0;
      for (const group of groups.values()) {
        if (!group.uids.length) continue;
        try {
          if (group.flags.size) {
            await this.setFlags({
              accountId: group.accountId,
              path: group.path,
              uids: group.uids,
              add: [...group.flags],
              remove: []
            });
          }
          if (group.target) {
            await this.move({
              accountId: group.accountId,
              path: group.path,
              uids: group.uids,
              target: group.target
            });
            moved += group.uids.length;
          }
          this.store.markFilterApplied(group.keys);
        } catch (err) {
          console.error('[filters]', err && err.message ? err.message : err);
        }
      }
      const result = { processed: matched, blocked, moved };
      if (this.onFiltered) {
        try {
          this.onFiltered(result);
        } catch {}
      }
      return result;
    } finally {
      this.filtering = false;
    }
  }

  async _parsedAttachments(accountId, mailboxPath, uid) {
    const uidNumber = Number(uid);
    if (!Number.isInteger(uidNumber) || uidNumber < 1) throw new Error('附件不存在');
    return this._enqueue(accountId, async (account, session) => {
      const client = await this._connect(account, session);
      const parsed = await this._fetchParsed(account, session, client, mailboxPath, uidNumber);
      return Array.isArray(parsed.attachments) ? parsed.attachments : [];
    });
  }

  async saveAllAttachments({ accountId, path: mailboxPath, uid, window }) {
    const attachments = await this._parsedAttachments(accountId, mailboxPath, uid);
    const items = attachments.filter(
      (item) =>
        Buffer.isBuffer(item.content) &&
        item.content.length &&
        !(item.cid && (item.related || String(item.contentDisposition || '').toLowerCase() === 'inline'))
    );
    if (!items.length) throw new Error('没有可保存的附件');
    let defaultDir;
    try {
      defaultDir = app.getPath('downloads');
    } catch {
      defaultDir = app.getPath('documents');
    }
    const choice = await dialog.showOpenDialog(window, {
      title: '选择附件保存位置',
      defaultPath: defaultDir,
      properties: ['openDirectory', 'createDirectory']
    });
    if (choice.canceled || !choice.filePaths || !choice.filePaths[0]) return { canceled: true };
    const dir = choice.filePaths[0];
    const saved = [];
    const used = new Set();
    for (const item of items) {
      let name = sanitizeFileName(item.filename || 'attachment') || 'attachment';
      let counter = 1;
      const collision = () =>
        used.has(name.toLowerCase()) ||
        fs.existsSync(path.join(dir, name));
      while (collision()) {
        const ext = path.extname(name);
        const base = name.slice(0, name.length - ext.length).replace(/-\d+$/, '') || 'attachment';
        name = `${base}-${counter}${ext}`;
        counter += 1;
      }
      used.add(name.toLowerCase());
      const target = path.join(dir, name);
      await fsp.writeFile(target, item.content);
      saved.push({ name, path: target, size: item.content.length });
    }
    return { canceled: false, dir, files: saved };
  }

  async setFlags({ accountId, path: mailboxPath, uids, add, remove }) {
    if (!Array.isArray(uids) || !uids.length) throw new Error('邮件不存在');
    if (uids.length > 500) throw new Error('一次最多操作 500 封邮件');
    const addFlags = (Array.isArray(add) ? add : []).filter((flag) => ALLOWED_FLAGS.has(flag));
    const removeFlags = (Array.isArray(remove) ? remove : []).filter((flag) => ALLOWED_FLAGS.has(flag));
    if (!addFlags.length && !removeFlags.length) throw new Error('没有可用的操作');
    const range = compressUids(uids);
    return this._enqueue(accountId, async (account, session) => {
      const client = await this._connect(account, session);
      await this._ensureMailbox(client, mailboxPath);
      if (addFlags.length) await client.messageFlagsAdd(range, addFlags, { uid: true });
      if (removeFlags.length) await client.messageFlagsRemove(range, removeFlags, { uid: true });
      return true;
    });
  }

  async markAllRead({ accountId, path: mailboxPath }) {
    return this._enqueue(accountId, async (account, session) => {
      const client = await this._connect(account, session);
      const mailbox = await this._ensureMailbox(client, mailboxPath);
      if (!Number(mailbox.exists)) return true;
      await client.messageFlagsAdd('1:*', ['\\Seen']);
      return true;
    });
  }

  async _findFolder(client, account, session, role, refresh) {
    const folders = await this._loadFolders(account, session, client, refresh);
    return folders.find((folder) => folder.role === role) || null;
  }

  /* QQ, Gmail and most Chinese providers expose no archive folder at all, so the
     first archive on such an account creates one instead of failing; the unified
     归档 view in the sidebar then picks it up on the next folder sync. */
  async _createArchiveFolder(client, account, session) {
    const name = '归档';
    try {
      await client.mailboxCreate(name);
    } catch (err) {
      throw new Error(`该账户没有归档文件夹，服务器也拒绝新建（${friendlyError(err, '')}）`);
    }
    const created = await this._findFolder(client, account, session, 'archive', true);
    return created || { role: 'archive', path: name, name, delimiter: '/' };
  }

  async move({ accountId, path: mailboxPath, uid, uids, target }) {
    if (!['trash', 'archive'].includes(target)) throw new Error('目标文件夹无效');
    const range = uidSet(uid, uids);
    return this._enqueue(accountId, async (account, session) => {
      const client = await this._connect(account, session);
      let folder = await this._findFolder(client, account, session, target, false);
      if (!folder) folder = await this._findFolder(client, account, session, target, true);
      if (!folder && target === 'archive') folder = await this._createArchiveFolder(client, account, session);
      if (!folder) {
        throw new Error(target === 'trash' ? '该账户没有已删除文件夹' : '该账户没有归档文件夹');
      }
      await this._ensureMailbox(client, mailboxPath);
      await client.messageMove(range, folder.path, { uid: true });
      return { path: folder.path };
    });
  }

  async deletePermanent({ accountId, path: mailboxPath, uid, uids }) {
    const range = uidSet(uid, uids);
    return this._enqueue(accountId, async (account, session) => {
      const client = await this._connect(account, session);
      await this._ensureMailbox(client, mailboxPath);
      await client.messageDelete(range, { uid: true });
      return true;
    });
  }

  /* 已删除 does not record where a message came from, so restoring means moving
     it back to the inbox. The move can carry the deletion flag along, so it is
     cleared on the copies the server reports back. */
  async restore({ accountId, path: mailboxPath, uid, uids }) {
    const range = uidSet(uid, uids);
    return this._enqueue(accountId, async (account, session) => {
      const client = await this._connect(account, session);
      let inbox = await this._findFolder(client, account, session, 'inbox', false);
      if (!inbox) inbox = await this._findFolder(client, account, session, 'inbox', true);
      if (!inbox) throw new Error('该账户没有收件箱');
      await this._ensureMailbox(client, mailboxPath);
      const moved = await client.messageMove(range, inbox.path, { uid: true });
      await this._ensureMailbox(client, inbox.path);
      const landed = moved && moved.uidMap ? [...moved.uidMap.values()].map(Number) : [];
      const flags = compressUids(landed);
      if (flags) {
        try {
          await client.messageFlagsRemove(flags, ['\\Deleted'], { uid: true });
        } catch {}
      }
      return { path: inbox.path };
    });
  }

  /* Providers expire their trash on their own schedule (Gmail after 30 days,
     QQ after 30, some never), so the app empties 已删除 itself: read the real
     internal dates instead of trusting a server's BEFORE/OLDER quirks, then
     expunge in chunks. */
  async purgeTrash({ days }) {
    const limit = Number(days);
    if (!Number.isInteger(limit) || limit < 1) return [];
    const cutoff = Date.now() - limit * 86400000;
    const accounts = this.store.listAccounts();
    const results = await Promise.allSettled(
      accounts.map((account) =>
        this._enqueue(account.id, async (acct, session) => {
          const client = await this._connect(acct, session);
          let trash = await this._findFolder(client, acct, session, 'trash', false);
          if (!trash) trash = await this._findFolder(client, acct, session, 'trash', true);
          if (!trash) return { accountId: acct.id, email: acct.email, removed: 0 };
          const mailbox = await this._ensureMailbox(client, trash.path);
          if (!Number(mailbox && mailbox.exists)) return { accountId: acct.id, email: acct.email, removed: 0 };
          const stale = [];
          for await (const msg of client.fetch('1:*', { uid: true, internalDate: true })) {
            const at = msg.internalDate ? new Date(msg.internalDate).getTime() : 0;
            const uid = Number(msg.uid);
            if (at && at < cutoff && uid > 0) stale.push(uid);
          }
          let removed = 0;
          for (let start = 0; start < stale.length; start += TRASH_PURGE_CHUNK) {
            const chunk = stale.slice(start, start + TRASH_PURGE_CHUNK);
            const range = compressUids(chunk);
            if (!range) continue;
            await client.messageFlagsAdd(range, ['\\Deleted'], { uid: true });
            await client.messageDelete(range, { uid: true });
            removed += chunk.length;
          }
          return { accountId: acct.id, email: acct.email, removed };
        })
      )
    );
    return results.map((result, index) =>
      result.status === 'fulfilled'
        ? result.value
        : {
            accountId: accounts[index].id,
            email: accounts[index].email,
            removed: 0,
            error: friendlyError(result.reason, '', accounts[index])
          }
    );
  }

  _cacheKey(accountId, pathName, uid) {
    return `${accountId}\u0000${pathName}\u0000${uid}`;
  }

  _cacheParsed(key, parsed) {
    this.parseCache.delete(key);
    this.parseCache.set(key, parsed);
    while (this.parseCache.size > 6) {
      const oldest = this.parseCache.keys().next().value;
      this.parseCache.delete(oldest);
    }
  }

  async _fetchParsed(account, session, client, mailboxPath, uid) {
    const key = this._cacheKey(account.id, mailboxPath, uid);
    if (this.parseCache.has(key)) return this.parseCache.get(key);
    await this._ensureMailbox(client, mailboxPath);
    const head = await client.fetchOne(String(uid), { flags: true, size: true }, { uid: true });
    if (!head) throw new Error('邮件不存在');
    if (Number(head.size) > MAX_MESSAGE_BYTES) {
      throw new Error('邮件超过 30 MB，暂不支持查看');
    }
    const full = await client.fetchOne(String(uid), { source: true, flags: true }, { uid: true });
    if (!full || !full.source) throw new Error('无法读取邮件内容');
    const parsed = await simpleParser(full.source);
    this._cacheParsed(key, parsed);
    return parsed;
  }

  _inlineHtml(parsed) {
    let html = typeof parsed.html === 'string' ? parsed.html : '';
    let inlineBudget = 6 * 1024 * 1024;
    const attachments = Array.isArray(parsed.attachments) ? parsed.attachments : [];
    const inline = [];
    for (const attachment of attachments) {
      if (!attachment.cid) continue;
      if (!/^image\//i.test(String(attachment.contentType || ''))) continue;
      const content = attachment.content;
      if (!Buffer.isBuffer(content) || !content.length || content.length > inlineBudget) continue;
      inlineBudget -= content.length;
      const type = String(attachment.contentType).split(';')[0];
      const dataUrl = `data:${type};base64,${content.toString('base64')}`;
      const rawCid = String(attachment.cid).replace(/^<|>$/g, '');
      inline.push([rawCid, dataUrl]);
      try {
        inline.push([decodeURIComponent(rawCid), dataUrl]);
      } catch {}
      inline.push([encodeURIComponent(rawCid), dataUrl]);
    }
    for (const [cid, dataUrl] of inline) {
      if (!cid) continue;
      html = html.split(`cid:${cid}`).join(dataUrl);
    }
    return html;
  }

  _remoteImages(html) {
    if (!html) return false;
    return (
      /<img\b[^>]*\bsrc\s*=\s*["']?\s*(?:https?:)?\/\//i.test(html) ||
      /url\(\s*["']?\s*(?:https?:)?\/\//i.test(html)
    );
  }

  async read({ accountId, path: mailboxPath, uid }) {
    const uidNumber = Number(uid);
    if (!Number.isInteger(uidNumber) || uidNumber < 1) throw new Error('邮件不存在');
    return this._enqueue(accountId, async (account, session) => {
      const client = await this._connect(account, session);
      await this._ensureMailbox(client, mailboxPath);
      const head = await client.fetchOne(String(uidNumber), { flags: true, size: true }, { uid: true });
      if (!head) throw new Error('邮件不存在');
      if (Number(head.size) > MAX_MESSAGE_BYTES) throw new Error('邮件超过 30 MB，暂不支持查看');
      const parsed = await this._fetchParsed(account, session, client, mailboxPath, uidNumber);
      const wasSeen = hasFlag(head.flags, '\\Seen');
      let seen = wasSeen;
      if (!wasSeen) {
        try {
          await client.messageFlagsAdd(String(uidNumber), ['\\Seen'], { uid: true });
          seen = true;
        } catch {}
      }
      const html = this._inlineHtml(parsed);
      const attachments = Array.isArray(parsed.attachments) ? parsed.attachments : [];
      const attachmentList = [];
      attachments.forEach((attachment, index) => {
        const content = attachment.content;
        if (!Buffer.isBuffer(content) || !content.length) return;
        const inline = Boolean(attachment.cid) && (attachment.related || attachment.contentDisposition === 'inline');
        if (inline) return;
        attachmentList.push({
          index,
          name: cleanText(attachment.filename, 255) || '附件',
          size: Number(attachment.size) || content.length,
          contentType: cleanText(attachment.contentType, 200) || 'application/octet-stream'
        });
      });
      return {
        accountId: account.id,
        accountEmail: account.email,
        accountColor: account.color,
        path: mailboxPath,
        uid: uidNumber,
        subject: cleanText(parsed.subject, 2000).trim(),
        from: primaryAddress(parsed.from),
        to: normalizeAddresses(parsed.to),
        cc: normalizeAddresses(parsed.cc),
        bcc: normalizeAddresses(parsed.bcc),
        date: isoDate(parsed.date),
        messageId: cleanText(parsed.messageId, 2000).trim(),
        inReplyTo: cleanText(parsed.inReplyTo, 2000).trim(),
        references: normalizeReferences(parsed.references),
        html,
        text: typeof parsed.text === 'string' ? parsed.text : '',
        hasRemoteImages: this._remoteImages(html),
        attachments: attachmentList,
        seen,
        flagged: hasFlag(head.flags, '\\Flagged')
      };
    });
  }

  async saveAttachment({ accountId, path: mailboxPath, uid, index, name, window }) {
    const uidNumber = Number(uid);
    const indexNumber = Number(index);
    if (!Number.isInteger(uidNumber) || !Number.isInteger(indexNumber)) throw new Error('附件不存在');
    const attachment = await this._enqueue(accountId, async (account, session) => {
      const client = await this._connect(account, session);
      const parsed = await this._fetchParsed(account, session, client, mailboxPath, uidNumber);
      const list = Array.isArray(parsed.attachments) ? parsed.attachments : [];
      const item = list[indexNumber];
      if (!item || !Buffer.isBuffer(item.content)) throw new Error('附件不存在');
      return {
        filename: sanitizeFileName(item.filename || name || 'attachment') || 'attachment',
        content: item.content
      };
    });
    let defaultDir;
    try {
      defaultDir = app.getPath('downloads');
    } catch {
      defaultDir = app.getPath('documents');
    }
    const target = await dialog.showSaveDialog(window, {
      defaultPath: path.join(defaultDir, attachment.filename)
    });
    if (target.canceled || !target.filePath) return { canceled: true };
    await fsp.writeFile(target.filePath, attachment.content);
    return { canceled: false, path: target.filePath };
  }

  _recipients(to, cc, bcc) {
    const addresses = [];
    for (const field of [to, cc, bcc]) {
      if (!field) continue;
      const parsed = addressparser(field, { flatten: true });
      for (const item of parsed) {
        if (item.address && item.address.includes('@')) addresses.push(item.address);
      }
    }
    return addresses;
  }

  async send(input) {
    const account = this.store.getAccount(String(input.accountId || ''));
    if (!account) throw new Error('账户不存在');
    const to = cleanText(input.to, 30000).replace(/[\r\n]+/g, ' ');
    const cc = cleanText(input.cc, 30000).replace(/[\r\n]+/g, ' ');
    const bcc = cleanText(input.bcc, 30000).replace(/[\r\n]+/g, ' ');
    const subject = cleanText(input.subject, 2000).replace(/[\r\n]+/g, ' ');
    const html = cleanText(input.html, 2 * 1024 * 1024);
    const text = cleanText(input.text, 1024 * 1024);
    const recipients = this._recipients(to, cc, bcc);
    if (!recipients.length) throw new Error('请填写收件人');
    const attachments = [];
    let totalBytes = 0;
    for (const item of Array.isArray(input.attachments) ? input.attachments.slice(0, 20) : []) {
      if (!item || typeof item.path !== 'string') continue;
      const stat = await fsp.stat(item.path).catch(() => null);
      if (!stat || !stat.isFile()) throw new Error(`附件不存在：${item.name || path.basename(item.path)}`);
      totalBytes += stat.size;
      if (totalBytes > MAX_ATTACHMENT_BYTES) throw new Error('附件总大小不能超过 25 MB');
      const content = await fsp.readFile(item.path);
      attachments.push({
        filename: sanitizeFileName(item.name || path.basename(item.path)) || 'attachment',
        content
      });
    }
    const auth = await this._authFor(account);
    const inReplyTo = cleanText(input.inReplyTo, 2000).replace(/[\r\n]+/g, ' ');
    const references = cleanText(input.references, 20000).replace(/[\r\n]+/g, ' ');
    const mailOptions = {
      from: { name: account.name || account.email, address: account.email },
      to: to || undefined,
      cc: cc || undefined,
      bcc: bcc || undefined,
      subject,
      html: html || undefined,
      text: text || undefined,
      attachments,
      inReplyTo: inReplyTo || undefined,
      references: references || undefined
    };
    let raw;
    try {
      raw = await compileMessage(mailOptions);
    } catch (err) {
      throw new Error(friendlyError(err, '', account));
    }
    const transport = this._transport(account, auth);
    let info;
    try {
      info = await transport.sendMail({
        envelope: { from: account.email, to: recipients },
        raw
      });
    } catch (err) {
      throw new Error(friendlyError(err, '', account));
    } finally {
      try {
        transport.close();
      } catch {}
    }
    let savedToSent = false;
    let warning = null;
    const autoSaves = /gmail\.com|googlemail\.com|outlook\.com|office365\.com|hotmail\.com|live\.com|msn\.com/i.test(
      account.imap.host
    );
    if (!autoSaves) {
      try {
        await this._enqueue(account.id, async (acct, session) => {
          const client = await this._connect(acct, session);
          let sent = await this._findFolder(client, acct, session, 'sent', false);
          if (!sent) sent = await this._findFolder(client, acct, session, 'sent', true);
          if (sent) await client.append(sent.path, raw, ['\\Seen']);
          else throw new Error('未找到已发送文件夹');
        });
        savedToSent = true;
      } catch (err) {
        warning = friendlyError(err, '已发送，但未能保存副本：', account);
      }
    }
    return {
      messageId: info && info.messageId ? info.messageId : '',
      savedToSent,
      warning
    };
  }
}

module.exports = { MailService, friendlyError };
