import { getApi } from './bridge.js';
import { h, ic, iconBtn, initLayers, openLayer, openPage, closeTop, layerCount, actionSheet, confirmSheet, toast, fmtTime, fmtSchedule, person } from './ui.js';
import { FOLDER_ICONS } from './icons.js';
import { S, UI, saveUi, hooks, keyOf, groupKeyOf, normalizeSubject, roleOf, setSeen, setStar, moveTo, remove, restore } from './state.js';
import { openReader, openThread } from './reader.js';
import { openCompose } from './compose.js';
import { openSettings, openAddAccount, applyTheme } from './settings.js';
import { scheduleUpdateCheck, flushPendingUpdate } from './update.js';
import { syncBackground } from './background.js';

const PAGE = 30;
const ROLE_LABELS = { inbox: '收件箱', sent: '已发送', drafts: '草稿', archive: '归档', junk: '垃圾邮件', trash: '已删除' };
const ROLE_ORDER = ['inbox', 'sent', 'drafts', 'archive', 'junk', 'trash'];
const NO_SELECT = ['drafts', 'scheduled'];

const app = document.getElementById('app');
let main;
let topbar;
let scroll;
let content;
let ptr;
let lastSync = 0;
let reqId = 0;
const expanded = new Set();

/* ------------------------------------------------------------------ data */

let accountsBusy = false;
let accountsAt = 0;

async function refreshAccounts(quiet = false) {
  if (quiet && (accountsBusy || Date.now() - accountsAt < 4000)) return;
  accountsBusy = true;
  try {
    let list = await S.api.accounts.list();
    try {
      const synced = await S.api.folders.sync();
      if (Array.isArray(synced) && synced.length) list = synced;
    } catch {
      /* Folder sync failing for one account must not hide the accounts themselves. */
    }
    S.accounts = (list || []).map((a) => ({ ...a, folders: Array.isArray(a.folders) ? a.folders : [] }));
    try {
      const pending = await S.api.scheduled.list('');
      S.scheduledCount = Array.isArray(pending) ? pending.length : 0;
    } catch {
      S.scheduledCount = 0;
    }
    accountsAt = Date.now();
    renderTop();
    if (drawerEl) renderDrawer();
  } catch (err) {
    if (!quiet) toast(err && err.message ? err.message : '读取账户失败');
  } finally {
    accountsBusy = false;
  }
}

function hasMoreFrom(cursors) {
  return Boolean(cursors) && Object.values(cursors).some((c) => c != null && c !== false);
}

async function loadView({ reset = true, soft = false } = {}) {
  const view = S.view;
  const mine = ++reqId;
  if (!reset && (S.loading || !S.hasMore)) return;
  S.loading = true;
  S.error = '';
  if (reset && !soft) {
    S.messages = [];
    S.drafts = [];
    S.scheduled = [];
    S.cursor = null;
    S.cursors = null;
    S.hasMore = false;
    S.selected.clear();
    S.selecting = false;
  }
  renderTop();
  renderList();
  try {
    if (view.kind === 'drafts') {
      const list = await S.api.drafts.list(view.accountId || '');
      if (mine !== reqId) return;
      S.drafts = list || [];
      S.hasMore = false;
    } else if (view.kind === 'scheduled') {
      const list = await S.api.scheduled.list(view.accountId || '');
      if (mine !== reqId) return;
      S.scheduled = list || [];
      S.scheduledCount = S.scheduled.length;
      S.hasMore = false;
    } else {
      let res;
      if (view.kind === 'folder') {
        res = await S.api.mail.list({ accountId: view.accountId, path: view.path, cursor: reset ? undefined : S.cursor, limit: PAGE });
        if (mine !== reqId) return;
        S.cursor = res.cursor == null ? null : res.cursor;
        S.hasMore = S.cursor != null;
      } else {
        const call = view.kind === 'starred' ? 'listStarred' : view.kind === 'archived' ? 'listArchived' : 'listUnified';
        res = await S.api.mail[call]({ cursors: reset ? null : S.cursors, limit: PAGE });
        if (mine !== reqId) return;
        S.cursors = res.cursors || null;
        S.hasMore = hasMoreFrom(S.cursors);
        if (res.errors && res.errors.length) S.error = `${res.errors.length} 个账户同步失败`;
      }
      const incoming = res.messages || [];
      if (reset) S.messages = incoming;
      else {
        const seen = new Set(S.messages.map(keyOf));
        S.messages = S.messages.concat(incoming.filter((m) => !seen.has(keyOf(m))));
      }
    }
    lastSync = Date.now();
  } catch (err) {
    if (mine !== reqId) return;
    S.error = err && err.message ? err.message : '加载失败';
    if (reset && !soft) S.hasMore = false;
  } finally {
    if (mine === reqId) {
      S.loading = false;
      renderTop();
      renderList();
    }
  }
}

