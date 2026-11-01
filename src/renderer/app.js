import { icon } from './icons.js';
import { escapeHtml, buildEmailDocument, htmlToText } from './sanitize.js';

const DEMO = new URLSearchParams(location.search).get('demo') === '1';
const api = DEMO ? (await import('./demo.js')).createDemoApi() : window.dymail;

const PAGE_SIZE = 40;
const UI_KEY = 'dymail.ui.v1';
const ROLE_LABELS = {
  inbox: '收件箱',
  sent: '已发送',
  drafts: '草稿',
  junk: '垃圾邮件',
  trash: '已删除',
  archive: '归档'
};
const ROLE_ICONS = {
  inbox: 'inbox',
  sent: 'sent',
  drafts: 'drafts',
  junk: 'junk',
  trash: 'trash',
  archive: 'archive'
};
const SIDEBAR_ROLES = ['inbox', 'drafts', 'sent', 'junk', 'trash', 'archive'];

const PROVIDERS = [
  {
    id: 'gmail',
    label: 'Gmail',
    imap: { host: 'imap.gmail.com', port: 993, secure: true },
    smtp: { host: 'smtp.gmail.com', port: 465, secure: true },
    hint: '使用应用专用密码'
  },
  {
    id: 'outlook',
    label: 'Outlook',
    imap: { host: 'outlook.office365.com', port: 993, secure: true },
    smtp: { host: 'smtp.office365.com', port: 587, secure: false },
    hint: '需启用 IMAP 与 SMTP'
  },
  {
    id: 'qq',
    label: 'QQ 邮箱',
    imap: { host: 'imap.qq.com', port: 993, secure: true },
    smtp: { host: 'smtp.qq.com', port: 465, secure: true },
    hint: '开启 IMAP 后使用授权码'
  },
  {
    id: '163',
    label: '163 邮箱',
    imap: { host: 'imap.163.com', port: 993, secure: true },
    smtp: { host: 'smtp.163.com', port: 465, secure: true },
    hint: '使用授权码'
  },
  {
    id: '126',
    label: '126 邮箱',
    imap: { host: 'imap.126.com', port: 993, secure: true },
    smtp: { host: 'smtp.126.com', port: 465, secure: true },
    hint: '使用授权码'
  },
  {
    id: 'sina',
    label: '新浪邮箱',
    imap: { host: 'imap.sina.com', port: 993, secure: true },
    smtp: { host: 'smtp.sina.com', port: 465, secure: true },
    hint: '需开启 IMAP'
  },
  {
    id: 'aliyun',
    label: '阿里邮箱',
    imap: { host: 'imap.aliyun.com', port: 993, secure: true },
    smtp: { host: 'smtp.aliyun.com', port: 465, secure: true },
    hint: ''
  },
  {
    id: 'exmail',
    label: '腾讯企业邮',
    imap: { host: 'imap.exmail.qq.com', port: 993, secure: true },
    smtp: { host: 'smtp.exmail.qq.com', port: 465, secure: true },
    hint: ''
  },
  {
    id: 'icloud',
    label: 'iCloud',
    imap: { host: 'imap.mail.me.com', port: 993, secure: true },
    smtp: { host: 'smtp.mail.me.com', port: 587, secure: false },
    hint: '使用应用专用密码'
  },
  {
    id: 'yahoo',
    label: 'Yahoo',
    imap: { host: 'imap.mail.yahoo.com', port: 993, secure: true },
    smtp: { host: 'smtp.mail.yahoo.com', port: 465, secure: true },
    hint: '使用应用密码'
  },
  {
    id: 'custom',
    label: '自定义',
    imap: { host: '', port: 993, secure: true },
    smtp: { host: '', port: 465, secure: true },
    hint: ''
  }
];

const DOMAIN_PROVIDERS = {
  'gmail.com': 'gmail',
  'googlemail.com': 'gmail',
  'outlook.com': 'outlook',
  'hotmail.com': 'outlook',
  'live.com': 'outlook',
  'msn.com': 'outlook',
  'qq.com': 'qq',
  'foxmail.com': 'qq',
  '163.com': '163',
  '126.com': '126',
  'yeah.net': '126',
  'sina.com': 'sina',
  'aliyun.com': 'aliyun',
  'icloud.com': 'icloud',
  'me.com': 'icloud',
  'yahoo.com': 'yahoo',
  'yahoo.co.jp': 'yahoo'
};

const themeMedia = window.matchMedia('(prefers-color-scheme: dark)');
const els = {};
let readerDocToken = 0;
let renderedTheme = null;

const state = {
  info: { platform: 'win32', version: '', packaged: false },
  settings: { theme: 'system', refreshSeconds: 60, signature: '' },
  accounts: [],
  expanded: {},
  savedView: null,
  view: { kind: 'unified' },
  messages: [],
  messagesCursor: null,
  messagesCursors: {},
  total: 0,
  pageCount: 1,
  loading: false,
  loadingMore: false,
  listError: null,
  listErrors: [],
  globalSyncError: null,
  filterUnread: false,
  selectedKey: null,
  reader: null,
  readerLoading: false,
  readerError: null,
  readerRetry: null,
  readerAllowRemote: false,
  readerHasRemote: false,
  drafts: [],
  search: null,
  searchTimer: null,
  searchToken: 0,
  loadToken: 0,
  readToken: 0,
  syncing: false,
  syncingPromise: null,
  refreshTimer: null,
  toastTimer: null,
  compose: null,
  editingAccountId: null,
  accountBusy: false,
  settingsTab: 'accounts',
  generalNoteTimer: null,
  appVersion: '',
  unseenCounts: new Map(),
  updateBusy: false,
  updateOffer: null
};

init().catch((err) => {
  console.error(err);
  toast(err && err.message ? err.message : '启动失败');
});

async function init() {
  cacheElements();
  hydrateIcons();
  bindEvents();
  buildProviderOptions();
  readUi();

  try {
    state.info = await api.app.info();
  } catch {}
  document.body.dataset.platform = state.info.platform || 'win32';
  state.appVersion = state.info.version || '';

  try {
    state.settings = await api.settings.get();
  } catch (err) {
    console.error(err);
  }

  applyTheme();
  updateThemeTiles();
  scheduleRefresh();
  renderSidebar();
  renderHeader();
  state.loading = true;
  renderList();
  renderReaderEmpty('选择邮件');

  await loadBaseAccounts();
  scheduleUpdateCheck();

  if (DEMO) exposeDemoDebug();
}

function scheduleUpdateCheck() {
  if (state.settings.updateCheck === false || !state.settings.updateRepo) return;
  const last = Number(state.settings.updateLastCheck) || 0;
  if (Date.now() - last < 24 * 60 * 60 * 1000) return;
  checkForUpdate({ silent: true });
}

function cacheElements() {
  const ids = [
    'search-input', 'search-clear', 'sidebar-nav', 'compose-btn', 'add-account-btn', 'settings-btn',
    'sync-indicator', 'view-title', 'view-count', 'filter-unread', 'mark-all-read', 'refresh-btn',
    'list-banner', 'list-banner-text', 'message-list', 'list-foot', 'load-more', 'reader-empty',
    'reader-empty-text', 'reader-empty-action', 'reader-view', 'reader-subject', 'reader-avatar',
    'reader-from', 'reader-address', 'reader-date', 'reader-recipients', 'action-star', 'action-unread',
    'action-reply', 'action-reply-all', 'action-forward', 'action-archive', 'action-trash', 'remote-banner',
    'show-images', 'reader-attachments', 'mail-frame', 'reader-loading', 'account-dialog', 'account-form',
    'account-title', 'account-email', 'account-name', 'account-provider', 'account-password', 'account-eye',
    'account-hint', 'account-advanced', 'imap-host', 'imap-port', 'imap-secure', 'smtp-host', 'smtp-port',
    'smtp-secure', 'account-error', 'account-delete', 'account-submit', 'settings-dialog', 'settings-title',
    'settings-accounts', 'settings-add-account', 'refresh-select', 'signature-input', 'general-save',
    'general-note', 'theme-options', 'compose-layer', 'compose', 'compose-title', 'compose-discard',
    'compose-close', 'compose-account', 'compose-to', 'toggle-cc', 'toggle-bcc', 'compose-cc-line',
    'compose-cc', 'compose-bcc-line', 'compose-bcc', 'compose-subject', 'compose-editor-wrap',
    'compose-editor', 'compose-attach', 'compose-attachments', 'compose-send', 'compose-hint',
    'compose-save', 'toast', 'block-remote-input', 'notify-input', 'tray-input', 'update-check-input',
    'update-repo-input', 'update-version', 'update-skipped', 'update-reset-skip', 'update-check-now',
    'update-note', 'update-dialog', 'update-from', 'update-to', 'update-notes', 'update-ignore',
    'update-later', 'update-download'
  ];
  for (const id of ids) {
    const key = id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    els[key] = document.getElementById(id);
  }
}

function hydrateIcons(root = document) {
  for (const node of root.querySelectorAll('[data-icon]')) {
    node.innerHTML = icon(node.dataset.icon);
  }
}

function buildProviderOptions() {
  els.accountProvider.innerHTML = PROVIDERS.map(
    (provider) => `<option value="${escapeHtml(provider.id)}">${escapeHtml(provider.label)}</option>`
  ).join('');
}

/* ------------------------------------------------------------------ */
/* Utilities                                                          */
/* ------------------------------------------------------------------ */

