/* Shared app state and the mail actions used by both the list and the reader. */

import { toast, confirmSheet } from './ui.js';

export const S = {
  api: null,
  demo: false,
  info: {},
  accounts: [],
  settings: { theme: 'system', remoteImages: 'allow', signature: '', refreshSeconds: 60, trashPurgeDays: 30 },
  view: { kind: 'unified', title: '收件箱' },
  messages: [],
  drafts: [],
  scheduled: [],
  scheduledCount: 0,
  contacts: null,
  cursor: null,
  cursors: null,
  hasMore: false,
  loading: false,
  error: '',
  unreadOnly: false,
  selected: new Set(),
  selecting: false
};

/* Filled in by app.js so other modules can ask the list to redraw without importing it. */
export const hooks = { render() {}, refreshAccounts: async () => {}, reload: async () => {} };

/* ---- per-device UI preferences (not mail settings, so they stay out of the core) ---- */
const UI_KEY = 'dymail.mobile.ui';
export const UI = (() => {
  try {
    return { threads: false, ...JSON.parse(localStorage.getItem(UI_KEY) || '{}') };
  } catch {
    return { threads: false };
  }
})();
export function saveUi() {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify(UI));
  } catch {
    /* private mode: the preference just won't persist */
  }
}

/* ---- conversations: same subject rule the core and the desktop list use ---- */
const SUBJECT_PREFIX = /^\s*(?:(?:re|fw|fwd|aw|sv|答复|回复|转发|转寄)\s*[:：]\s*)+/i;

export function normalizeSubject(subject) {
  let value = String(subject == null ? '' : subject).replace(/\s+/g, ' ').trim();
  for (let guard = 0; guard < 8; guard += 1) {
    const next = value.replace(SUBJECT_PREFIX, '');
    if (next === value) break;
    value = next;
  }
  return value;
}

export const groupKeyOf = (m) => `${m.accountId}\u0000${normalizeSubject(m.subject).toLowerCase()}`;

export const keyOf = (m) => `${m.accountId}|${m.path}|${m.uid}`;
export const accountById = (id) => S.accounts.find((a) => a.id === id) || null;
export const folderOf = (m) => {
  const account = accountById(m.accountId);
  return account && account.folders ? account.folders.find((f) => f.path === m.path) || null : null;
};
export const roleOf = (m) => (folderOf(m) ? folderOf(m).role : null);

export async function loadContacts(force = false) {
  if (S.contacts && !force) return S.contacts;
  try {
    S.contacts = (await S.api.contacts.list()) || [];
  } catch {
    S.contacts = [];
  }
  return S.contacts;
}

function groups(messages) {
  const map = new Map();
  for (const m of messages) {
    const k = `${m.accountId}|${m.path}`;
    if (!map.has(k)) map.set(k, { accountId: m.accountId, path: m.path, uids: [] });
    map.get(k).uids.push(m.uid);
  }
  return [...map.values()];
}

function dropLocal(messages) {
  const keys = new Set(messages.map(keyOf));
  S.messages = S.messages.filter((m) => !keys.has(keyOf(m)));
  for (const k of keys) S.selected.delete(k);
}

async function run(messages, task, failText) {
  const failed = [];
  for (const group of groups(messages)) {
    try {
      await task(group);
    } catch (err) {
      failed.push(err && err.message ? err.message : failText);
    }
  }
  if (failed.length) toast(failed[0]);
  return failed.length === 0;
}

export async function setSeen(messages, seen) {
  const flag = ['\\Seen'];
  const ok = await run(
    messages,
    (g) => S.api.mail.setFlags({ accountId: g.accountId, path: g.path, uids: g.uids, add: seen ? flag : [], remove: seen ? [] : flag }),
    '操作失败'
  );
  if (ok) {
    for (const m of messages) m.seen = seen;
    hooks.render();
    hooks.refreshAccounts(true);
  }
  return ok;
}

export async function setStar(messages, flagged) {
  const flag = ['\\Flagged'];
  const ok = await run(
    messages,
    (g) => S.api.mail.setFlags({ accountId: g.accountId, path: g.path, uids: g.uids, add: flagged ? flag : [], remove: flagged ? [] : flag }),
    '操作失败'
  );
  if (ok) {
    for (const m of messages) m.flagged = flagged;
    if (!flagged && S.view.kind === 'starred') dropLocal(messages);
    hooks.render();
  }
  return ok;
}

export async function moveTo(messages, target, doneText) {
  const ok = await run(
    messages,
    (g) => S.api.mail.move({ accountId: g.accountId, path: g.path, uid: g.uids[0], uids: g.uids, target }),
    '移动失败'
  );
  if (ok) {
    dropLocal(messages);
    hooks.render();
    hooks.refreshAccounts(true);
    if (doneText) toast(doneText);
  }
  return ok;
}

export async function restore(messages) {
  const ok = await run(
    messages,
    (g) => S.api.mail.restore({ accountId: g.accountId, path: g.path, uid: g.uids[0], uids: g.uids }),
    '还原失败'
  );
  if (ok) {
    dropLocal(messages);
    hooks.render();
    hooks.refreshAccounts(true);
    toast('已还原到收件箱');
  }
  return ok;
}

/* Delete moves to the trash folder; inside the trash it is permanent and asks first. */
export async function remove(messages) {
  const inTrash = messages.every((m) => roleOf(m) === 'trash');
  if (inTrash) {
    const yes = await confirmSheet({
      title: `彻底删除 ${messages.length} 封邮件？`,
      message: '此操作无法撤销。',
      ok: '彻底删除',
      danger: true
    });
    if (!yes) return false;
    const ok = await run(
      messages,
      (g) => S.api.mail.deletePermanent({ accountId: g.accountId, path: g.path, uid: g.uids[0], uids: g.uids }),
      '删除失败'
    );
    if (ok) {
      dropLocal(messages);
      hooks.render();
      hooks.refreshAccounts(true);
      toast('已彻底删除');
    }
    return ok;
  }
  return moveTo(messages, 'trash', '已移到「已删除」');
}