hooks.render = () => {
  renderTop();
  renderList();
  if (drawerEl) renderDrawer();
};
hooks.refreshAccounts = refreshAccounts;
hooks.reload = () => loadView({ reset: true, soft: true });

/* ------------------------------------------------------------------ grouping */

const single = (m) => ({ key: keyOf(m), messages: [m], latest: m, subject: m.subject });

function visibleMessages() {
  return S.unreadOnly ? S.messages.filter((m) => !m.seen) : S.messages;
}

function buildGroups(list) {
  if (!UI.threads || NO_SELECT.includes(S.view.kind)) return list.map(single);
  const map = new Map();
  const out = [];
  for (const m of list) {
    const key = groupKeyOf(m);
    let group = map.get(key);
    if (!group) {
      group = { key, messages: [], latest: m, subject: normalizeSubject(m.subject) };
      map.set(key, group);
      out.push(group);
    }
    group.messages.push(m);
    if ((m.timestamp || 0) > (group.latest.timestamp || 0)) group.latest = m;
  }
  return out;
}

/* ------------------------------------------------------------------ list */

/* One pointer handler for tap, long-press and horizontal swipe. A swipe or long-press swallows the click that follows. */
function attachGestures(el, { onTap, onLong, swipe, onSwipeMove, onSwipeEnd }) {
  let timer = 0;
  let long = false;
  let swallow = false;
  let sx = 0;
  let sy = 0;
  let dx = 0;
  let down = false;
  let swiping = false;
  const stopTimer = () => clearTimeout(timer);

  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    down = true;
    long = false;
    swiping = false;
    sx = e.clientX;
    sy = e.clientY;
    dx = 0;
    stopTimer();
    el.style.transition = '';
    if (onLong) {
      timer = setTimeout(() => {
        if (swiping) return;
        long = true;
        if (navigator.vibrate) navigator.vibrate(12);
        onLong();
      }, 450);
    }
  });

  el.addEventListener('pointermove', (e) => {
    if (!down) return;
    const mx = e.clientX - sx;
    const my = e.clientY - sy;
    if (!swiping) {
      if (Math.abs(mx) > 10 || Math.abs(my) > 10) stopTimer();
      if (swipe && !S.selecting && Math.abs(mx) > 12 && Math.abs(mx) > Math.abs(my) * 1.5) {
        swiping = true;
        try { el.setPointerCapture(e.pointerId); } catch { /* capture is optional */ }
      }
    }
    if (swiping) {
      dx = Math.max(-140, Math.min(140, mx));
      el.style.transform = `translateX(${dx}px)`;
      if (onSwipeMove) onSwipeMove(dx);
    }
  });

  const finish = (cancelled) => {
    if (!down) return;
    down = false;
    stopTimer();
    if (!swiping) return;
    const distance = dx;
    swiping = false;
    el.style.transition = 'transform 0.2s';
    el.style.transform = '';
    if (onSwipeEnd) setTimeout(onSwipeEnd, 220);
    swallow = true;
    setTimeout(() => { swallow = false; }, 60);
    if (cancelled) return;
    if (distance >= 84) swipe.right();
    else if (distance <= -84) swipe.left();
  };
  el.addEventListener('pointerup', () => finish(false));
  el.addEventListener('pointercancel', () => finish(true));
  el.addEventListener('pointerleave', () => { if (!swiping) stopTimer(); });

  el.addEventListener('click', (e) => {
    if (long || swallow) {
      long = false;
      e.preventDefault();
      return;
    }
    onTap();
  });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