function parseDate(value) {
  if (!value && value !== 0) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pad(number) {
  return String(number).padStart(2, '0');
}

function formatListDate(value) {
  const date = parseDate(value);
  if (!date) return '';
  const now = new Date();
  if (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  ) {
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

function formatFullDate(value) {
  const date = parseDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function formatSize(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function safeColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : '#0b6bcb';
}

function hexToRgba(value, alpha) {
  const hex = safeColor(value).slice(1);
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function avatarStyle(color, alpha = 0.16) {
  const safe = safeColor(color);
  return `background:${hexToRgba(safe, alpha)};color:${safe}`;
}

function initialOf(value) {
  const text = String(value || '').trim();
  return text ? text.slice(0, 1).toUpperCase() : '?';
}

function messageKey(message) {
  return `${message.accountId}|${message.path}|${message.uid}`;
}

function addressLabel(address) {
  if (!address) return '';
  return address.name ? `${address.name} <${address.address}>` : address.address || '';
}

function senderName(message) {
  if (!message || !message.from) return '未知发件人';
  return message.from.name || message.from.address || '未知发件人';
}

function isEditable(target) {
  if (!target || !(target instanceof Element)) return false;
  if (target.closest('input, textarea, select')) return true;
  return target.closest('[contenteditable="true"]') !== null;
}

function accountById(id) {
  return state.accounts.find((account) => account.id === id) || null;
}

function normalizeAccount(account) {
  return {
    ...account,
    folders: Array.isArray(account.folders) ? account.folders : [],
    draftCount: Number(account.draftCount) || 0,
    error: account.error || null
  };
}

function folderOf(account, role) {
  if (!account) return null;
  const folders = account.folders || [];
  const found = folders.find((folder) => folder.role === role);
  if (found) return found;
  if (role === 'inbox') {
    return { role: 'inbox', path: 'INBOX', name: 'INBOX', unseen: null, total: null };
  }
  return null;
}

function folderUnseen(accountId, path) {
  const account = accountById(accountId);
  if (!account) return 0;
  const folder = (account.folders || []).find((item) => item.path === path);
  return Math.max(0, Number(folder && folder.unseen) || 0);
}

function unifiedUnseen() {
  return state.accounts.reduce((total, account) => {
    const inbox = folderOf(account, 'inbox');
    return total + Math.max(0, Number(inbox && inbox.unseen) || 0);
  }, 0);
}

function currentListUnseen() {
  if (state.view.kind === 'unified') return unifiedUnseen();
  if (state.view.kind === 'folder') return folderUnseen(state.view.accountId, state.view.path);
  if (state.view.kind === 'drafts') {
    const account = accountById(state.view.accountId);
    return account ? account.draftCount : 0;
  }
  return 0;
}

function bumpUnseen(accountId, path, delta) {
  const account = accountById(accountId);
  if (!account) return;
  const folder = (account.folders || []).find((item) => item.path === path);
  if (!folder) return;
  const current = Number(folder.unseen);
  if (!Number.isFinite(current) && delta < 0) return;
  folder.unseen = Math.max(0, (Number.isFinite(current) ? current : 0) + delta);
  renderSidebar();
  renderHeader();
}

function adjustDraftCount(accountId, delta) {
  const account = accountById(accountId);
  if (!account) return;
  account.draftCount = Math.max(0, account.draftCount + delta);
  renderSidebar();
  renderHeader();
}

/* ------------------------------------------------------------------ */
/* Views                                                              */
/* ------------------------------------------------------------------ */

function defaultView(account) {
  if (account) {
    const inbox = folderOf(account, 'inbox');
    return {
      kind: 'folder',
      accountId: account.id,
      path: inbox.path,
      role: 'inbox',
      label: ROLE_LABELS.inbox
    };
  }
  if (state.accounts.length >= 2) return { kind: 'unified' };
  const first = state.accounts[0];
  if (first) {
    const inbox = folderOf(first, 'inbox');
    return {
      kind: 'folder',
      accountId: first.id,
      path: inbox.path,
      role: 'inbox',
      label: ROLE_LABELS.inbox
    };
  }
  return null;
}

function normalizeView(view) {
  if (!state.accounts.length) return null;
  if (!view) return defaultView();
  if (view.kind === 'unified') return state.accounts.length >= 2 ? { kind: 'unified' } : defaultView();
  if (view.kind === 'drafts') {
    const account = accountById(view.accountId);
    return account ? { kind: 'drafts', accountId: account.id } : defaultView();
  }
  if (view.kind === 'folder') {
    const account = accountById(view.accountId);
    if (!account) return defaultView();
    const folder = (account.folders || []).find((item) => item.path === view.path);
    if (folder) {
      if (folder.role === 'drafts') return { kind: 'drafts', accountId: account.id };
      return {
        kind: 'folder',
        accountId: account.id,
        path: folder.path,
        role: folder.role,
        label: ROLE_LABELS[folder.role] || folder.name || '邮件'
      };
    }
    if (view.role === 'inbox') {
      return {
        kind: 'folder',
        accountId: account.id,
        path: folderOf(account, 'inbox').path,
        role: 'inbox',
        label: ROLE_LABELS.inbox
      };
    }
    return defaultView(account);
  }
  return defaultView();
}

function sameView(a, b) {
  if (!a || !b) return a === b;
  return a.kind === b.kind && a.accountId === b.accountId && a.path === b.path && a.role === b.role;
}

function viewLabel(view) {
  if (!view) return '邮件';
  if (view.kind === 'unified') return '全部收件箱';
  if (view.kind === 'drafts') return '草稿';
  if (view.kind === 'folder') return ROLE_LABELS[view.role] || view.label || '邮件';
  return '邮件';
}

function viewAccounts() {
  if (state.search) return state.accounts;
  if (state.view.kind === 'folder' || state.view.kind === 'drafts') {
    const account = accountById(state.view.accountId);
    return account ? [account] : [];
  }
  return state.accounts;
}

function navigate(view) {
  const next = normalizeView(view);
  if (!next) {
    openAccountDialog();
    return;
  }
  resetSearchUI(true);
  state.view = next;
  state.selectedKey = null;
  clearReader();
  writeUi();
  renderSidebar();
  renderHeader();
  loadView();
}

function writeUi() {
  try {
    localStorage.setItem(
      UI_KEY,
      JSON.stringify({
        view: state.view,
        expanded: state.expanded,
        filterUnread: state.filterUnread
      })
    );
  } catch {}
}

function readUi() {
  try {
    const saved = JSON.parse(localStorage.getItem(UI_KEY) || '{}');
    if (saved && typeof saved === 'object') {
      if (saved.expanded && typeof saved.expanded === 'object') state.expanded = saved.expanded;
      if (saved.filterUnread) state.filterUnread = true;
      if (saved.view && typeof saved.view === 'object') state.savedView = saved.view;
    }
  } catch {}
}

/* ------------------------------------------------------------------ */
/* Sidebar                                                            */
/* ------------------------------------------------------------------ */

function renderSidebar() {
  const scroller = els.sidebarNav;
  const scrollTop = scroller.scrollTop;
  if (!state.accounts.length) {
    scroller.innerHTML = '';
    return;
  }
  const parts = [];
  if (state.accounts.length >= 2) {
    const count = unifiedUnseen();
    const active = state.view.kind === 'unified';
    parts.push(`
      <button type="button" class="nav-row nav-unified${active ? ' is-active' : ''}" data-nav="unified">
        <span class="nav-icon">${icon('inbox')}</span>
        <span class="nav-label">全部收件箱</span>
        ${count ? `<span class="nav-count">${count}</span>` : ''}
      </button>
    `);
  }

  for (const account of state.accounts) {
    const expanded = state.expanded[account.id] !== false;
    parts.push(`<div class="account-block">
      <button type="button" class="account-row" data-account-toggle="${escapeHtml(account.id)}" title="${escapeHtml(
        account.email + (account.error ? `\n${account.error}` : '')
      )}">
        <span class="account-dot" style="background:${safeColor(account.color)}"></span>
        <span class="account-name">${escapeHtml(account.name || account.email)}</span>
        ${account.error ? '<span class="account-warning"></span>' : ''}
        <span class="account-chevron">${icon(expanded ? 'chevron-down' : 'chevron')}</span>
      </button>
    `);
    if (expanded) {
      parts.push('<div class="folder-list">');
      for (const row of sidebarRows(account)) {
        const active = isFolderActive(account, row.role, row.path);
        parts.push(`
          <button type="button" class="nav-row folder-row${active ? ' is-active' : ''}" data-view-kind="${row.viewKind}" data-account="${escapeHtml(account.id)}"${row.path ? ` data-path="${escapeHtml(row.path)}"` : ''} data-role="${row.role}">
            <span class="nav-icon">${icon(ROLE_ICONS[row.role] || 'inbox')}</span>
            <span class="nav-label">${escapeHtml(ROLE_LABELS[row.role] || row.role)}</span>
            ${row.count ? `<span class="nav-count">${row.count}</span>` : ''}
          </button>
        `);
      }
      parts.push('</div>');
    }
    parts.push('</div>');
  }

  scroller.innerHTML = parts.join('');
  scroller.scrollTop = scrollTop;
}

function sidebarRows(account) {
  const rows = [];
  const inbox = folderOf(account, 'inbox');
  if (inbox) {
    rows.push({
      role: 'inbox',
      path: inbox.path,
      viewKind: 'folder',
      count: Math.max(0, Number(inbox.unseen) || 0)
    });
  }
  rows.push({ role: 'drafts', path: null, viewKind: 'drafts', count: account.draftCount });
  for (const role of ['sent', 'junk', 'trash', 'archive']) {
    if (role === 'drafts') continue;
    const folder = folderOf(account, role);
    if (!folder) continue;
    rows.push({
      role,
      path: folder.path,
      viewKind: 'folder',
      count: Math.max(0, Number(folder.unseen) || 0)
    });
  }
  return rows;
}

function isFolderActive(account, role, path) {
  if (role === 'drafts') {
    return state.view.kind === 'drafts' && state.view.accountId === account.id;
  }
  return (
    state.view.kind === 'folder' &&
    state.view.accountId === account.id &&
    state.view.path === path
  );
}

/* ------------------------------------------------------------------ */
/* Header and list                                                    */
/* ------------------------------------------------------------------ */

function visibleMessages() {
  return state.messages.filter((message) => !state.filterUnread || !message.seen);
}

function renderHeader() {
  const noAccounts = !state.accounts.length;
  let title = '邮件';
  if (!noAccounts) {
    title = state.search ? '搜索结果' : viewLabel(state.view);
  }
  els.viewTitle.textContent = title;

  let countText = '';
  if (!noAccounts) {
    if (state.search) {
      const count = visibleMessages().length;
      if (count) countText = `${count} 封`;
    } else if (state.view.kind === 'drafts') {
      if (state.drafts.length) countText = `${state.drafts.length} 封`;
    } else {
      const count = currentListUnseen();
      if (count) countText = `${count} 封未读`;
    }
  }
  els.viewCount.textContent = countText;

  els.filterUnread.hidden = noAccounts || (state.view.kind === 'drafts' && !state.search);
  els.filterUnread.classList.toggle('is-on', state.filterUnread);
  els.filterUnread.setAttribute('aria-pressed', String(state.filterUnread));
  els.markAllRead.hidden = noAccounts || Boolean(state.search) || state.view.kind !== 'folder';
  els.refreshBtn.hidden = noAccounts;
}

function renderList({ preserveScroll = false } = {}) {
  const scrollTop = preserveScroll ? els.messageList.scrollTop : 0;
  let html = '';

  if (!state.accounts.length) {
    html = emptyListHtml('inbox', '', '添加账户', 'data-add-account');
  } else if (state.loading) {
    html = skeletonHtml();
  } else if (state.listError) {
    html = emptyListHtml('warning', state.listError, '重试', 'data-retry-list');
  } else if (state.search) {
    const list = visibleMessages();
    html = list.length
      ? list.map(renderMessageRow).join('')
      : emptyListHtml('search', '无结果');
  } else if (state.view.kind === 'drafts') {
    html = state.drafts.length
      ? state.drafts.map(renderDraftRow).join('')
      : emptyListHtml('drafts', '无草稿');
  } else {
    const list = visibleMessages();
    if (list.length) {
      html = list.map(renderMessageRow).join('');
    } else {
      html = emptyListHtml(state.filterUnread ? 'unread-dot' : 'inbox', state.filterUnread ? '无未读邮件' : '无邮件');
    }
  }

  els.messageList.innerHTML = html;
  els.messageList.scrollTop = scrollTop;
}

function emptyListHtml(iconName, text, actionLabel = '', actionAttr = '') {
  return `<div class="list-empty">
    <span class="empty-icon">${icon(iconName)}</span>
    ${text ? `<p class="empty-error">${escapeHtml(text)}</p>` : ''}
    ${actionLabel ? `<button type="button" class="btn${actionAttr === 'data-add-account' ? ' primary' : ''}" ${actionAttr}>${escapeHtml(actionLabel)}</button>` : ''}
  </div>`;
}

function skeletonHtml() {
  let html = '';
  for (let i = 0; i < 7; i += 1) {
    html += `<div class="skeleton-row">
      <span class="skeleton-avatar"></span>
      <div class="skeleton-lines">
        <div class="skeleton-line ${i % 2 ? 'medium' : 'short'}"></div>
        <div class="skeleton-line"></div>
      </div>
    </div>`;
  }
  return html;
}

function renderMessageRow(message) {
  const key = messageKey(message);
  const selected = state.selectedKey === key;
  const showAccount = (state.view.kind === 'unified' || Boolean(state.search)) && state.accounts.length > 1;
  const color = safeColor(message.accountColor || (accountById(message.accountId) || {}).color);
  const name = senderName(message);
  return `<div class="msg-row${message.seen ? '' : ' is-unread'}${selected ? ' is-selected' : ''}" data-key="${escapeHtml(key)}" role="option" aria-selected="${selected}">
    <span class="unread-mark"></span>
    <span class="msg-avatar" style="${avatarStyle(color)}">${escapeHtml(initialOf(name))}</span>
    <div class="msg-main">
      <div class="msg-line">
        ${showAccount ? `<span class="msg-acct-dot" style="background:${color}"></span>` : ''}
        <span class="msg-from">${escapeHtml(name)}</span>
        <span class="msg-date">${formatListDate(message.date || message.timestamp)}</span>
      </div>
      <div class="msg-line">
        <span class="msg-subject">${escapeHtml(message.subject || '无主题')}</span>
        ${message.flagged ? `<span class="msg-flag">${icon('star-filled')}</span>` : ''}
      </div>
    </div>
  </div>`;
}

function renderDraftRow(draft) {
  const account = accountById(draft.accountId);
  const color = safeColor(account ? account.color : '');
  const to = String(draft.to || '').trim() || '未填写收件人';
  return `<div class="msg-row is-draft" data-draft-id="${escapeHtml(draft.id)}" role="option">
    <span class="msg-avatar" style="${avatarStyle(color)}">${icon('drafts')}</span>
    <div class="msg-main">
      <div class="msg-line">
        <span class="msg-subject" style="color:var(--text)">${escapeHtml(draft.subject || '无主题')}</span>
        ${draft.attachmentCount ? `<span class="msg-paperclip">${icon('paperclip')}</span>` : ''}
        <span class="msg-date">${formatListDate(draft.updatedAt)}</span>
      </div>
      <div class="msg-line">
        <span class="msg-from" style="font-weight:400;color:var(--text-2)">${escapeHtml(to)}</span>
      </div>
    </div>
    <button type="button" class="icon-btn draft-trash" data-delete-draft="${escapeHtml(draft.id)}" title="删除草稿">${icon('trash')}</button>
  </div>`;
}

function updateFooter() {
  const canLoad =
    !state.search &&
    state.accounts.length > 0 &&
    !state.loading &&
    !state.listError &&
    state.view.kind !== 'drafts' &&
    (state.view.kind === 'unified'
      ? Object.values(state.messagesCursors || {}).some((cursor) => cursor != null)
      : state.messagesCursor != null);
  els.listFoot.hidden = !canLoad;
  els.loadMore.disabled = state.loadingMore;
  els.loadMore.textContent = state.loadingMore ? '加载中…' : '加载更多';
}

function updateListBanner() {
  let text = '';
  let detail = '';
  if (state.listErrors.length) {
    text = `${state.listErrors.length} 个账户加载失败`;
    detail = state.listErrors.map((item) => `${item.accountEmail || ''}：${item.error || ''}`).join('\n');
  } else {
    const failed = viewAccounts().filter((account) => account.error);
    if (failed.length) {
      text = `${failed.length} 个账户未同步`;
      detail = failed.map((account) => `${account.email}：${account.error}`).join('\n');
    } else if (state.globalSyncError) {
      text = '同步失败';
      detail = state.globalSyncError;
    }
  }
  els.listBanner.hidden = !text;
  els.listBannerText.textContent = text;
  els.listBanner.title = detail;
}

/* ------------------------------------------------------------------ */
/* Loading mail                                                       */
/* ------------------------------------------------------------------ */

async function loadView({ preserveReader = false, keepScroll = false } = {}) {
  if (!state.accounts.length) {
    state.loading = false;
    state.messages = [];
    state.drafts = [];
    renderList();
    renderHeader();
    updateFooter();
    if (!preserveReader) clearReader();
    return;
  }
  const token = ++state.loadToken;
  state.loading = true;
  state.listError = null;
  state.listErrors = [];
  state.messages = [];
  state.drafts = [];
  state.messagesCursor = null;
  state.messagesCursors = {};
  state.total = 0;
  state.pageCount = 1;
  if (!keepScroll) els.messageList.scrollTop = 0;
  renderList();
  renderHeader();
  updateListBanner();
  updateFooter();

  try {
    if (state.view.kind === 'drafts') {
      const rows = await api.drafts.list(state.view.accountId || '');
      if (token !== state.loadToken) return;
      state.drafts = Array.isArray(rows) ? rows : [];
      state.loading = false;
      renderList({ preserveScroll: keepScroll });
      renderHeader();
      updateFooter();
      return;
    }

    if (state.view.kind === 'unified') {
      const data = await api.mail.listUnified({ limit: PAGE_SIZE });
      if (token !== state.loadToken) return;
      state.messages = data.messages || [];
      state.messagesCursors = data.cursors || {};
      state.listErrors = data.errors || [];
    } else {
      const data = await api.mail.list({
        accountId: state.view.accountId,
        path: state.view.path,
        limit: PAGE_SIZE
      });
      if (token !== state.loadToken) return;
      state.messages = data.messages || [];
      state.messagesCursor = data.cursor == null ? null : data.cursor;
      state.total = Number(data.total) || 0;
    }

    state.loading = false;
    renderList({ preserveScroll: keepScroll });
    renderHeader();
    updateListBanner();
    updateFooter();
    writeUi();
  } catch (err) {
    if (token !== state.loadToken) return;
    state.loading = false;
    state.listError = err && err.message ? err.message : '加载失败';
    renderList();
    renderHeader();
    updateListBanner();
    updateFooter();
  }
}

async function loadMore() {
  if (state.loading || state.loadingMore || state.search || state.view.kind === 'drafts' || !state.accounts.length) {
    return;
  }
  const token = state.loadToken;
  state.loadingMore = true;
  updateFooter();
  try {
    let incoming = [];
    if (state.view.kind === 'unified') {
      const data = await api.mail.listUnified({
        cursors: state.messagesCursors,
        limit: PAGE_SIZE
      });
      if (token !== state.loadToken) return;
      incoming = data.messages || [];
      state.messagesCursors = data.cursors || {};
      state.listErrors = data.errors || [];
    } else {
      const data = await api.mail.list({
        accountId: state.view.accountId,
        path: state.view.path,
        cursor: state.messagesCursor,
        limit: PAGE_SIZE
      });
      if (token !== state.loadToken) return;
      incoming = data.messages || [];
      state.messagesCursor = data.cursor == null ? null : data.cursor;
      state.total = Number(data.total) || state.total;
    }
    const seen = new Set(state.messages.map(messageKey));
    for (const message of incoming) {
      const key = messageKey(message);
      if (seen.has(key)) continue;
      seen.add(key);
      state.messages.push(message);
    }
    state.pageCount += 1;
    renderList({ preserveScroll: true });
    renderHeader();
    updateListBanner();
  } catch (err) {
    toast(err && err.message ? err.message : '加载失败');
  } finally {
    if (token === state.loadToken) {
      state.loadingMore = false;
      updateFooter();
    }
  }
}

async function silentReloadList() {
  if (
    state.loading ||
    state.loadingMore ||
    state.search ||
    state.view.kind === 'drafts' ||
    !state.accounts.length ||
    state.pageCount !== 1
  ) {
    return;
  }
  const token = state.loadToken;
  try {
    if (state.view.kind === 'unified') {
      const data = await api.mail.listUnified({ limit: PAGE_SIZE });
      if (token !== state.loadToken || state.search) return;
      state.messages = data.messages || [];
      state.messagesCursors = data.cursors || {};
      state.listErrors = data.errors || [];
    } else {
      const data = await api.mail.list({
        accountId: state.view.accountId,
        path: state.view.path,
        limit: PAGE_SIZE
      });
      if (token !== state.loadToken || state.search) return;
      state.messages = data.messages || [];
      state.messagesCursor = data.cursor == null ? null : data.cursor;
      state.total = Number(data.total) || 0;
    }
    renderList({ preserveScroll: true });
    renderHeader();
    updateListBanner();
    updateFooter();
  } catch {}
}

/* ------------------------------------------------------------------ */
/* Syncing accounts                                                   */
/* ------------------------------------------------------------------ */

async function loadBaseAccounts() {
  try {
    const list = await api.accounts.list();
    state.accounts = (Array.isArray(list) ? list : []).map(normalizeAccount);
  } catch (err) {
    toast(err && err.message ? err.message : '无法读取账户');
  }

  renderSidebar();
  renderHeader();

  if (!state.accounts.length) {
    state.loading = false;
    renderList();
    renderHeader();
    renderReaderEmpty('选择邮件');
    window.setTimeout(() => openAccountDialog(), 240);
    return;
  }

  state.view = normalizeView(state.savedView) || defaultView();
  renderSidebar();
  renderHeader();
  await refreshAccounts({ manual: false });
  if (!state.accounts.length) return;
  state.view = normalizeView(state.view) || defaultView();
  renderSidebar();
  renderHeader();
  await loadView();
}

function refreshAccounts({ manual = false, force = false } = {}) {
  if (state.syncingPromise) {
    if (!force) return state.syncingPromise;
    return state.syncingPromise.then(() => startAccountSync(manual));
  }
  return startAccountSync(manual);
}

function startAccountSync(manual) {
  if (!state.accounts.length) return Promise.resolve(false);

  state.syncing = true;
  setSyncUi(true);
  const promise = (async () => {
    let succeeded = false;
    try {
      const list = await api.folders.sync();
      state.accounts = (Array.isArray(list) ? list : []).map(normalizeAccount);
      state.globalSyncError = null;
      succeeded = true;
      await detectNewMail();
      const next = normalizeView(state.view);
      if (!next && state.accounts.length) {
        state.view = defaultView();
      } else if (next && !sameView(next, state.view)) {
        state.view = next;
      }
    } catch (err) {
      state.globalSyncError = err && err.message ? err.message : '同步失败';
      if (manual) toast(state.globalSyncError);
    } finally {
      state.syncing = false;
      state.syncingPromise = null;
      setSyncUi(false);
    }
    renderSidebar();
    renderHeader();
    updateListBanner();
    return succeeded;
  })();

  state.syncingPromise = promise;
  return promise;
}

function setSyncUi(active) {
  els.syncIndicator.hidden = !active;
  els.refreshBtn.classList.toggle('is-busy', active);
  els.refreshBtn.disabled = active;
}

async function manualRefresh() {
  if (!state.accounts.length) {
    openAccountDialog();
    return;
  }
  if (state.syncingPromise) {
    await state.syncingPromise;
    return;
  }
  await refreshAccounts({ manual: true });
  if (!state.accounts.length) {
    renderList();
    renderHeader();
    return;
  }
  state.view = normalizeView(state.view) || defaultView();
  renderSidebar();
  renderHeader();
  if (state.search) {
    await runSearch(state.search.query);
  } else {
    await loadView({ preserveReader: true });
  }
}

async function backgroundRefresh() {
  if (state.syncing || state.loading) return;
  await refreshAccounts({ manual: false });
  if (!state.accounts.length) return;
  if (document.hidden) return;
  await silentReloadList();
}

function scheduleRefresh() {
  if (state.refreshTimer) {
    clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }
  const seconds = Number(state.settings.refreshSeconds) || 0;
  if (seconds > 0) {
    state.refreshTimer = setInterval(backgroundRefresh, seconds * 1000);
  }
}

/* ------------------------------------------------------------------ */
/* Search                                                             */
/* ------------------------------------------------------------------ */

function searchScope() {
  if (state.view.kind === 'folder' && state.view.role !== 'drafts') {
    return { kind: 'folder', accountId: state.view.accountId, path: state.view.path };
  }
  return { kind: 'unified' };
}

async function runSearch(query) {
  const text = String(query || '').trim();
  if (!text) {
    clearSearch();
    return;
  }
  if (!state.accounts.length) return;
  const first = !state.search;
  state.search = { query: text, scope: searchScope() };
  if (first) clearSelection();

  const token = ++state.searchToken;
  state.loading = true;
  state.listError = null;
  state.listErrors = [];
  state.messages = [];
  state.pageCount = 1;
  state.messagesCursor = null;
  state.messagesCursors = {};
  renderHeader();
  renderList();
  updateFooter();

  try {
    const scope = state.search.scope;
    const data =
      scope.kind === 'folder'
        ? await api.mail.search({ accountId: scope.accountId, path: scope.path, query: text })
        : await api.mail.search({ query: text });
    if (token !== state.searchToken || !state.search) return;
    state.loading = false;
    state.messages = data.messages || [];
    state.listErrors = data.errors || [];
    renderList();
    renderHeader();
    updateListBanner();
    updateFooter();
  } catch (err) {
    if (token !== state.searchToken || !state.search) return;
    state.loading = false;
    state.listError = err && err.message ? err.message : '搜索失败';
    renderList();
    renderHeader();
    updateListBanner();
    updateFooter();
  }
}

function clearSearch() {
  if (state.searchTimer) {
    clearTimeout(state.searchTimer);
    state.searchTimer = null;
  }
  state.searchToken += 1;
  const hadSearch = Boolean(state.search);
  state.search = null;
  state.listErrors = [];
  els.searchInput.value = '';
  els.searchClear.hidden = true;
  if (!hadSearch) {
    renderHeader();
    return;
  }
  if (!state.accounts.length) {
    state.messages = [];
    renderList();
    renderHeader();
    return;
  }
  loadView({ preserveReader: true });
}

function resetSearchUI(clearInput) {
  if (state.searchTimer) {
    clearTimeout(state.searchTimer);
    state.searchTimer = null;
  }
  state.searchToken += 1;
  state.search = null;
  state.listErrors = [];
  if (clearInput) {
    els.searchInput.value = '';
    els.searchClear.hidden = true;
  }
}

/* ------------------------------------------------------------------ */
/* Reader                                                             */
/* ------------------------------------------------------------------ */

function renderReaderEmpty(text, actionLabel = '') {
  els.readerEmpty.hidden = false;
  els.readerView.hidden = true;
  els.readerLoading.hidden = true;
  els.readerEmptyText.textContent = text;
  const iconHost = els.readerEmpty.querySelector('.empty-icon');
  if (iconHost) iconHost.innerHTML = icon(actionLabel ? 'warning' : 'inbox');
  els.readerEmptyAction.hidden = !actionLabel;
  els.readerEmptyAction.textContent = actionLabel;
}

function showReaderLoading() {
  els.readerEmpty.hidden = true;
  els.readerView.hidden = false;
  els.readerLoading.hidden = false;
  els.readerSubject.textContent = '';
  els.readerFrom.textContent = '';
  els.readerAddress.textContent = '';
  els.readerAddress.hidden = true;
  els.readerDate.textContent = '';
  els.readerRecipients.textContent = '';
  els.readerAvatar.textContent = '';
  els.readerAvatar.removeAttribute('style');
  els.remoteBanner.hidden = true;
  els.readerAttachments.hidden = true;
  els.readerAttachments.innerHTML = '';
  clearReaderFrame();
}

function clearReaderFrame() {
  readerDocToken += 1;
  try {
    els.mailFrame.src = 'about:blank';
  } catch {}
}

async function setReaderDocument(documentText) {
  const token = ++readerDocToken;
  try {
    const url = await api.mail.document(documentText || '');
    if (token !== readerDocToken) return;
    els.mailFrame.src = url;
  } catch (err) {
    if (token !== readerDocToken) return;
    console.error(err);
  }
}

function clearReader() {
  state.reader = null;
  state.readerLoading = false;
  state.readerError = null;
  state.readerRetry = null;
  state.readerAllowRemote = false;
  state.readerHasRemote = false;
  state.readToken += 1;
  clearReaderFrame();
  renderReaderEmpty('选择邮件');
}

function clearSelection() {
  state.selectedKey = null;
  clearReader();
  renderList({ preserveScroll: true });
}

function currentSummary() {
  return state.messages.find((message) => messageKey(message) === state.selectedKey) || null;
}

function currentMailInfo() {
  const summary = currentSummary();
  if (summary) return summary;
  if (state.reader) {
    return {
      accountId: state.reader.accountId,
      path: state.reader.path,
      uid: state.reader.uid,
      seen: state.reader.seen,
      flagged: state.reader.flagged
    };
  }
  return null;
}

async function selectMessage(message, { force = false } = {}) {
  if (!message) return;
  const key = messageKey(message);
  if (!force && state.selectedKey === key && state.reader && !state.readerError) return;

  state.selectedKey = key;
  state.reader = null;
  state.readerError = null;
  state.readerRetry = null;
  state.readerLoading = true;
  state.readerAllowRemote = false;
  state.readerHasRemote = false;
  state.readerLoading = true;
  renderList({ preserveScroll: true });
  showReaderLoading();

  const token = ++state.readToken;
  const wasSeen = Boolean(message.seen);
  try {
    const data = await api.mail.read({
      accountId: message.accountId,
      path: message.path,
      uid: message.uid
    });
    if (token !== state.readToken) return;
    state.reader = data;
    state.readerLoading = false;
    if (data.seen && !wasSeen) {
      message.seen = true;
      bumpUnseen(message.accountId, message.path, -1);
    } else {
      message.seen = Boolean(data.seen);
    }
    if (typeof data.flagged === 'boolean') message.flagged = data.flagged;
    renderReader();
    renderList({ preserveScroll: true });
  } catch (err) {
    if (token !== state.readToken) return;
    state.readerLoading = false;
    state.readerError = err && err.message ? err.message : '无法打开邮件';
    state.readerRetry = message;
    renderReaderEmpty(state.readerError, '重试');
    renderList({ preserveScroll: true });
  }
}

function renderReader() {
  const data = state.reader;
  if (!data) return;
  renderedTheme = resolvedTheme();
  els.readerEmpty.hidden = true;
  els.readerView.hidden = false;
  els.readerLoading.hidden = true;

  els.readerSubject.textContent = data.subject || '无主题';
  const fromName = data.from && (data.from.name || data.from.address) ? data.from.name || data.from.address : '未知发件人';
  const color = safeColor(data.accountColor);
  els.readerFrom.textContent = fromName;
  els.readerAddress.textContent = data.from && data.from.name ? data.from.address : '';
  els.readerAddress.hidden = !els.readerAddress.textContent;
  els.readerDate.textContent = formatFullDate(data.date);
  els.readerAvatar.textContent = initialOf(fromName);
  els.readerAvatar.style.cssText = avatarStyle(color);

  const to = (data.to || []).map(addressLabel).filter(Boolean).join('，');
  const cc = (data.cc || []).map(addressLabel).filter(Boolean).join('，');
  const parts = [];
  if (to) parts.push(`收件人：${to}`);
  if (cc) parts.push(`抄送：${cc}`);
  els.readerRecipients.textContent = parts.join('　');
  els.readerRecipients.title = parts.join('，');

  updateReaderButtons();
  renderAttachments(data.attachments || []);

  try {
    const blockRemote = state.settings.remoteImages === 'block';
    const allowRemote = !blockRemote || state.readerAllowRemote;
    const built = buildEmailDocument({
      html: data.html,
      text: data.text,
      allowRemote,
      theme: renderedTheme
    });
    state.readerHasRemote = built.hasRemote;
    els.remoteBanner.hidden = !blockRemote || !built.hasRemote || state.readerAllowRemote;
    setReaderDocument(built.document);
  } catch (err) {
    console.error(err);
    state.readerHasRemote = false;
    els.remoteBanner.hidden = true;
    setReaderDocument(
      '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body></body></html>'
    );
  }
}

function updateReaderButtons() {
  const data = state.reader;
  if (!data) return;
  const flagged = Boolean(data.flagged);
  const starHost = els.actionStar.querySelector('[data-icon]');
  if (starHost) starHost.innerHTML = icon(flagged ? 'star-filled' : 'star');
  els.actionStar.classList.toggle('star-on', flagged);
  els.actionStar.title = flagged ? '取消星标' : '星标';
  els.actionUnread.title = data.seen ? '标为未读' : '标为已读';

  const account = accountById(data.accountId);
  const archive = folderOf(account, 'archive');
  const inArchive = archive && data.path === archive.path;
  els.actionArchive.hidden = !archive || inArchive;
  const trash = folderOf(account, 'trash');
  const inTrash = trash && data.path === trash.path;
  els.actionTrash.disabled = !trash;
  els.actionTrash.title = inTrash ? '永久删除' : '删除';
}

function renderAttachments(attachments) {
  if (!attachments.length) {
    els.readerAttachments.hidden = true;
    els.readerAttachments.innerHTML = '';
    return;
  }
  els.readerAttachments.hidden = false;
  els.readerAttachments.innerHTML = attachments
    .map(
      (attachment) => `<button type="button" class="attachment-chip" data-attachment-index="${Number(
        attachment.index
      )}" title="保存附件">
        <span class="attachment-name">${escapeHtml(attachment.name || '附件')}</span>
        <span class="attachment-size">${formatSize(attachment.size)}</span>
        <span class="icon-btn">${icon('download')}</span>
      </button>`
    )
    .join('');
}

async function toggleStar() {
  const data = state.reader;
  if (!data) return;
  const next = !data.flagged;
  els.actionStar.disabled = true;
  try {
    await api.mail.setFlags({
      accountId: data.accountId,
      path: data.path,
      uids: [data.uid],
      add: next ? ['\\Flagged'] : [],
      remove: next ? [] : ['\\Flagged']
    });
    data.flagged = next;
    const summary = currentSummary();
    if (summary) summary.flagged = next;
    updateReaderButtons();
    renderList({ preserveScroll: true });
  } catch (err) {
    toast(err && err.message ? err.message : '操作失败');
  } finally {
    els.actionStar.disabled = false;
  }
}

async function toggleUnread() {
  const data = state.reader;
  if (!data) return;
  const wasSeen = Boolean(data.seen);
  const next = !wasSeen;
  els.actionUnread.disabled = true;
  try {
    await api.mail.setFlags({
      accountId: data.accountId,
      path: data.path,
      uids: [data.uid],
      add: next ? [] : ['\\Seen'],
      remove: next ? ['\\Seen'] : []
    });
    data.seen = next;
    const summary = currentSummary();
    if (summary) summary.seen = next;
    bumpUnseen(data.accountId, data.path, wasSeen ? 1 : -1);
    updateReaderButtons();
    renderList({ preserveScroll: true });
  } catch (err) {
    toast(err && err.message ? err.message : '操作失败');
  } finally {
    els.actionUnread.disabled = false;
  }
}

async function archiveCurrent() {
  const data = state.reader;
  if (!data) return;
  const account = accountById(data.accountId);
  const target = folderOf(account, 'archive');
  if (!target) {
    toast('该账户没有归档文件夹');
    return;
  }
  if (data.path === target.path) return;
  await moveCurrent('archive');
}

async function moveCurrent(target) {
  const data = state.reader;
  if (!data) return;
  els.actionArchive.disabled = true;
  els.actionTrash.disabled = true;
  try {
    await api.mail.move({
      accountId: data.accountId,
      path: data.path,
      uid: data.uid,
      target
    });
    afterMessageRemoved(data, target);
  } catch (err) {
    toast(err && err.message ? err.message : '操作失败');
    updateReaderButtons();
  } finally {
    els.actionArchive.disabled = false;
    els.actionTrash.disabled = false;
  }
}

async function deleteCurrent() {
  const data = state.reader;
  if (!data) return;
  const account = accountById(data.accountId);
  const trash = folderOf(account, 'trash');
  const inTrash = trash && data.path === trash.path;
  if (!trash) {
    toast('该账户没有已删除文件夹');
    return;
  }
  if (inTrash) {
    const confirmed = await api.dialog.confirm({
      title: '永久删除',
      message: '永久删除这封邮件？',
      confirmLabel: '删除',
      cancelLabel: '取消',
      danger: true
    });
    if (!confirmed) return;
    try {
      await api.mail.deletePermanent({
        accountId: data.accountId,
        path: data.path,
        uid: data.uid
      });
      afterMessageRemoved(data, null);
    } catch (err) {
      toast(err && err.message ? err.message : '删除失败');
    }
    return;
  }
  await moveCurrent('trash');
}

function afterMessageRemoved(data, target) {
  const account = accountById(data.accountId);
  const targetFolder = target ? folderOf(account, target) : null;
  const wasUnread = !data.seen;
  state.messages = state.messages.filter((message) => messageKey(message) !== messageKey(data));
  if (wasUnread) bumpUnseen(data.accountId, data.path, -1);
  if (wasUnread && targetFolder) bumpUnseen(data.accountId, targetFolder.path, 1);
  clearSelection();
  renderHeader();
  updateFooter();
  window.setTimeout(() => {
    refreshAccounts({ manual: false });
  }, 1400);
}

async function markAllRead() {
  if (state.view.kind !== 'folder' || state.search) return;
  els.markAllRead.disabled = true;
  try {
    await api.mail.markAllRead({
      accountId: state.view.accountId,
      path: state.view.path
    });
    for (const message of state.messages) {
      if (message.path === state.view.path) message.seen = true;
    }
    const account = accountById(state.view.accountId);
    const folder = account && (account.folders || []).find((item) => item.path === state.view.path);
    if (folder) folder.unseen = 0;
    if (state.reader && state.reader.path === state.view.path) {
      state.reader.seen = true;
      updateReaderButtons();
    }
    renderSidebar();
    renderHeader();
    renderList({ preserveScroll: true });
  } catch (err) {
    toast(err && err.message ? err.message : '操作失败');
  } finally {
    els.markAllRead.disabled = false;
  }
}

/* ------------------------------------------------------------------ */
/* Compose                                                            */
/* ------------------------------------------------------------------ */

function signatureBlock() {
  const signature = String(state.settings.signature || '').trim();
  if (!signature) return '';
  return `<div class="dymail-signature">${escapeHtml(signature).replace(/\r?\n/g, '<br>')}</div>`;
}

function quoteBlock(data, kind) {
  const dateText = formatFullDate(data.date);
  const fromText = addressLabel(data.from);
  const toText = (data.to || []).map(addressLabel).filter(Boolean).join('，');
  const bodyText = (data.text && data.text.trim()) || htmlToText(data.html) || '';
  const safeBody = escapeHtml(bodyText).replace(/\r?\n/g, '<br>');
  const header =
    kind === 'forward'
      ? `---------- 转发邮件 ----------<br>发件人：${escapeHtml(fromText)}<br>日期：${escapeHtml(
          dateText
        )}<br>主题：${escapeHtml(data.subject || '')}<br>收件人：${escapeHtml(toText)}<br><br>`
      : `在 ${escapeHtml(dateText)}，${escapeHtml(fromText)} 写道：<br><br>`;
  return `<blockquote>${header}${safeBody}</blockquote>`;
}

function prefixedSubject(kind, subject) {
  const text = String(subject || '').trim();
  if (kind === 'forward') {
    return /^(fwd|fw):/i.test(text) ? text : `Fwd: ${text}`;
  }
  if (kind === 'reply' || kind === 'replyAll') {
    return /^re:/i.test(text) ? text : `Re: ${text}`;
  }
  return text;
}

function composeAccountForView() {
  if (state.view.kind === 'folder' || state.view.kind === 'drafts') {
    const account = accountById(state.view.accountId);
    if (account) return account;
  }
  if (state.reader) {
    const account = accountById(state.reader.accountId);
    if (account) return account;
  }
  return state.accounts[0] || null;
}

function openNewCompose(accountId) {
  if (!state.accounts.length) {
    openAccountDialog();
    return;
  }
  if (state.compose) {
    if (!els.composeTo.value && state.compose.kind === 'new') els.composeTo.focus();
    return;
  }
  const account = accountById(accountId) || composeAccountForView();
  if (!account) return;
  const signature = signatureBlock();
  const html = signature ? `<p><br></p>${signature}` : '';
  openComposeShell({
    accountId: account.id,
    kind: 'new',
    html,
    focus: 'to'
  });
}

function composeFromReader(kind) {
  const data = state.reader;
  if (!data) return;
  const account = accountById(data.accountId);
  const self = account ? account.email.toLowerCase() : '';
  const fromAddress = data.from ? data.from.address.toLowerCase() : '';
  let to = '';
  let cc = '';
  if (kind !== 'forward' && data.from) {
    to = addressLabel(data.from);
  }
  if (kind === 'replyAll') {
    const exclude = new Set([self, fromAddress]);
    const seen = new Set(exclude);
    const others = [];
    for (const item of [...(data.to || []), ...(data.cc || [])]) {
      const address = String(item.address || '').toLowerCase();
      if (!address || seen.has(address)) continue;
      seen.add(address);
      others.push(item);
    }
    cc = others.map(addressLabel).filter(Boolean).join(', ');
  }
  const signature = signatureBlock();
  const quote = quoteBlock(data, kind === 'forward' ? 'forward' : 'reply');
  const html = `${signature ? `<p><br></p>${signature}` : ''}<p><br></p>${quote}`;
  const references = kind === 'forward' ? '' : [data.references, data.messageId].filter(Boolean).join(' ').trim();
  openComposeShell({
    accountId: data.accountId,
    kind,
    to,
    cc,
    subject: prefixedSubject(kind === 'replyAll' ? 'reply' : kind, data.subject),
    html,
    inReplyTo: kind === 'forward' ? '' : data.messageId || '',
    references,
    focus: 'editor'
  });
}

async function openComposeShell(data) {
  if (!state.accounts.length) {
    openAccountDialog();
    return;
  }
  if (state.compose) {
    const closed = await closeCompose({ quiet: true });
    if (!closed) return;
  }
  const account = accountById(data.accountId) || composeAccountForView();
  if (!account) return;

  const compose = {
    id: data.id || null,
    accountId: account.id,
    kind: ['new', 'reply', 'replyAll', 'forward'].includes(data.kind) ? data.kind : 'new',
    to: String(data.to || ''),
    cc: String(data.cc || ''),
    bcc: String(data.bcc || ''),
    subject: String(data.subject || ''),
    html: String(data.html || ''),
    inReplyTo: String(data.inReplyTo || ''),
    references: String(data.references || ''),
    attachments: Array.isArray(data.attachments) ? data.attachments.slice() : [],
    dirty: false,
    saving: false,
    pendingSave: false,
    sending: false,
    detachedDraft: null,
    autosaveTimer: null
  };
  state.compose = compose;

  els.composeTitle.textContent =
    compose.kind === 'reply' ? '回复' : compose.kind === 'replyAll' ? '回复全部' : compose.kind === 'forward' ? '转发' : '新邮件';
  renderComposeAccountOptions();
  els.composeAccount.value = compose.accountId;
  els.composeTo.value = compose.to;
  els.composeCc.value = compose.cc;
  els.composeBcc.value = compose.bcc;
  els.composeSubject.value = compose.subject;
  els.composeCcLine.hidden = !compose.cc;
  els.composeBccLine.hidden = !compose.bcc;
  els.composeEditor.innerHTML = compose.html;
  els.composeHint.textContent = '';
  els.composeSend.disabled = false;
  els.composeSend.textContent = '发送';
  renderComposeAttachments();
  els.composeLayer.hidden = false;

  window.setTimeout(() => {
    if (!state.compose) return;
    if (data.focus === 'editor') {
      focusComposeEditorStart();
    } else if (compose.to) {
      focusComposeEditorStart();
    } else {
      els.composeTo.focus();
    }
  }, 30);
}

function renderComposeAccountOptions() {
  els.composeAccount.innerHTML = state.accounts
    .map((account) => {
      const label = account.name ? `${account.name} · ${account.email}` : account.email;
      return `<option value="${escapeHtml(account.id)}">${escapeHtml(label)}</option>`;
    })
    .join('');
}

function focusComposeEditorStart() {
  els.composeEditor.focus();
  const range = document.createRange();
  range.selectNodeContents(els.composeEditor);
  range.collapse(true);
  const selection = window.getSelection();
  if (!selection) return;
  selection.removeAllRanges();
  selection.addRange(range);
}

function renderComposeAttachments() {
  const compose = state.compose;
  if (!compose) return;
  if (!compose.attachments.length) {
    els.composeAttachments.hidden = true;
    els.composeAttachments.innerHTML = '';
    return;
  }
  els.composeAttachments.hidden = false;
  els.composeAttachments.innerHTML = compose.attachments
    .map(
      (attachment, index) => `<span class="compose-chip">
        <span class="name">${escapeHtml(attachment.name || '附件')}</span>
        <span class="size">${formatSize(attachment.size)}</span>
        <button type="button" class="chip-remove" data-remove-attachment="${index}" title="移除">${icon('close')}</button>
      </span>`
    )
    .join('');
}

function syncComposeFieldValues() {
  const compose = state.compose;
  if (!compose) return;
  compose.to = els.composeTo.value;
  compose.cc = els.composeCc.value;
  compose.bcc = els.composeBcc.value;
  compose.subject = els.composeSubject.value;
  compose.html = els.composeEditor.innerHTML;
}

function composeHasContent(compose) {
  return Boolean(
    compose.to.trim() ||
      compose.cc.trim() ||
      compose.bcc.trim() ||
      compose.subject.trim() ||
      htmlToText(compose.html || '').trim() ||
      compose.attachments.length
  );
}

function scheduleAutosave() {
  const compose = state.compose;
  if (!compose || compose.sending) return;
  compose.dirty = true;
  if (compose.autosaveTimer) clearTimeout(compose.autosaveTimer);
  compose.autosaveTimer = window.setTimeout(() => {
    if (!state.compose) return;
    saveCompose();
  }, 1300);
}

async function saveCompose({ manual = false } = {}) {
  const compose = state.compose;
  if (!compose || compose.sending) return false;
  if (!compose.dirty && !compose.id) {
    if (manual) toast('无内容');
    return true;
  }
  if (compose.saving) {
    compose.pendingSave = true;
    return true;
  }
  syncComposeFieldValues();
  compose.html = sanitizeOutgoingHtml(compose.html);

  if (!composeHasContent(compose)) {
    if (compose.id) {
      const id = compose.id;
      compose.id = null;
      try {
        await api.drafts.remove(id);
        adjustDraftCount(compose.accountId, -1);
        await refreshDraftRows();
      } catch {}
    }
    if (compose.detachedDraft) {
      const detached = compose.detachedDraft;
      compose.detachedDraft = null;
      try {
        await api.drafts.remove(detached.id);
        adjustDraftCount(detached.accountId, -1);
      } catch {}
    }
    compose.dirty = false;
    if (manual) toast('无内容');
    return true;
  }

  compose.saving = true;
  els.composeHint.textContent = '';
  try {
    const result = await api.drafts.save({
      id: compose.id || undefined,
      accountId: compose.accountId,
      kind: compose.kind,
      to: compose.to,
      cc: compose.cc,
      bcc: compose.bcc,
      subject: compose.subject,
      html: compose.html,
      inReplyTo: compose.inReplyTo,
      references: compose.references,
      attachments: compose.attachments.map(({ name, path, size }) => ({ name, path, size }))
    });
    if (!compose.id && result && result.id) {
      compose.id = result.id;
      adjustDraftCount(compose.accountId, 1);
    }
    if (compose.detachedDraft) {
      const detached = compose.detachedDraft;
      compose.detachedDraft = null;
      try {
        await api.drafts.remove(detached.id);
        adjustDraftCount(detached.accountId, -1);
      } catch {}
    }
    compose.dirty = false;
    if (manual) toast('草稿已保存');
    await refreshDraftRows();
    return true;
  } catch (err) {
    els.composeHint.textContent = '草稿未保存';
    if (manual) toast(err && err.message ? err.message : '保存失败');
    return false;
  } finally {
    compose.saving = false;
    if (compose.pendingSave) {
      compose.pendingSave = false;
      scheduleAutosave();
    }
  }
}

function sanitizeOutgoingHtml(html) {
  try {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    for (const element of doc.querySelectorAll(
      'script, iframe, frame, object, embed, link, meta, style, form, input, textarea, select, button, svg, math'
    )) {
      element.remove();
    }
    for (const element of doc.querySelectorAll('*')) {
      for (const attribute of [...element.attributes]) {
        const name = attribute.name.toLowerCase();
        if (name.startsWith('on') || name === 'srcdoc' || name === 'formaction' || name === 'ping') {
          element.removeAttribute(attribute.name);
        }
        if (
          (name === 'href' || name === 'src') &&
          /^\s*(javascript:|vbscript:)/i.test(attribute.value)
        ) {
          element.removeAttribute(attribute.name);
        }
      }
      if (element.tagName === 'A') {
        element.setAttribute('target', '_blank');
        element.setAttribute('rel', 'noopener noreferrer');
      }
    }
    return doc.body ? doc.body.innerHTML : '';
  } catch {
    return '';
  }
}

async function refreshDraftRows() {
  if (state.view.kind !== 'drafts' || state.search) return;
  try {
    state.drafts = await api.drafts.list(state.view.accountId || '');
    renderList({ preserveScroll: true });
    renderHeader();
  } catch {}
}

async function closeCompose({ quiet = false } = {}) {
  const compose = state.compose;
  if (!compose) return true;
  if (compose.sending) return false;
  if (compose.autosaveTimer) {
    clearTimeout(compose.autosaveTimer);
    compose.autosaveTimer = null;
  }
  if (compose.dirty) {
    const ok = await saveCompose({ manual: false });
    if (!ok) {
      if (!quiet) toast('草稿未保存');
      return false;
    }
  }
  hideComposeUi();
  if (state.view.kind === 'drafts') await refreshDraftRows();
  return true;
}

async function sendCompose() {
  const compose = state.compose;
  if (!compose || compose.sending) return;
  if (compose.autosaveTimer) {
    clearTimeout(compose.autosaveTimer);
    compose.autosaveTimer = null;
  }
  syncComposeFieldValues();
  if (!compose.to.trim()) {
    toast('请填写收件人');
    els.composeTo.focus();
    return;
  }
  const totalBytes = compose.attachments.reduce((sum, item) => sum + (Number(item.size) || 0), 0);
  if (totalBytes > 25 * 1024 * 1024) {
    toast('附件总大小不能超过 25 MB');
    return;
  }

  compose.sending = true;
  els.composeSend.disabled = true;
  els.composeSend.textContent = '发送中…';
  els.composeHint.textContent = '';
  try {
    const html = sanitizeOutgoingHtml(compose.html);
    const result = await api.compose.send({
      accountId: compose.accountId,
      to: compose.to,
      cc: compose.cc,
      bcc: compose.bcc,
      subject: compose.subject,
      html,
      text: htmlToText(html),
      inReplyTo: compose.inReplyTo,
      references: compose.references,
      attachments: compose.attachments.map(({ name, path, size }) => ({ name, path, size }))
    });

    if (compose.id) {
      const id = compose.id;
      compose.id = null;
      try {
        await api.drafts.remove(id);
        adjustDraftCount(compose.accountId, -1);
      } catch {}
    }
    if (compose.detachedDraft) {
      const detached = compose.detachedDraft;
      compose.detachedDraft = null;
      try {
        await api.drafts.remove(detached.id);
        adjustDraftCount(detached.accountId, -1);
      } catch {}
    }

    const viewKind = state.view.kind;
    const viewRole = state.view.role;
    hideComposeUi();
    toast(result && result.warning ? result.warning : '已发送');
    if (viewKind === 'drafts') await refreshDraftRows();
    await refreshAccounts({ manual: false });
    if (viewKind === 'folder' && viewRole === 'sent') {
      await loadView({ preserveReader: true });
    }
  } catch (err) {
    compose.sending = false;
    els.composeSend.disabled = false;
    els.composeSend.textContent = '发送';
    toast(err && err.message ? err.message : '发送失败');
  }
}

function hideComposeUi() {
  const compose = state.compose;
  if (compose && compose.autosaveTimer) clearTimeout(compose.autosaveTimer);
  state.compose = null;
  els.composeLayer.hidden = true;
  els.composeEditor.innerHTML = '';
  els.composeAttachments.innerHTML = '';
  els.composeAttachments.hidden = true;
  els.composeHint.textContent = '';
}

async function discardCompose() {
  const compose = state.compose;
  if (!compose || compose.sending) return;
  const confirmed = await api.dialog.confirm({
    title: '删除草稿',
    message: '删除当前草稿？',
    confirmLabel: '删除',
    cancelLabel: '取消',
    danger: true
  });
  if (!confirmed) return;
  if (compose.autosaveTimer) {
    clearTimeout(compose.autosaveTimer);
    compose.autosaveTimer = null;
  }
  try {
    if (compose.id) {
      await api.drafts.remove(compose.id);
      adjustDraftCount(compose.accountId, -1);
    }
    if (compose.detachedDraft) {
      await api.drafts.remove(compose.detachedDraft.id);
      adjustDraftCount(compose.detachedDraft.accountId, -1);
    }
  } catch (err) {
    toast(err && err.message ? err.message : '删除失败');
    return;
  }
  hideComposeUi();
  if (state.view.kind === 'drafts') await refreshDraftRows();
}

async function openDraft(id) {
  if (state.compose) {
    const closed = await closeCompose({ quiet: true });
    if (!closed) return;
  }
  try {
    const draft = await api.drafts.get(id);
    if (!draft) throw new Error('草稿不存在');
    if (!accountById(draft.accountId)) throw new Error('账户不存在');
    await openComposeShell({
      id: draft.id,
      accountId: draft.accountId,
      kind: draft.kind,
      to: draft.to,
      cc: draft.cc,
      bcc: draft.bcc,
      subject: draft.subject,
      html: draft.html,
      inReplyTo: draft.inReplyTo,
      references: draft.references,
      attachments: draft.attachments,
      focus: 'editor'
    });
  } catch (err) {
    toast(err && err.message ? err.message : '无法打开草稿');
    if (state.view.kind === 'drafts') loadView();
  }
}

async function deleteDraftById(id) {
  const draft = state.drafts.find((item) => item.id === id);
  const confirmed = await api.dialog.confirm({
    title: '删除草稿',
    message: '删除这封草稿？',
    confirmLabel: '删除',
    cancelLabel: '取消',
    danger: true
  });
  if (!confirmed) return;
  try {
    await api.drafts.remove(id);
    if (draft) adjustDraftCount(draft.accountId, -1);
    state.drafts = state.drafts.filter((item) => item.id !== id);
    if (state.compose && state.compose.id === id) state.compose.id = null;
    if (state.compose && state.compose.detachedDraft && state.compose.detachedDraft.id === id) {
      state.compose.detachedDraft = null;
    }
    renderList({ preserveScroll: true });
    renderHeader();
  } catch (err) {
    toast(err && err.message ? err.message : '删除失败');
  }
}

async function changeComposeAccount(accountId) {
  const compose = state.compose;
  if (!compose) return;
  if (!accountById(accountId)) return;
  if (compose.accountId === accountId) return;
  if (compose.id) {
    compose.detachedDraft = { id: compose.id, accountId: compose.accountId };
    compose.id = null;
  }
  compose.accountId = accountId;
  compose.dirty = true;
  scheduleAutosave();
}

async function addComposeAttachments() {
  const compose = state.compose;
  if (!compose) return;
  try {
    const files = await api.files.pick();
    if (!Array.isArray(files) || !files.length) return;
    const known = new Set(compose.attachments.map((item) => item.path));
    let total = compose.attachments.reduce((sum, item) => sum + (Number(item.size) || 0), 0);
    for (const file of files) {
      if (!file || !file.path || known.has(file.path)) continue;
      total += Number(file.size) || 0;
      if (total > 25 * 1024 * 1024) {
        toast('附件总大小不能超过 25 MB');
        break;
      }
      compose.attachments.push({ name: file.name, path: file.path, size: file.size });
      known.add(file.path);
    }
    renderComposeAttachments();
    scheduleAutosave();
  } catch (err) {
    toast(err && err.message ? err.message : '无法添加附件');
  }
}

/* ------------------------------------------------------------------ */
/* Account dialog                                                     */
/* ------------------------------------------------------------------ */

function providerById(id) {
  return PROVIDERS.find((provider) => provider.id === id) || PROVIDERS[PROVIDERS.length - 1];
}

function providerIdForAccount(account) {
  const host = String(account.imap && account.imap.host ? account.imap.host : '').toLowerCase();
  const match = PROVIDERS.find(
    (provider) => provider.id !== 'custom' && provider.imap.host.toLowerCase() === host
  );
  return match ? match.id : 'custom';
}

function setServerFields(imap, smtp) {
  els.imapHost.value = imap.host || '';
  els.imapPort.value = imap.port || '';
  els.imapSecure.checked = imap.secure !== false;
  els.smtpHost.value = smtp.host || '';
  els.smtpPort.value = smtp.port || '';
  els.smtpSecure.checked = smtp.secure !== false;
}

function applyProviderToForm(provider, { fillServers = true } = {}) {
  if (fillServers && provider.id !== 'custom') {
    setServerFields(provider.imap, provider.smtp);
  }
  els.accountHint.textContent = provider.hint || '';
  if (provider.id === 'custom') els.accountAdvanced.open = true;
}

function setAccountBusy(busy) {
  state.accountBusy = busy;
  els.accountSubmit.disabled = busy;
  els.accountSubmit.textContent = busy ? '正在验证…' : '保存';
  els.accountDelete.disabled = busy;
  for (const button of document.querySelectorAll('[data-close="account"]')) {
    button.disabled = busy;
  }
}

function accountError(message) {
  const text = String(message || '');
  els.accountError.textContent = text;
  els.accountError.hidden = !text;
  if (text) els.accountError.scrollIntoView({ block: 'nearest' });
}

function openAccountDialog(accountId) {
  const account = accountId ? accountById(accountId) : null;
  state.editingAccountId = account ? account.id : null;
  els.accountTitle.textContent = account ? '编辑账户' : '添加账户';
  els.accountEmail.value = account ? account.email : '';
  els.accountName.value = account ? account.name || '' : '';
  els.accountPassword.value = '';
  els.accountPassword.type = 'password';
  els.accountEye.innerHTML = icon('eye');
  els.accountEye.title = '显示密码';
  els.accountPassword.placeholder = account ? '留空则不修改' : '密码或授权码';
  els.accountDelete.hidden = !account;
  els.accountError.hidden = true;
  els.accountError.textContent = '';
  els.accountAdvanced.open = false;

  const providerId = account ? providerIdForAccount(account) : 'custom';
  els.accountProvider.value = providerId;
  if (account) {
    setServerFields(account.imap, account.smtp);
    els.accountHint.textContent = providerById(providerId).hint || '';
  } else {
    const provider = providerById('custom');
    setServerFields({ host: '', port: '', secure: true }, { host: '', port: '', secure: true });
    applyProviderToForm(provider, { fillServers: false });
  }

  setAccountBusy(false);
  if (els.accountDialog.open) els.accountDialog.close();
  els.accountDialog.showModal();
  window.setTimeout(() => {
    if (account) els.accountName.focus();
    else els.accountEmail.focus();
  }, 30);
}

function closeAccountDialog() {
  if (state.accountBusy) return;
  els.accountDialog.close();
  state.editingAccountId = null;
}

function gatherAccountForm() {
  const email = els.accountEmail.value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('邮箱地址格式不正确');
  const imapHost = els.imapHost.value.trim();
  const smtpHost = els.smtpHost.value.trim();
  if (!imapHost) throw new Error('请填写 IMAP 服务器地址');
  if (!smtpHost) throw new Error('请填写 SMTP 服务器地址');
  const imapPort = Number(els.imapPort.value);
  const smtpPort = Number(els.smtpPort.value);
  if (!Number.isInteger(imapPort) || imapPort < 1 || imapPort > 65535) throw new Error('IMAP 端口无效');
  if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) throw new Error('SMTP 端口无效');
  const password = els.accountPassword.value;
  const existing = state.editingAccountId ? accountById(state.editingAccountId) : null;
  if (!password && !(existing && existing.hasPassword)) throw new Error('请输入密码或授权码');
  return {
    id: state.editingAccountId || undefined,
    email,
    name: els.accountName.value.trim(),
    password: password || undefined,
    imap: { host: imapHost, port: imapPort, secure: els.imapSecure.checked },
    smtp: { host: smtpHost, port: smtpPort, secure: els.smtpSecure.checked }
  };
}

async function submitAccountForm() {
  if (state.accountBusy) return;
  accountError('');
  let payload;
  try {
    payload = gatherAccountForm();
  } catch (err) {
    accountError(err.message);
    return;
  }
  setAccountBusy(true);
  try {
    const saved = await api.accounts.save(payload);
    setAccountBusy(false);
    els.accountDialog.close();
    state.editingAccountId = null;
    if (saved && saved.id && !state.accounts.some((item) => item.id === saved.id)) {
      state.accounts = [...state.accounts, normalizeAccount(saved)];
      renderSidebar();
      renderHeader();
    }
    await reloadAfterAccountChange();
  } catch (err) {
    setAccountBusy(false);
    accountError(err && err.message ? err.message : '保存失败');
  }
}

async function deleteEditingAccount() {
  const id = state.editingAccountId;
  if (!id || state.accountBusy) return;
  const account = accountById(id);
  if (!account) return;
  const confirmed = await api.dialog.confirm({
    title: '删除账户',
    message: `删除 ${account.email}？`,
    detail: '本地草稿也会被删除。',
    confirmLabel: '删除',
    cancelLabel: '取消',
    danger: true
  });
  if (!confirmed) return;
  setAccountBusy(true);
  try {
    await api.accounts.remove(id);
    setAccountBusy(false);
    els.accountDialog.close();
    state.editingAccountId = null;
    await reloadAfterAccountChange();
  } catch (err) {
    setAccountBusy(false);
    accountError(err && err.message ? err.message : '删除失败');
  }
}

async function removeAccountById(id) {
  const account = accountById(id);
  if (!account) return;
  const confirmed = await api.dialog.confirm({
    title: '删除账户',
    message: `删除 ${account.email}？`,
    detail: '本地草稿也会被删除。',
    confirmLabel: '删除',
    cancelLabel: '取消',
    danger: true
  });
  if (!confirmed) return;
  if (state.compose && state.compose.accountId === id) hideComposeUi();
  try {
    await api.accounts.remove(id);
    await reloadAfterAccountChange();
  } catch (err) {
    toast(err && err.message ? err.message : '删除失败');
  }
}

async function reloadAfterAccountChange() {
  await refreshAccounts({ manual: false, force: true });
  const next = normalizeView(state.view) || defaultView();
  const changed = !sameView(next, state.view);
  state.view = next;
  if (!state.accounts.length) {
    resetSearchUI(true);
    clearSelection();
    renderSidebar();
    renderHeader();
    renderList();
    updateListBanner();
    if (els.settingsDialog.open) renderSettingsAccounts();
    return;
  }
  if (state.search) {
    renderSidebar();
    await runSearch(state.search.query);
  } else {
    if (changed) clearSelection();
    renderSidebar();
    await loadView({ preserveReader: !changed });
  }
  if (els.settingsDialog.open) renderSettingsAccounts();
}

/* ------------------------------------------------------------------ */
/* Settings                                                           */
/* ------------------------------------------------------------------ */

function openSettings(tab = 'accounts') {
  fillGeneralSettings();
  renderSettingsAccounts();
  updateThemeTiles();
  activateSettingsTab(tab);
  if (!els.settingsDialog.open) els.settingsDialog.showModal();
}

function closeSettings() {
  els.settingsDialog.close();
}

function activateSettingsTab(tab) {
  state.settingsTab = tab;
  for (const button of document.querySelectorAll('.settings-tab')) {
    button.classList.toggle('is-active', button.dataset.tab === tab);
  }
  for (const panel of document.querySelectorAll('[data-panel]')) {
    panel.hidden = panel.dataset.panel !== tab;
  }
  const titles = { accounts: '账户', general: '常规', appearance: '外观', update: '更新' };
  els.settingsTitle.textContent = titles[tab] || '设置';
  if (tab === 'update') renderSettingsUpdate();
}

function renderSettingsAccounts() {
  if (!state.accounts.length) {
    els.settingsAccounts.innerHTML = '<div class="settings-accounts-empty">未添加账户</div>';
    return;
  }
  els.settingsAccounts.innerHTML = state.accounts
    .map((account) => {
      const color = safeColor(account.color);
      return `<div class="settings-account">
        <span class="avatar" style="${avatarStyle(color)}">${escapeHtml(initialOf(account.name || account.email))}</span>
        <span class="settings-account-info">
          <span class="settings-account-name">${escapeHtml(account.name || account.email)}</span>
          ${account.name ? `<span class="settings-account-email">${escapeHtml(account.email)}</span>` : ''}
        </span>
        <button type="button" class="icon-btn" data-edit-account="${escapeHtml(account.id)}" title="编辑账户">${icon('edit')}</button>
        <button type="button" class="icon-btn" data-remove-account="${escapeHtml(account.id)}" title="删除账户">${icon('trash')}</button>
      </div>`;
    })
    .join('');
}

function fillGeneralSettings() {
  els.refreshSelect.value = String(state.settings.refreshSeconds);
  els.signatureInput.value = state.settings.signature || '';
  els.blockRemoteInput.checked = state.settings.remoteImages === 'block';
  els.notifyInput.checked = state.settings.notifyNewMail !== false;
  els.trayInput.checked = state.settings.closeToTray !== false;
  els.generalNote.textContent = '';
}

async function saveGeneralSettings() {
  const refreshSeconds = Number(els.refreshSelect.value);
  try {
    state.settings = await api.settings.update({
      refreshSeconds,
      signature: els.signatureInput.value,
      remoteImages: els.blockRemoteInput.checked ? 'block' : 'allow',
      notifyNewMail: els.notifyInput.checked,
      closeToTray: els.trayInput.checked
    });
    rememberUnseen();
    if (state.reader) renderReader();
    scheduleRefresh();
    els.generalNote.textContent = '已保存';
    if (state.generalNoteTimer) clearTimeout(state.generalNoteTimer);
    state.generalNoteTimer = window.setTimeout(() => {
      els.generalNote.textContent = '';
    }, 2000);
  } catch (err) {
    toast(err && err.message ? err.message : '保存失败');
  }
}

/* ------------------------------------------------------------------ */
/* New mail notifications                                             */
/* ------------------------------------------------------------------ */

function inboxUnseen() {
  const entries = new Map();
  for (const account of state.accounts) {
    const inbox = folderOf(account, 'inbox');
    if (!inbox || inbox.unseen == null) continue;
    entries.set(`${account.id}|${inbox.path}`, {
      account,
      path: inbox.path,
      count: Math.max(0, Number(inbox.unseen) || 0)
    });
  }
  return entries;
}

function rememberUnseen() {
  state.unseenCounts = new Map();
  for (const [key, entry] of inboxUnseen()) state.unseenCounts.set(key, entry.count);
}

async function detectNewMail() {
  const current = inboxUnseen();
  const previous = state.unseenCounts;
  state.unseenCounts = new Map();
  for (const [key, entry] of current) state.unseenCounts.set(key, entry.count);

  if (state.settings.notifyNewMail === false) return;
  const events = [];
  for (const [key, entry] of current) {
    if (!previous.has(key)) continue;
    const added = entry.count - previous.get(key);
    if (added > 0) events.push({ ...entry, added });
  }
  for (const event of events.slice(0, 3)) await notifyNewMail(event);
}

async function notifyNewMail({ account, path, added }) {
  let body = added === 1 ? '1 封新邮件' : `${added} 封新邮件`;
  try {
    const data = await api.mail.list({ accountId: account.id, path, limit: 1 });
    const newest = (data.messages || [])[0];
    if (newest) body = [senderName(newest), newest.subject].filter(Boolean).join('：') || body;
  } catch {}
  try {
    await api.app.notify({ title: `${account.name || account.email} · 收件箱`, body });
  } catch (err) {
    console.warn(err);
  }
}

/* ------------------------------------------------------------------ */
/* Update checks                                                      */
/* ------------------------------------------------------------------ */

function renderSettingsUpdate() {
  els.updateVersion.textContent = state.appVersion || '—';
  els.updateCheckInput.checked = state.settings.updateCheck !== false;
  els.updateRepoInput.value = state.settings.updateRepo || '';
  const skipped = state.settings.updateSkipped || '';
  els.updateSkipped.textContent = skipped || '无';
  els.updateResetSkip.hidden = !skipped;
}

function setUpdateNote(message) {
  els.updateNote.textContent = message || '';
}

async function saveUpdateSettings() {
  try {
    state.settings = await api.settings.update({
      updateCheck: els.updateCheckInput.checked,
      updateRepo: els.updateRepoInput.value
    });
    renderSettingsUpdate();
    setUpdateNote('');
    return true;
  } catch (err) {
    toast(err && err.message ? err.message : '保存失败');
    return false;
  }
}

async function checkForUpdate({ silent = false } = {}) {
  if (state.updateBusy) return;
  state.updateBusy = true;
  els.updateCheckNow.disabled = true;
  if (!silent) setUpdateNote('检查中…');
  try {
    if (!silent && !(await saveUpdateSettings())) return;
    const result = await api.update.check();
    state.settings = await api.settings.update({ updateLastCheck: result.checkedAt });
    if (!silent) setUpdateNote(result.hasUpdate ? `最新版本 ${result.latest}` : `已是最新版本`);
    if (result.hasUpdate && result.latest !== state.settings.updateSkipped) showUpdateDialog(result);
  } catch (err) {
    const message = err && err.message ? err.message : '检查更新失败';
    if (silent) console.warn(message);
    else setUpdateNote(message);
  } finally {
    state.updateBusy = false;
    els.updateCheckNow.disabled = false;
  }
}

function showUpdateDialog(result) {
  state.updateOffer = result;
  els.updateFrom.textContent = result.current;
  els.updateTo.textContent = result.latest;
  els.updateNotes.textContent = result.notes || '';
  if (!els.updateDialog.open) els.updateDialog.showModal();
}

async function dismissUpdateDialog(action) {
  const offer = state.updateOffer;
  els.updateDialog.close();
  if (!offer) return;
  try {
    if (action === 'download') await api.app.open(offer.url || offer.page);
    if (action === 'ignore') {
      state.settings = await api.settings.update({ updateSkipped: offer.latest });
      renderSettingsUpdate();
      toast(`不再提示 ${offer.latest}`);
    }
  } catch (err) {
    toast(err && err.message ? err.message : '打开下载页失败');
  }
}

function updateThemeTiles() {
  for (const tile of document.querySelectorAll('[data-theme-choice]')) {
    tile.classList.toggle('is-active', tile.dataset.themeChoice === state.settings.theme);
  }
}

async function setTheme(theme) {
  try {
    state.settings = await api.settings.update({ theme });
    applyTheme();
    updateThemeTiles();
  } catch (err) {
    toast(err && err.message ? err.message : '无法切换主题');
  }
}

function resolvedTheme() {
  if (state.settings.theme === 'dark') return 'dark';
  if (state.settings.theme === 'light') return 'light';
  return themeMedia.matches ? 'dark' : 'light';
}

function applyTheme() {
  const theme = resolvedTheme();
  const changed = document.documentElement.dataset.theme !== theme;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  api.window
    .setChrome({
      color: theme === 'dark' ? '#1d1d20' : '#f5f5f7',
      symbolColor: theme === 'dark' ? '#f2f2f7' : '#3c3c43'
    })
    .catch(() => {});
  if (changed && state.reader) renderReader();
}

/* ------------------------------------------------------------------ */
/* Misc UI                                                            */
/* ------------------------------------------------------------------ */

function toast(message) {
  if (!message) return;
  els.toast.textContent = String(message);
  els.toast.hidden = false;
  if (state.toastTimer) clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => {
    els.toast.hidden = true;
  }, 3800);
}

function moveSelection(delta) {
  const list = visibleMessages();
  if (!list.length) return;
  let index = list.findIndex((message) => messageKey(message) === state.selectedKey);
  if (index < 0) index = delta > 0 ? -1 : list.length;
  const nextIndex = Math.max(0, Math.min(list.length - 1, index + delta));
  const message = list[nextIndex];
  selectMessage(message);
  window.requestAnimationFrame(() => {
    const key = messageKey(message);
    const row = [...els.messageList.querySelectorAll('.msg-row[data-key]')].find(
      (item) => item.dataset.key === key
    );
    if (row) row.scrollIntoView({ block: 'nearest' });
  });
}

/* ------------------------------------------------------------------ */
/* Events                                                             */
/* ------------------------------------------------------------------ */

function bindEvents() {
  els.searchClear.innerHTML = icon('close');
  els.readerEmptyAction.addEventListener('click', () => {
    if (state.readerRetry) {
      selectMessage(state.readerRetry, { force: true });
    } else if (!state.accounts.length) {
      openAccountDialog();
    }
  });

  els.searchInput.addEventListener('input', () => {
    const query = els.searchInput.value.trim();
    els.searchClear.hidden = !query;
    if (state.searchTimer) clearTimeout(state.searchTimer);
    if (!query) {
      if (state.search) clearSearch();
      return;
    }
    state.searchTimer = window.setTimeout(() => {
      runSearch(query);
    }, 480);
  });

  els.searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (state.searchTimer) clearTimeout(state.searchTimer);
      const query = els.searchInput.value.trim();
      if (query) runSearch(query);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      clearSearch();
      els.searchInput.blur();
    }
  });

  els.searchClear.addEventListener('click', () => {
    clearSearch();
    els.searchInput.focus();
  });

  els.composeBtn.addEventListener('click', () => openNewCompose());
  els.addAccountBtn.addEventListener('click', () => openAccountDialog());
  els.settingsBtn.addEventListener('click', () => openSettings());
  els.refreshBtn.addEventListener('click', manualRefresh);
  els.loadMore.addEventListener('click', loadMore);

  els.filterUnread.addEventListener('click', () => {
    state.filterUnread = !state.filterUnread;
    writeUi();
    renderHeader();
    renderList({ preserveScroll: true });
  });

  els.markAllRead.addEventListener('click', markAllRead);

  els.sidebarNav.addEventListener('click', (event) => {
    const unified = event.target.closest('[data-nav="unified"]');
    if (unified) {
      navigate({ kind: 'unified' });
      return;
    }
    const toggle = event.target.closest('[data-account-toggle]');
    if (toggle) {
      const id = toggle.dataset.accountToggle;
      const currentlyExpanded = state.expanded[id] !== false;
      state.expanded[id] = !currentlyExpanded;
      writeUi();
      renderSidebar();
      return;
    }
    const row = event.target.closest('[data-view-kind]');
    if (!row) return;
    if (row.dataset.viewKind === 'drafts') {
      navigate({ kind: 'drafts', accountId: row.dataset.account });
    } else {
      navigate({
        kind: 'folder',
        accountId: row.dataset.account,
        path: row.dataset.path,
        role: row.dataset.role,
        label: ROLE_LABELS[row.dataset.role] || '邮件'
      });
    }
  });

  els.messageList.addEventListener('click', async (event) => {
    const add = event.target.closest('[data-add-account]');
    if (add) {
      openAccountDialog();
      return;
    }
    const retry = event.target.closest('[data-retry-list]');
    if (retry) {
      if (state.search) runSearch(state.search.query);
      else loadView({ preserveReader: true });
      return;
    }
    const deleteDraft = event.target.closest('[data-delete-draft]');
    if (deleteDraft) {
      event.stopPropagation();
      await deleteDraftById(deleteDraft.dataset.deleteDraft);
      return;
    }
    const draftRow = event.target.closest('[data-draft-id]');
    if (draftRow) {
      await openDraft(draftRow.dataset.draftId);
      return;
    }
    const row = event.target.closest('[data-key]');
    if (!row) return;
    const message = state.messages.find((item) => messageKey(item) === row.dataset.key);
    if (message) selectMessage(message);
  });

  let scrollQueued = false;
  els.messageList.addEventListener('scroll', () => {
    if (scrollQueued) return;
    scrollQueued = true;
    window.requestAnimationFrame(() => {
      scrollQueued = false;
      if (state.loading || state.loadingMore || state.search) return;
      const el = els.messageList;
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 180 && !els.listFoot.hidden) {
        loadMore();
      }
    });
  });

  els.showImages.addEventListener('click', () => {
    if (!state.reader) return;
    state.readerAllowRemote = true;
    renderReader();
  });

  els.actionStar.addEventListener('click', toggleStar);
  els.actionUnread.addEventListener('click', toggleUnread);
  els.actionReply.addEventListener('click', () => composeFromReader('reply'));
  els.actionReplyAll.addEventListener('click', () => composeFromReader('replyAll'));
  els.actionForward.addEventListener('click', () => composeFromReader('forward'));
  els.actionArchive.addEventListener('click', archiveCurrent);
  els.actionTrash.addEventListener('click', deleteCurrent);

  els.readerAttachments.addEventListener('click', async (event) => {
    const chip = event.target.closest('[data-attachment-index]');
    if (!chip || !state.reader) return;
    const name = chip.querySelector('.attachment-name');
    chip.disabled = true;
    try {
      const result = await api.mail.saveAttachment({
        accountId: state.reader.accountId,
        path: state.reader.path,
        uid: state.reader.uid,
        index: Number(chip.dataset.attachmentIndex),
        name: name ? name.textContent : ''
      });
      if (result && result.canceled === false) toast('已保存');
    } catch (err) {
      toast(err && err.message ? err.message : '无法保存附件');
    } finally {
      chip.disabled = false;
    }
  });

  bindAccountDialog();
  bindSettingsDialog();
  bindCompose();
  bindKeyboard();
}

