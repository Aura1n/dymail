'use strict';

/* Decides WHEN a new-mail notification is due and what it says. The phone shell only displays it.
 *
 * Why this lives in the core: the desktop app works out "what's new" inside the page (it diffs unread
 * counts). On a phone the page is frozen as soon as the app is in the background, so the logic has to
 * run here, next to the IMAP connections, and hand the shell a finished {title, body}.
 *
 * Triggers
 *   mail:push            IMAP IDLE says the mailbox grew
 *   mail:status online   a connection (re)established: catches up on mail that arrived while it was down
 *   poll                 the shell's heartbeat (checkAll) - the safety net for connections the network silently dropped
 *   startup              one check shortly after launch
 *
 * "New" means: uid above the highest one already seen for that mailbox, and unread. The first time a
 * mailbox is seen it only records a baseline, so installing the app never floods the shade with old mail.
 * Mail that one of the user's rules or the blacklist will read / archive / delete is not announced. */

const fs = require('node:fs');
const path = require('node:path');
const { planMessage } = require('../../src/main/filters');

const LIST_LIMIT = 20;
const STATE_FILE = 'notified.json';
const MAX_BODY = 240;
const SILENCING = new Set(['read', 'trash', 'archive']);

const clip = (text, max) => {
  const value = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createNotifier({ call, bus, dataDir, emit, debounceMs = 1200, startDelayMs = 8000, log }) {
  const warn = typeof log === 'function' ? log : (...args) => console.warn('[notifier]', ...args);
  const send = typeof emit === 'function' ? emit : (command) => bus.emit('native', command);
  const file = path.join(dataDir, STATE_FILE);

  let state = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && typeof parsed === 'object') state = parsed;
  } catch {
    /* first run */
  }

  function persist() {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(state));
      fs.renameSync(tmp, file);
    } catch (err) {
      warn('cannot save state:', err && err.message);
    }
  }

  async function checkNow(accountId, mailbox) {
    const key = `${accountId}|${mailbox}`;
    /* role: 'inbox' makes the core run the user's filter rules on what it fetches, as the desktop list does. */
    const data = await call('mail:list', { accountId, path: mailbox, limit: LIST_LIMIT, role: 'inbox' });
    const messages = Array.isArray(data && data.messages) ? data.messages : [];
    const uids = messages.map((m) => Number(m.uid)).filter((n) => Number.isFinite(n) && n > 0);
    const top = uids.length ? Math.max(...uids) : 0;
    const entry = state[key];
    const known = entry && Number.isFinite(Number(entry.uid)) ? Number(entry.uid) : null;

    /* First sight of this mailbox, or its uids went backwards (the server renumbered it): re-baseline silently. */
    if (known === null || top < known) {
      state[key] = { uid: top };
      persist();
      return { baseline: true, notified: 0 };
    }

    const candidates = messages
      .filter((m) => Number(m.uid) > known && !m.seen)
      .sort((a, b) => Number(a.uid) - Number(b.uid));

    if (!candidates.length) {
      if (top > known) {
        state[key] = { uid: top };
        persist();
      }
      return { notified: 0 };
    }

    /* If any of these lookups fails we throw before moving the baseline, so the next check tries again. */
    const [settings, rules, accounts] = await Promise.all([call('settings:get'), call('rules:list'), call('accounts:list')]);

    const wanted = candidates.filter((message) => {
      const plan = planMessage({ rules: rules && rules.rules, blacklist: rules && rules.blacklist, message });
      return !plan.actions.some((action) => SILENCING.has(action));
    });

    if (wanted.length && !(settings && settings.notifyNewMail === false)) {
      const account = Array.isArray(accounts) ? accounts.find((a) => a.id === accountId) : null;
      const latest = wanted[wanted.length - 1];
      const who = (latest.from && (latest.from.name || latest.from.address)) || '未知发件人';
      const subject = clip(latest.subject, 120) || '（无主题）';
      const count = wanted.length;
      const label = count >= LIST_LIMIT ? `${count}+` : String(count);
      const body = count === 1 ? `${who}：${subject}` : `${label} 封新邮件 · 最新：${who}：${subject}`;
      send({
        type: 'notify',
        tag: accountId,
        accountId,
        count,
        title: `${(account && (account.name || account.email)) || '新邮件'} · 收件箱`,
        body: clip(body, MAX_BODY)
      });
    }

    state[key] = { uid: Math.max(known, top) };
    persist();
    return { notified: wanted.length };
  }

  /* One check at a time per mailbox; a request that arrives meanwhile is folded into a single re-run. */
  const running = new Map();
  function check(accountId, mailbox = 'INBOX') {
    const key = `${accountId}|${mailbox}`;
    const existing = running.get(key);
    if (existing) {
      existing.again = true;
      return existing.promise;
    }
    const entry = { again: false, promise: null };
    running.set(key, entry);
    entry.promise = (async () => {
      try {
        do {
          entry.again = false;
          try {
            await checkNow(accountId, mailbox);
          } catch (err) {
            warn(`check ${key} failed:`, err && err.message);
          }
        } while (entry.again);
      } finally {
        running.delete(key);
      }
    })();
    return entry.promise;
  }

  async function checkAll() {
    const accounts = await call('accounts:list');
    await Promise.all((Array.isArray(accounts) ? accounts : []).map((account) => check(account.id, 'INBOX')));
  }

  /* A burst of pushes (several mails at once, or every account reconnecting) becomes one check. */
  const timers = new Map();
  function schedule(accountId, mailbox = 'INBOX') {
    const key = `${accountId}|${mailbox}`;
    if (timers.has(key)) return;
    const timer = setTimeout(() => {
      timers.delete(key);
      check(accountId, mailbox);
    }, debounceMs);
    if (typeof timer.unref === 'function') timer.unref();
    timers.set(key, timer);
  }

  function onEvent(channel, payload) {
    if (channel === 'mail:push' && payload && payload.accountId) {
      schedule(String(payload.accountId), String(payload.path || 'INBOX'));
    } else if (channel === 'mail:status' && payload && payload.state === 'online' && payload.accountId) {
      schedule(String(payload.accountId), 'INBOX');
    } else if (channel === 'scheduled:changed' && payload && (payload.type === 'sent' || payload.type === 'error')) {
      /* Same rule as the desktop: a failure is reported once, not on every retry. */
      if (payload.type === 'error' && Number(payload.attempts) > 1) return;
      const subject = clip(payload.subject, 120) || '无主题';
      send({
        type: 'notify',
        tag: 'scheduled',
        count: 1,
        title: payload.type === 'sent' ? '定时邮件已发送' : '定时邮件发送失败',
        body: clip(payload.type === 'sent' ? subject : `${subject}：${payload.message || ''}`, MAX_BODY)
      });
    }
  }

  let startTimer = null;
  let started = false;

  function start() {
    if (started) return;
    started = true;
    bus.on('event', onEvent);
    if (startDelayMs >= 0) {
      startTimer = setTimeout(() => checkAll().catch((err) => warn('startup check failed:', err && err.message)), startDelayMs);
      if (typeof startTimer.unref === 'function') startTimer.unref();
    }
  }

  function stop() {
    started = false;
    bus.off('event', onEvent);
    if (startTimer) clearTimeout(startTimer);
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  }

  /* Resolves when nothing is scheduled or running. Used by the tests. */
  async function idle() {
    for (;;) {
      if (timers.size) {
        await sleep(debounceMs + 10);
        continue;
      }
      const pending = [...running.values()].map((entry) => entry.promise);
      if (!pending.length) return;
      await Promise.all(pending);
    }
  }

  return { start, stop, check, checkAll, idle };
}

module.exports = { createNotifier, LIST_LIMIT };