function toggleSelect(list) {
  const all = list.every((m) => S.selected.has(keyOf(m)));
  for (const m of list) {
    if (all) S.selected.delete(keyOf(m));
    else S.selected.add(keyOf(m));
  }
  S.selecting = S.selected.size > 0;
  renderTop();
  renderList();
}

function rowEl(g, { selectable = true, swipe = true } = {}) {
  const m = g.latest;
  const role = roleOf(m);
  const outgoing = role === 'sent' || role === 'drafts';
  const who = outgoing ? `收件人：${(m.to || []).map((a) => person(a).label).filter(Boolean).join('、') || '（无）'}` : person(m.from).label || '（未知发件人）';
  const multi = S.accounts.length > 1 && S.view.kind !== 'folder';
  const unread = g.messages.some((x) => !x.seen);
  const flagged = g.messages.some((x) => x.flagged);
  const sel = g.messages.every((x) => S.selected.has(keyOf(x)));

  const row = h(
    'div',
    { class: `row${unread ? ' unread' : ''}${sel ? ' sel' : ''}`, role: 'button', tabindex: '0' },
    h('div', { class: 'dot' }),
    h('span', { class: 'check' }, ic('check', 14)),
    h(
      'div',
      { class: 'main' },
      h('div', { class: 'top' }, h('div', { class: 'from' }, who), g.messages.length > 1 ? h('span', { class: 'cnt' }, g.messages.length) : null),
      h('div', { class: 'subject' }, g.messages.length > 1 && g.subject ? g.subject : m.subject || '（无主题）'),
      multi ? h('div', { class: 'meta' }, h('i', { style: `background:${m.accountColor || '#888'}` }), m.accountEmail || '') : null
    ),
    h('div', { class: 'side' }, h('span', { class: 'time' }, fmtTime(m.date || m.timestamp)), flagged ? h('span', { class: 'star' }, ic('star', 15)) : null)
  );

  const back =
    role === 'trash'
      ? { label: '还原', icon: 'undo', run: () => restore(g.messages) }
      : role === 'archive'
        ? { label: '移回收件箱', icon: 'inbox', run: () => moveTo(g.messages, 'inbox', '已移回收件箱') }
        : { label: '归档', icon: 'archive', run: () => moveTo(g.messages, 'archive', '已归档') };

  const wrap = h(
    'div',
    { class: 'swipewrap' },
    h('div', { class: 'swipebg read' }, ic('mailcheck', 20), h('span', null, unread ? '已读' : '未读')),
    h('div', { class: 'swipebg arch' }, h('span', null, back.label), ic(back.icon, 20)),
    row
  );

  attachGestures(row, {
    onTap: () => {
      if (S.selecting) return toggleSelect(g.messages);
      if (g.messages.length > 1) openThread(g);
      else openReader(m);
    },
    onLong: selectable ? () => toggleSelect(g.messages) : null,
    swipe: swipe
      ? { right: () => setSeen(g.messages, unread), left: () => back.run() }
      : null,
    onSwipeMove: (dx) => { wrap.dataset.dir = dx > 0 ? 'right' : 'left'; },
    onSwipeEnd: () => { delete wrap.dataset.dir; }
  });
  return wrap;
}

function simpleRow({ from, subject, meta, metaClass, time, trailing, onTap, onLong }) {
  const el = h(
    'div',
    { class: 'row', role: 'button', tabindex: '0' },
    h('div', { class: 'dot' }),
    h('span', { class: 'check' }),
    h(
      'div',
      { class: 'main' },
      h('div', { class: 'top' }, h('div', { class: 'from' }, from)),
      h('div', { class: 'subject' }, subject || '（无主题）'),
      meta ? h('div', { class: `meta ${metaClass || ''}` }, meta) : null
    ),
    h('div', { class: 'side' }, time ? h('span', { class: 'time' }, time) : null, trailing || null)
  );
  attachGestures(el, { onTap, onLong, swipe: null });
  return el;
}