function bindAccountDialog() {
  for (const button of document.querySelectorAll('[data-close="account"]')) {
    button.addEventListener('click', closeAccountDialog);
  }
  els.accountDialog.addEventListener('cancel', (event) => {
    if (state.accountBusy) event.preventDefault();
  });
  els.accountDialog.addEventListener('close', () => {
    if (!state.accountBusy) state.editingAccountId = null;
  });

  els.accountForm.addEventListener('submit', (event) => {
    event.preventDefault();
    submitAccountForm();
  });

  els.accountProvider.addEventListener('change', () => {
    const provider = providerById(els.accountProvider.value);
    applyProviderToForm(provider);
  });

  els.accountEmail.addEventListener('blur', () => {
    if (state.editingAccountId) return;
    if (els.accountProvider.value !== 'custom') return;
    if (els.imapHost.value && els.smtpHost.value) return;
    const email = els.accountEmail.value.trim();
    const domain = email.includes('@') ? email.split('@').pop().toLowerCase() : '';
    const providerId = DOMAIN_PROVIDERS[domain];
    if (!providerId) return;
    els.accountProvider.value = providerId;
    const provider = providerById(providerId);
    applyProviderToForm(provider);
  });

  els.accountEye.addEventListener('click', () => {
    const showing = els.accountPassword.type === 'text';
    els.accountPassword.type = showing ? 'password' : 'text';
    els.accountEye.innerHTML = icon(showing ? 'eye' : 'eye-off');
    els.accountEye.title = showing ? '显示密码' : '隐藏密码';
  });

  els.accountDelete.addEventListener('click', deleteEditingAccount);
}

