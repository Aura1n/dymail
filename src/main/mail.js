'use strict';

const path = require('node:path');
const fsp = require('node:fs/promises');
const { app, dialog } = require('electron');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const nodemailer = require('nodemailer');
const MailComposer = require('nodemailer/lib/mail-composer');
const addressparser = require('nodemailer/lib/addressparser');
const { sanitizeFileName } = require('./store');

const ROLE_ORDER = ['inbox', 'sent', 'drafts', 'junk', 'trash', 'archive'];
const MAX_MESSAGE_BYTES = 30 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
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

function friendlyError(err, prefix) {
  const code = String((err && err.code) || '').toUpperCase();
  const message = String((err && err.message) || '');
  const lower = message.toLowerCase();
  let text = '';
  if (
    (err && err.authenticationFailed) ||
    code.includes('AUTHENTICATIONFAILED') ||
    lower.includes('authentication failed') ||
    lower.includes('invalid credentials') ||
    lower.includes('login failed') ||
    lower.includes('username and password not accepted') ||
    lower.includes('invalid username or password')
  ) {
    text = '邮箱或密码不正确，或需要应用授权码';
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

function compileMessage(options) {
  return new Promise((resolve, reject) => {
    const composer = new MailComposer(options);
    composer.compile().build((err, message) => {
      if (err) reject(err);
      else resolve(message);
    });
  });
}

class MailService {
  constructor(store) {
    this.store = store;
    this.sessions = new Map();
    this.parseCache = new Map();
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

  reset(accountId) {
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
    for (const session of this.sessions.values()) {
      if (session.client) {
        try {
          session.client.close();
        } catch {}
      }
    }
    this.sessions.clear();
  }

  _clientOptions(account, pass) {
    return {
      host: account.imap.host,
      port: account.imap.port,
      secure: account.imap.secure,
      auth: { user: account.email, pass },
      logger: false,
      connectionTimeout: 20000,
      greetingTimeout: 20000,
      socketTimeout: 180000
    };
  }

  _transport(account, pass) {
    return nodemailer.createTransport({
      host: account.smtp.host,
      port: account.smtp.port,
      secure: account.smtp.secure,
      requireTLS: !account.smtp.secure,
      auth: { user: account.email, pass },
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
    let pass;
    try {
      pass = this.store.getPassword(account.id);
    } catch {
      throw new Error('无法读取账户密码');
    }
    if (!pass) throw new Error('账户缺少密码');
    const client = new ImapFlow(this._clientOptions(account, pass));
    client.on('error', () => {});
    client.on('close', () => {
      if (session.client === client) session.client = null;
    });
    await client.connect();
    session.client = client;
    return client;
  }

  async testConnection(config, pass) {
    const account = {
      email: config.email,
      imap: config.imap,
      smtp: config.smtp
    };
    const client = new ImapFlow(this._clientOptions(account, pass));
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
    if (imapError) throw new Error(friendlyError(imapError, 'IMAP：'));

    const transport = this._transport(account, pass);
    try {
      await transport.verify();
    } catch (err) {
      throw new Error(friendlyError(err, 'SMTP：'));
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
          const session = this.sessions.get(account.id);
          const cached = (session && (session.lastStatus || session.folders)) || [];
          return {
            ...account,
            folders: cached,
            draftCount: this.store.draftCount(account.id),
            error: friendlyError(err)
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

  async listUnified({ cursors, limit }) {
    const pageSize = this._clampLimit(limit);
    const accounts = this.store.listAccounts();
    const results = await Promise.allSettled(
      accounts.map((account) =>
        this._enqueue(account.id, async (acct, session) => {
          const client = await this._connect(acct, session);
          const folders = await this._loadFolders(acct, session, client, false);
          const inbox = folders.find((folder) => folder.role === 'inbox');
          if (!inbox) throw new Error('未找到收件箱');
          const mailbox = await this._ensureMailbox(client, inbox.path);
          const exists = Number(mailbox.exists) || 0;
          const cursorValue = cursors && Number(cursors[acct.id]) > 0 ? Number(cursors[acct.id]) : null;
          if (!exists || (cursorValue != null && cursorValue < 1)) {
            return { accountId: acct.id, messages: [], cursor: null };
          }
          const end = cursorValue ? Math.min(cursorValue, exists) : exists;
          const start = Math.max(1, end - pageSize + 1);
          const messages = await this._fetchRange(client, acct, inbox.path, start, end);
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
          error: friendlyError(result.reason)
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
          error: friendlyError(result.reason)
        });
      }
    });
    messages.sort((a, b) => b.timestamp - a.timestamp || b.seq - a.seq);
    return { messages: messages.slice(0, 120), errors };
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

  async move({ accountId, path: mailboxPath, uid, target }) {
    if (!['trash', 'archive'].includes(target)) throw new Error('目标文件夹无效');
    const uidNumber = Number(uid);
    if (!Number.isInteger(uidNumber) || uidNumber < 1) throw new Error('邮件不存在');
    return this._enqueue(accountId, async (account, session) => {
      const client = await this._connect(account, session);
      let folder = await this._findFolder(client, account, session, target, false);
      if (!folder) folder = await this._findFolder(client, account, session, target, true);
      if (!folder) {
        throw new Error(target === 'trash' ? '该账户没有已删除文件夹' : '该账户没有归档文件夹');
      }
      await this._ensureMailbox(client, mailboxPath);
      await client.messageMove(String(uidNumber), folder.path, { uid: true });
      return { path: folder.path };
    });
  }

  async deletePermanent({ accountId, path: mailboxPath, uid }) {
    const uidNumber = Number(uid);
    if (!Number.isInteger(uidNumber) || uidNumber < 1) throw new Error('邮件不存在');
    return this._enqueue(accountId, async (account, session) => {
      const client = await this._connect(account, session);
      await this._ensureMailbox(client, mailboxPath);
      await client.messageDelete(String(uidNumber), { uid: true });
      return true;
    });
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
    let pass;
    try {
      pass = this.store.getPassword(account.id);
    } catch {
      throw new Error('无法读取账户密码');
    }
    if (!pass) throw new Error('账户缺少密码');
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
      throw new Error(friendlyError(err));
    }
    const transport = this._transport(account, pass);
    let info;
    try {
      info = await transport.sendMail({
        envelope: { from: account.email, to: recipients },
        raw
      });
    } catch (err) {
      throw new Error(friendlyError(err));
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
        warning = friendlyError(err, '已发送，但未能保存副本：');
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