function draftRow(d) {
  return simpleRow({
    from: '草稿',
    subject: d.subject,
    time: fmtTime(d.updatedAt),
    trailing: d.attachmentCount ? ic('clip', 15) : null,
    onTap: async () => {
      try {
        const draft = await S.api.drafts.get(d.id);
        if (draft) openCompose({ kind: 'draft', draft, accountId: d.accountId });
      } catch (err) {
        toast(err && err.message ? err.message : '无法打开草稿');
      }
    },
    onLong: () =>
      actionSheet(d.subject || '草稿', [
        {
          label: '删除草稿',
          icon: 'trash',
          danger: true,
          run: async () => {
            try {
              await S.api.drafts.remove(d.id);
              S.drafts = S.drafts.filter((x) => x.id !== d.id);
              renderList();
              refreshAccounts(true);
            } catch (err) {
              toast(err && err.message ? err.message : '删除失败');
            }
          }
        }
      ])
  });
}

function scheduledRow(d) {
  const failed = Boolean(d.lastError);
  const open = () =>
    actionSheet(d.subject || '定时邮件', [
      {
        label: '立即发送',
        icon: 'send',
        run: async () => {
          try {
            await S.api.scheduled.sendNow(d.id);
            toast('已发送');
          } catch (err) {
            toast(err && err.message ? err.message : '发送失败');
          }
          loadView({ reset: true, soft: true });
          refreshAccounts(true);
        }
      },
      {
        label: '编辑',
        icon: 'file',
        run: async () => {
          try {
            const draft = await S.api.drafts.get(d.id);
            if (draft) openCompose({ kind: 'draft', draft, accountId: d.accountId });
          } catch (err) {
            toast(err && err.message ? err.message : '无法打开');
          }
        }
      },
      {
        label: '取消定时（转为草稿）',
        icon: 'close',
        danger: true,
        run: async () => {
          try {
            await S.api.scheduled.cancel(d.id);
            toast('已取消，邮件保留在草稿');
          } catch (err) {
            toast(err && err.message ? err.message : '取消失败');
          }
          loadView({ reset: true, soft: true });
          refreshAccounts(true);
        }
      }
    ]);
  const meta = failed ? `发送失败：${d.lastError}` : `将于 ${fmtSchedule(d.sendAt)} 发送`;
  const to = String(d.to || '').trim();
  return simpleRow({
    from: to ? `收件人：${to}` : '（无收件人）',
    subject: d.subject,
    meta,
    metaClass: failed ? 'err' : 'sched',
    trailing: ic(failed ? 'alert' : 'clock', 16),
    onTap: open,
    onLong: open
  });
}

function filterChips() {
  const chips = [];
  if (S.unreadOnly) chips.push(h('button', { class: 'pillchip on', type: 'button', onClick: () => { S.unreadOnly = false; renderList(); } }, '仅未读 ×'));
  if (UI.threads) chips.push(h('button', { class: 'pillchip on', type: 'button', onClick: () => { UI.threads = false; saveUi(); S.selected.clear(); S.selecting = false; renderTop(); renderList(); } }, '会话 ×'));
  return chips.length ? h('div', { class: 'chiprow filters' }, chips) : null;
}