function bindSettingsDialog() {
  for (const button of document.querySelectorAll('[data-close="settings"]')) {
    button.addEventListener('click', closeSettings);
  }
  for (const tab of document.querySelectorAll('.settings-tab')) {
    tab.addEventListener('click', () => activateSettingsTab(tab.dataset.tab));
  }
  els.settingsAddAccount.addEventListener('click', () => openAccountDialog());
  els.generalSave.addEventListener('click', saveGeneralSettings);
  els.updateCheckNow.addEventListener('click', () => checkForUpdate());
  els.updateCheckInput.addEventListener('change', saveUpdateSettings);
  els.updateRepoInput.addEventListener('change', saveUpdateSettings);
  els.updateResetSkip.addEventListener('click', async () => {
    try {
      state.settings = await api.settings.update({ updateSkipped: '' });
      renderSettingsUpdate();
    } catch (err) {
      toast(err && err.message ? err.message : '操作失败');
    }
  });
  els.updateIgnore.addEventListener('click', () => dismissUpdateDialog('ignore'));
  els.updateLater.addEventListener('click', () => dismissUpdateDialog('later'));
  els.updateDownload.addEventListener('click', () => dismissUpdateDialog('download'));
  els.themeOptions.addEventListener('click', (event) => {
    const tile = event.target.closest('[data-theme-choice]');
    if (!tile) return;
    setTheme(tile.dataset.themeChoice);
  });
  els.settingsAccounts.addEventListener('click', async (event) => {
    const edit = event.target.closest('[data-edit-account]');
    if (edit) {
      openAccountDialog(edit.dataset.editAccount);
      return;
    }
    const remove = event.target.closest('[data-remove-account]');
    if (remove) {
      await removeAccountById(remove.dataset.removeAccount);
    }
  });
}