function renderList() {
  if (!content) return;
  const parts = [];
  const kind = S.view.kind;
  const special = NO_SELECT.includes(kind);
  if (S.error && (S.messages.length || S.drafts.length || S.scheduled.length)) parts.push(h('div', { class: 'banner' }, ic('alert', 16), h('span', null, S.error)));

  const shown = kind === 'drafts' ? S.drafts : kind === 'scheduled' ? S.scheduled : visibleMessages();
  const chips = special ? null : filterChips();
  if (chips) parts.push(chips);

  if (S.loading && !shown.length) {
    parts.push(h('div', { class: 'skeleton' }, h('i'), h('i')), h('div', { class: 'skeleton' }, h('i'), h('i')), h('div', { class: 'skeleton' }, h('i'), h('i')));
  } else if (S.error && !shown.length) {
    parts.push(h('div', { class: 'empty' }, h('h3', null, '加载失败'), h('p', null, S.error), h('button', { class: 'more', type: 'button', onClick: () => loadView() }, '重试')));
  } else if (!S.accounts.length) {
    parts.push(
      h('div', { class: 'empty' }, h('h3', null, '还没有邮箱'), h('p', null, '添加一个邮箱账户开始使用'), h('button', { class: 'more', type: 'button', onClick: () => openAddAccount() }, '添加账户'))
    );
  } else if (!shown.length) {
    const text =
      { starred: '没有加星标的邮件', archived: '归档里还没有邮件', drafts: '没有草稿', scheduled: '没有定时发送的邮件' }[kind] ||
      (S.unreadOnly && S.messages.length ? '没有未读邮件' : '这里没有邮件');
    parts.push(h('div', { class: 'empty' }, h('h3', null, text)));
  } else if (kind === 'drafts') {
    parts.push(...S.drafts.map(draftRow));
  } else if (kind === 'scheduled') {
    parts.push(...S.scheduled.map(scheduledRow));
  } else {
    parts.push(...buildGroups(shown).map((g) => rowEl(g)));
    if (S.hasMore) {
      parts.push(h('button', { class: 'more', type: 'button', onClick: () => loadView({ reset: false }) }, S.loading ? h('span', { class: 'spinner' }) : '加载更多'));
    } else {
      parts.push(h('div', { style: 'height:96px' }));
    }
  }
  content.replaceChildren(...parts);

  /* With "unread only" on, a page of mostly-read mail can leave the list nearly empty: keep paging, within reason. */
  if (S.unreadOnly && S.hasMore && !S.loading && !special && shown.length < 10 && S.messages.length < 400) {
    setTimeout(() => loadView({ reset: false }), 0);
  }
}

/* ------------------------------------------------------------------ top bar */

function viewTitle() {
  const v = S.view;
  const unread = NO_SELECT.includes(v.kind) ? 0 : S.messages.filter((m) => !m.seen).length;
  return { title: v.title, sub: v.sub || '', unread };
}

function selectedMessages() {
  return S.messages.filter((m) => S.selected.has(keyOf(m)));
}

async function bulk(task) {
  const list = selectedMessages();
  if (!list.length) return;
  const ok = await task(list);
  if (ok !== false) {
    S.selected.clear();
    S.selecting = false;
    renderTop();
    renderList();
  }
}

function renderTop() {
  if (!topbar) return;
  main.classList.toggle('selecting', S.selecting);
  if (S.selecting) {
    const list = selectedMessages();
    const role = list.length ? roleOf(list[0]) : null;
    const allRead = list.every((m) => m.seen);
    const allStar = list.every((m) => m.flagged);
    topbar.replaceChildren(
      iconBtn('close', '取消多选', () => { S.selected.clear(); S.selecting = false; renderTop(); renderList(); }),
      h('div', { class: 'title' }, `已选 ${S.selected.size} 封`),
      iconBtn('mailcheck', allRead ? '标为未读' : '标为已读', () => bulk((l) => setSeen(l, !allRead))),
      iconBtn('star', allStar ? '取消星标' : '加星标', () => bulk((l) => setStar(l, !allStar))),
      role === 'trash'
        ? iconBtn('undo', '还原', () => bulk((l) => restore(l)))
        : iconBtn('archive', role === 'archive' ? '移回收件箱' : '归档', () => bulk((l) => (role === 'archive' ? moveTo(l, 'inbox', '已移回收件箱') : moveTo(l, 'archive', '已归档')))),
      iconBtn('trash', '删除', () => bulk((l) => remove(l)))
    );
    return;
  }
  const { title, sub, unread } = viewTitle();
  topbar.replaceChildren(
    iconBtn('menu', '菜单', openDrawer),
    h('div', { class: 'title' }, title, unread ? h('small', null, `${unread} 未读`) : sub ? h('small', null, sub) : null, S.demo ? h('span', { class: 'demo-tag' }, '演示') : null),
    NO_SELECT.includes(S.view.kind) ? null : iconBtn('search', '搜索', openSearch),
    iconBtn('more', '更多', openMore)
  );
}

function openMore() {
  const v = S.view;
  const plain = !NO_SELECT.includes(v.kind);
  actionSheet('', [
    { label: '刷新', icon: 'refresh', run: () => loadView({ reset: true, soft: true }).then(() => refreshAccounts()) },
    plain ? { label: S.unreadOnly ? '显示全部邮件' : '仅看未读', icon: 'mailcheck', run: () => { S.unreadOnly = !S.unreadOnly; renderList(); } } : null,
    plain
      ? {
          label: UI.threads ? '关闭会话视图' : '会话视图',
          icon: 'layers',
          run: () => { UI.threads = !UI.threads; saveUi(); S.selected.clear(); S.selecting = false; renderTop(); renderList(); }
        }
      : null,
    plain ? { label: '多选', icon: 'check', run: () => { const groups = buildGroups(visibleMessages()); if (groups.length) toggleSelect(groups[0].messages); } } : null,
    v.kind === 'unified' || v.kind === 'folder'
      ? {
          label: '全部标为已读',
          icon: 'mailcheck',
          run: async () => {
            try {
              const targets =
                v.kind === 'folder'
                  ? [{ accountId: v.accountId, path: v.path }]
                  : S.accounts.map((a) => ({ accountId: a.id, path: (a.folders.find((f) => f.role === 'inbox') || {}).path })).filter((t) => t.path);
              for (const t of targets) await S.api.mail.markAllRead(t);
              S.messages.forEach((m) => { m.seen = true; });
              renderList();
              renderTop();
              refreshAccounts(true);
              toast('已全部标为已读');
            } catch (err) {
              toast(err && err.message ? err.message : '操作失败');
            }
          }
        }
      : null,
    { label: '设置', icon: 'sliders', run: openSettings }
  ]);
}

/* ------------------------------------------------------------------ drawer */

let drawerEl = null;

function setView(view) {
  S.view = view;
  S.selected.clear();
  S.selecting = false;
  scroll.scrollTop = 0;
  loadView();
}

function renderDrawer() {
  if (!drawerEl) return;
  const nav = drawerEl.querySelector('.navs');
  const v = S.view;
  const totalUnread = S.accounts.reduce((sum, a) => sum + ((a.folders.find((f) => f.role === 'inbox') || {}).unseen || 0), 0);

  const item = (iconName, label, { active, count, onClick }) =>
    h('button', { class: `navitem${active ? ' active' : ''}`, type: 'button', onClick }, ic(iconName, 20), h('span', { class: 'label' }, label), count ? h('span', { class: 'count' }, count) : null);

  const go = async (view) => {
    await closeTop();
    setView(view);
  };

  const rows = [
    item('layers', '全部收件箱', { active: v.kind === 'unified', count: totalUnread || '', onClick: () => go({ kind: 'unified', title: '收件箱' }) }),
    item('star', '星标', { active: v.kind === 'starred', onClick: () => go({ kind: 'starred', title: '星标' }) }),
    item('archive', '归档', { active: v.kind === 'archived', onClick: () => go({ kind: 'archived', title: '归档' }) }),
    item('clock', '定时发送', { active: v.kind === 'scheduled' && !v.accountId, count: S.scheduledCount || '', onClick: () => go({ kind: 'scheduled', title: '定时发送' }) }),
    h('div', { class: 'navgroup' }, '账户')
  ];

  for (const account of S.accounts) {
    const open = expanded.has(account.id);
    const unseen = (account.folders.find((f) => f.role === 'inbox') || {}).unseen || 0;
    rows.push(
      h(
        'button',
        { class: `navitem${open ? ' open' : ''}`, type: 'button', onClick: () => { open ? expanded.delete(account.id) : expanded.add(account.id); renderDrawer(); } },
        h('i', { class: 'swatch', style: `background:${account.color || '#888'}` }),
        h('span', { class: 'label' }, account.email),
        !open && unseen ? h('span', { class: 'count' }, unseen) : null,
        h('span', { class: 'chev' }, ic('right', 16))
      )
    );
    if (open) {
      const folders = ROLE_ORDER.map((role) => account.folders.find((f) => f.role === role)).filter(Boolean);
      rows.push(
        h(
          'div',
          { class: 'subfolders' },
          folders.map((f) => {
            const active = (v.kind === 'folder' && v.accountId === account.id && v.path === f.path) || (v.kind === 'drafts' && f.role === 'drafts' && v.accountId === account.id);
            const count = f.role === 'drafts' ? account.draftCount || '' : f.role === 'inbox' || f.role === 'junk' ? f.unseen || '' : '';
            return item(FOLDER_ICONS[f.role] || 'inbox', ROLE_LABELS[f.role] || f.name, {
              active,
              count,
              onClick: () =>
                go(
                  f.role === 'drafts'
                    ? { kind: 'drafts', accountId: account.id, title: '草稿', sub: account.email }
                    : { kind: 'folder', accountId: account.id, path: f.path, role: f.role, title: ROLE_LABELS[f.role] || f.name, sub: account.email }
                )
            });
          })
        )
      );
    }
  }
  nav.replaceChildren(...rows);
}