function bindCompose() {
  els.composeClose.addEventListener('click', () => closeCompose());
  els.composeDiscard.addEventListener('click', discardCompose);
  els.composeSend.addEventListener('click', sendCompose);
  els.composeSave.addEventListener('click', () => saveCompose({ manual: true }));
  els.composeAttach.addEventListener('click', addComposeAttachments);
  els.composeAccount.addEventListener('change', () => {
    changeComposeAccount(els.composeAccount.value);
  });

  for (const input of [els.composeTo, els.composeCc, els.composeBcc, els.composeSubject]) {
    input.addEventListener('input', scheduleAutosave);
  }
  els.composeEditor.addEventListener('input', () => {
    scheduleAutosave();
    updateComposeToolbar();
  });
  els.composeEditor.addEventListener('keyup', updateComposeToolbar);
  els.composeEditor.addEventListener('mouseup', updateComposeToolbar);

  document.addEventListener('selectionchange', () => {
    if (state.compose && document.activeElement === els.composeEditor) updateComposeToolbar();
  });

  els.toggleCc.addEventListener('click', () => {
    els.composeCcLine.hidden = !els.composeCcLine.hidden;
    if (!els.composeCcLine.hidden) els.composeCc.focus();
  });
  els.toggleBcc.addEventListener('click', () => {
    els.composeBccLine.hidden = !els.composeBccLine.hidden;
    if (!els.composeBccLine.hidden) els.composeBcc.focus();
  });

  for (const button of document.querySelectorAll('.compose-toolbar [data-cmd]')) {
    button.addEventListener('click', () => {
      if (!state.compose) return;
      document.execCommand(button.dataset.cmd, false, null);
      els.composeEditor.focus();
      updateComposeToolbar();
      scheduleAutosave();
    });
  }

  els.composeAttachments.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-remove-attachment]');
    if (!remove || !state.compose) return;
    state.compose.attachments.splice(Number(remove.dataset.removeAttachment), 1);
    renderComposeAttachments();
    scheduleAutosave();
  });
}

function updateComposeToolbar() {
  for (const button of document.querySelectorAll('.compose-toolbar [data-cmd]')) {
    let active = false;
    try {
      active = document.queryCommandState(button.dataset.cmd);
    } catch {}
    button.classList.toggle('is-on', active);
  }
}

function bindKeyboard() {
  document.addEventListener('keydown', (event) => {
    const dialogOpen = Boolean(document.querySelector('dialog[open]'));
    const editable = isEditable(event.target);

    if (state.compose) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeCompose();
      } else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        sendCompose();
      }
      return;
    }
    if (dialogOpen) return;
    if (event.key === '/' && !editable) {
      event.preventDefault();
      els.searchInput.focus();
      els.searchInput.select();
      return;
    }
    if (event.key === 'Escape') {
      if (state.search) {
        event.preventDefault();
        clearSearch();
      } else if (event.target === els.searchInput) {
        els.searchInput.blur();
      }
      return;
    }
    if (editable) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    switch (event.key) {
      case 'c':
        event.preventDefault();
        openNewCompose();
        break;
      case 'ArrowDown':
      case 'j':
        event.preventDefault();
        moveSelection(1);
        break;
      case 'ArrowUp':
      case 'k':
        event.preventDefault();
        moveSelection(-1);
        break;
      case 'r':
        if (state.reader) {
          event.preventDefault();
          composeFromReader('reply');
        }
        break;
      case 'a':
      case 'e':
        if (state.reader) {
          event.preventDefault();
          archiveCurrent();
        }
        break;
      case 's':
        if (state.reader) {
          event.preventDefault();
          toggleStar();
        }
        break;
      case 'u':
        if (state.reader) {
          event.preventDefault();
          toggleUnread();
        }
        break;
      case 'Delete':
        if (state.reader) {
          event.preventDefault();
          deleteCurrent();
        }
        break;
      default:
        break;
    }
  });

  themeMedia.addEventListener('change', () => {
    if (state.settings.theme === 'system') applyTheme();
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) backgroundRefresh();
  });

  window.addEventListener('unhandledrejection', (event) => {
    console.error(event.reason);
  });
}