function openDrawer() {
  const scrim = h('div', { class: 'scrim', onClick: () => closeTop() });
  drawerEl = h(
    'aside',
    { class: 'drawer' },
    h('div', { class: 'brand' }, 'Dymail'),
    h('nav', { class: 'navs' }),
    h(
      'div',
      { class: 'foot' },
      h('button', { class: 'navitem', type: 'button', onClick: async () => { await closeTop(); openSettings(); } }, ic('sliders', 20), h('span', { class: 'label' }, '设置')),
      h('button', { class: 'navitem', type: 'button', onClick: async () => { await closeTop(); openAddAccount(); } }, ic('plus', 20), h('span', { class: 'label' }, '添加账户'))
    )
  );
  renderDrawer();
  openLayer([scrim, drawerEl], () => { drawerEl = null; });
}

/* ------------------------------------------------------------------ search */

function openSearch() {
  let timer = 0;
  let seq = 0;
  openPage((page) => {
    const input = h('input', { type: 'search', placeholder: '搜索邮件', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'search' });
    const results = h('div', null, h('div', { class: 'hint' }, '搜索发件人、主题或正文'));
    const run = async () => {
      const q = input.value.trim();
      const mine = ++seq;
      if (!q) {
        results.replaceChildren(h('div', { class: 'hint' }, '搜索发件人、主题或正文'));
        return;
      }
      results.replaceChildren(h('div', { class: 'loading' }, h('span', { class: 'spinner' })));
      try {
        const v = S.view;
        const res = await S.api.mail.search({ accountId: v.kind === 'folder' ? v.accountId : undefined, path: v.kind === 'folder' ? v.path : undefined, query: q });
        if (mine !== seq) return;
        const list = (res && res.messages) || [];
        results.replaceChildren(...(list.length ? list.map((m) => rowEl(single(m), { selectable: false, swipe: false })) : [h('div', { class: 'hint' }, `没有找到「${q}」`)]));
      } catch (err) {
        if (mine !== seq) return;
        results.replaceChildren(h('div', { class: 'hint' }, err && err.message ? err.message : '搜索失败'));
      }
    };
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 320); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(timer); run(); input.blur(); } });
    page.append(
      h('div', { class: 'searchbar' }, iconBtn('back', '返回', () => closeTop()), h('div', { class: 'pill' }, ic('search', 18), input)),
      h('div', { class: 'scroll' }, results)
    );
    setTimeout(() => input.focus(), 320);
  });
}

/* ------------------------------------------------------------------ pull to refresh + paging */