/* ------------------------------------------------------------------ */
/* Demo debug hook                                                    */
/* ------------------------------------------------------------------ */

function exposeDemoDebug() {
  window.__dymailDemo = {
    state,
    openSettings,
    openAccount: () => openAccountDialog(),
    setTheme,
    openCompose: () => openNewCompose(),
    selectFirst: () => {
      const message = visibleMessages()[0];
      if (message) selectMessage(message);
    },
    selectSubject: (needle) => {
      const message = state.messages.find((item) => String(item.subject || '').includes(needle));
      if (message) selectMessage(message);
      return Boolean(message);
    },
    openFirstDraft: async () => {
      if (state.view.kind !== 'drafts') {
        const account = state.accounts[0];
        if (account) navigate({ kind: 'drafts', accountId: account.id });
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      if (state.drafts[0]) openDraft(state.drafts[0].id);
    },
    showRemote: () => {
      if (!els.remoteBanner.hidden) els.showImages.click();
    },
    simulateNewMail: async (count = 1) => {
      const account = state.accounts[0];
      const inbox = account ? folderOf(account, 'inbox') : null;
      if (!inbox) return false;
      inbox.unseen = (Number(inbox.unseen) || 0) + count;
      await detectNewMail();
      renderSidebar();
      return true;
    }
  };
}