function wireScroll() {
  let startY = 0;
  let pulling = false;
  let dist = 0;
  scroll.addEventListener('touchstart', (e) => {
    if (scroll.scrollTop <= 0 && !S.selecting) {
      startY = e.touches[0].clientY;
      pulling = true;
      dist = 0;
    }
  }, { passive: true });
  scroll.addEventListener('touchmove', (e) => {
    if (!pulling) return;
    dist = e.touches[0].clientY - startY;
    if (dist > 0 && scroll.scrollTop <= 0) {
      ptr.style.transition = 'none';
      ptr.style.height = `${Math.min(dist / 2, 56)}px`;
      ptr.textContent = dist / 2 >= 48 ? '松开刷新' : '下拉刷新';
    } else if (dist <= 0) {
      pulling = false;
      ptr.style.height = '0px';
    }
  }, { passive: true });
  scroll.addEventListener('touchend', async () => {
    if (!pulling) return;
    pulling = false;
    ptr.style.transition = '';
    if (dist / 2 >= 48) {
      ptr.style.height = '40px';
      ptr.replaceChildren(h('span', { class: 'spinner' }));
      await Promise.all([loadView({ reset: true, soft: true }), refreshAccounts()]);
    }
    ptr.style.height = '0px';
  });
  scroll.addEventListener('scroll', () => {
    if (S.hasMore && !S.loading && scroll.scrollTop + scroll.clientHeight > scroll.scrollHeight - 400) loadView({ reset: false });
  }, { passive: true });
}

/* ------------------------------------------------------------------ boot */

function buildShell() {
  topbar = h('header', { class: 'topbar' });
  ptr = h('div', { class: 'ptr' });
  content = h('div');
  scroll = h('div', { class: 'scroll' }, ptr, content);
  main = h(
    'section',
    { class: 'screen' },
    topbar,
    scroll,
    h('button', { class: 'fab', type: 'button', onClick: () => openCompose({ kind: 'new' }) }, ic('compose', 20), h('span', null, '新邮件'))
  );
  app.append(main);
  wireScroll();
  initLayers(app);
}

async function boot() {
  const { api, demo } = await getApi();
  S.api = api;
  S.demo = demo;
  try {
    S.info = await api.app.info();
  } catch {
    S.info = {};
  }
  try {
    S.settings = { ...S.settings, ...(await api.settings.get()) };
  } catch {
    /* defaults are fine */
  }
  applyTheme();
  buildShell();
  renderTop();

  await refreshAccounts();
  if (!S.accounts.length) {
    renderList();
    if (!demo) openAddAccount();
  } else {
    await loadView();
  }

  if (typeof api.mail.purgeTrash === 'function') api.mail.purgeTrash().catch(() => {});
  if (typeof api.mail.onPush === 'function') {
    api.mail.onPush(() => {
      refreshAccounts(true);
      if (!S.selecting && layerCount() === 0 && !NO_SELECT.includes(S.view.kind)) loadView({ reset: true, soft: true });
    });
  }
  if (api.scheduled && typeof api.scheduled.onChange === 'function') {
    api.scheduled.onChange(() => {
      refreshAccounts(true);
      if (NO_SELECT.includes(S.view.kind) && layerCount() === 0) loadView({ reset: true, soft: true });
    });
  }

  scheduleUpdateCheck();
  syncBackground(UI.bgInterval);

  setInterval(() => {
    flushPendingUpdate();
    const every = Number(S.settings.refreshSeconds) || 0;
    if (!every || document.hidden || S.selecting || layerCount() > 0 || S.loading) return;
    if (Date.now() - lastSync >= every * 1000) {
      refreshAccounts(true);
      loadView({ reset: true, soft: true });
    }
  }, 15000);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - lastSync > 30000 && layerCount() === 0 && !S.selecting) {
      refreshAccounts(true);
      loadView({ reset: true, soft: true });
    }
  });
}

boot().catch((err) => {
  console.error(err);
  app.replaceChildren(h('div', { class: 'empty' }, h('h3', null, '启动失败'), h('p', null, err && err.message ? err.message : String(err))));
});
