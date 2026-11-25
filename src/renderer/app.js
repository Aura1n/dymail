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
    hint: '推荐用 OAuth 授权登录，无需开启两步验证或生成应用专用密码',
    passwordLabel: '应用专用密码',
    strictPasswordFormat: /^[a-z0-9]{16}$/i,
    oauth: 'google',
    oauthLabel: 'Google',
    helpLabel: '如何获取应用专用密码',
    helpUrl: 'https://support.google.com/accounts/answer/185833?hl=zh-Hans'
  },
  {
    id: 'outlook',
    label: 'Outlook',
    imap: { host: 'outlook.office365.com', port: 993, secure: true },
    smtp: { host: 'smtp.office365.com', port: 587, secure: false },
    hint: '推荐用 OAuth 授权登录；微软已停用账号密码登录，企业邮箱必须走 OAuth',
    passwordLabel: '应用专用密码',
    oauth: 'microsoft',
    oauthLabel: 'Microsoft',
    helpLabel: '如何获取应用专用密码',
    helpUrl: 'https://support.microsoft.com/zh-cn/accounts-billing/manage/how-to-get-and-use-app-passwords'
  },
  {
    id: 'qq',
    label: 'QQ 邮箱',
    imap: { host: 'imap.qq.com', port: 993, secure: true },
    smtp: { host: 'smtp.qq.com', port: 465, secure: true },
    hint: '在网页版邮箱开启 IMAP/SMTP 服务后生成授权码',
    passwordLabel: '授权码',
    helpLabel: '如何获取授权码',
    helpUrl: 'https://help.mail.qq.com/detail/106/985'
  },
  {
    id: '163',
    label: '163 邮箱',
    imap: { host: 'imap.163.com', port: 993, secure: true },
    smtp: { host: 'smtp.163.com', port: 465, secure: true },
    hint: '在网页版邮箱开启 IMAP/SMTP 服务后生成授权码',
    passwordLabel: '授权码',
    helpLabel: '如何获取授权码',
    helpUrl: 'http://u.163.com/cyqCpfaYf'
  },
  {
    id: '126',
    label: '126 邮箱',
    imap: { host: 'imap.126.com', port: 993, secure: true },
    smtp: { host: 'smtp.126.com', port: 465, secure: true },
    hint: '在网页版邮箱开启 IMAP/SMTP 服务后生成授权码',
    passwordLabel: '授权码',
    helpLabel: '如何获取授权码',
    helpUrl: 'http://u.163.com/cyqCpfaYf'
  },
  {
    id: 'sina',
    label: '新浪邮箱',
    imap: { host: 'imap.sina.com', port: 993, secure: true },
    smtp: { host: 'smtp.sina.com', port: 465, secure: true },
    hint: '在网页版邮箱开启 IMAP4/SMTP 服务后生成 16 位授权码',
    passwordLabel: '授权码',
    helpLabel: '如何获取授权码',
    helpUrl: 'https://help.sina.com.cn/comquestiondetail/view/1566/'
  },
  {
    id: 'aliyun',
    label: '阿里邮箱',
    imap: { host: 'imap.aliyun.com', port: 993, secure: true },
    smtp: { host: 'smtp.aliyun.com', port: 465, secure: true },
    hint: '默认使用登录密码；开启三方客户端安全密码后填安全密码',
    helpLabel: '客户端配置说明',
    helpUrl: 'https://help.aliyun.com/zh/document_detail/36687.html'
  },
  {
    id: 'exmail',
    label: '腾讯企业邮',
    imap: { host: 'imap.exmail.qq.com', port: 993, secure: true },
    smtp: { host: 'smtp.exmail.qq.com', port: 465, secure: true },
    hint: '开启安全登录后，需在网页版生成客户端专用密码',
    passwordLabel: '客户端专用密码',
    helpLabel: '客户端配置说明',
    helpUrl: 'https://open.work.weixin.qq.com/help2/pc/19886'
  },
  {
    id: 'icloud',
    label: 'iCloud',
    imap: { host: 'imap.mail.me.com', port: 993, secure: true },
    smtp: { host: 'smtp.mail.me.com', port: 587, secure: false },
    hint: '需开启双重认证后，在 Apple 账户里生成 App 专用密码',
    passwordLabel: 'App 专用密码',
    helpLabel: '如何获取 App 专用密码',
    helpUrl: 'https://support.apple.com/zh-cn/102654'
  },
  {
    id: 'yahoo',
    label: 'Yahoo',
    imap: { host: 'imap.mail.yahoo.com', port: 993, secure: true },
    smtp: { host: 'smtp.mail.yahoo.com', port: 465, secure: true },
    hint: '在账户安全页生成应用密码',
    passwordLabel: '应用密码',
    helpLabel: '如何生成应用密码',
    helpUrl: 'https://help.yahoo.com/kb/SLN15241.html'
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
  purgeAttempted: false,
  filterUnread: false,
  threaded: false,
  thread: null,
  threadLoading: false,
  selectedKey: null,
  checked: new Set(),
  lastCheckKey: null,
  contacts: [],
  contactQuery: '',
  selectedContact: null,
  contactEditing: false,
  contactDraft: null,
  contactPickField: null,
  reader: null,
  readerLoading: false,
  readerError: null,
  readerRetry: null,
  readerAllowRemote: false,
  readerHasRemote: false,
  readerDocument: '',
  readerTranslated: false,
  readerTranslating: false,
  readerTranslation: null,
  deeplKeyTouched: false,
  drafts: [],
  scheduled: [],
  selectedScheduleId: null,
  scheduledDetail: null,
  rules: [],
  blacklist: [],
  editingRuleId: null,
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
  /* 'password' | 'oauth2'，以及本次对话框里已经完成的授权票据 */
  accountAuth: 'password',
  oauth: null,
  /* accountId -> { state: connecting|online|offline|error, error } */
  accountStatus: {},
  updateReady: null,
  updateDownloading: false,
  autoLaunch: false,
  settingsTab: 'accounts',
  generalNoteTimer: null,
  appVersion: '',
  unseenCounts: new Map(),
  updateBusy: false,
  updateOffer: null,
  updateTimer: null
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
  scheduleUpdateCheck();
  scheduleRefresh();
  renderSidebar();
  renderHeader();
  state.loading = true;
  renderList();
  renderReaderEmpty('选择邮件');
  loadContacts();
  loadScheduledSummary();

  await loadBaseAccounts();
  subscribeMailPush();
  subscribeMailStatus();
  subscribeScheduled();
  subscribeFilters();
  api.update.onProgress(onUpdateProgress);
  await refreshAccountStatuses();

  if (DEMO) exposeDemoDebug();
}

/* Releases can ship at any moment, so check on every boot and every 6h while
   the app stays open; the old "checked within 24h" gate hid a new version for
   the rest of the day. */
const UPDATE_RECHECK_MS = 6 * 60 * 60 * 1000;

function scheduleUpdateCheck() {
  if (state.updateTimer) {
    clearInterval(state.updateTimer);
    state.updateTimer = null;
  }
  if (state.settings.updateCheck === false || !state.settings.updateRepo) return;
  checkForUpdate({ silent: true });
  state.updateTimer = window.setInterval(() => {
    if (state.settings.updateCheck === false || !state.settings.updateRepo) return;
    checkForUpdate({ silent: true });
  }, UPDATE_RECHECK_MS);
}

function cacheElements() {
  const ids = [
    'search-input', 'search-clear', 'sidebar-nav', 'compose-btn', 'add-account-btn', 'settings-btn',
    'sync-indicator', 'view-title', 'view-count', 'filter-unread', 'mark-all-read', 'refresh-btn',
    'list-banner', 'list-banner-text', 'message-list', 'list-foot', 'load-more', 'reader-empty',
    'reader-empty-text', 'reader-empty-action', 'reader-view', 'reader-subject', 'reader-avatar',
    'reader-from', 'reader-address', 'reader-date', 'reader-recipients', 'action-star', 'action-unread',
    'action-reply', 'action-reply-all', 'action-forward', 'action-archive', 'action-trash', 'remote-banner',
    'action-translate', 'deepl-key-input', 'deepl-key-state',
    'action-restore', 'batch-restore', 'trash-purge-select',
    'show-images', 'reader-attachments', 'mail-frame', 'reader-loading', 'account-dialog', 'account-form',
    'account-title', 'account-email', 'account-name', 'account-provider', 'account-password', 'account-eye',
    'account-password-label', 'account-password-warn', 'account-help', 'account-password-field',
    'account-auth-method', 'account-oauth-panel', 'account-oauth-btn', 'account-oauth-status',
    'account-hint', 'account-advanced', 'imap-host', 'imap-port', 'imap-secure', 'smtp-host', 'smtp-port',
    'smtp-secure', 'account-error', 'account-delete', 'account-submit', 'settings-dialog', 'settings-title',
    'settings-accounts', 'settings-add-account', 'refresh-select', 'signature-input', 'general-save',
    'general-note', 'theme-options', 'compose-layer', 'compose', 'compose-title', 'compose-discard',
    'compose-close', 'compose-account', 'compose-to', 'toggle-cc', 'toggle-bcc', 'compose-cc-line',
    'compose-cc', 'compose-bcc-line', 'compose-bcc', 'compose-subject', 'compose-editor-wrap',
    'compose-editor', 'compose-attach', 'compose-attachments', 'compose-send', 'compose-hint',
    'compose-save', 'toast', 'block-remote-input', 'notify-input', 'tray-input', 'auto-launch-input', 'update-check-input',
    'update-repo-link', 'update-version', 'update-skipped', 'update-reset-skip', 'update-check-now',
    'update-note', 'update-dialog', 'update-from', 'update-to', 'update-notes', 'update-ignore',
    'update-later', 'update-download', 'batch-bar', 'batch-count', 'batch-star', 'batch-unstar',
    'update-progress', 'update-progress-fill', 'update-progress-text', 'update-cancel',
    'batch-read', 'batch-unread', 'batch-archive', 'batch-trash', 'batch-clear', 'contacts-view',
    'contacts-view-list', 'contacts-view-count', 'contact-detail', 'contact-new',
    'contact-pop', 'contact-search', 'contact-pop-list', 'thread-toggle', 'reader-thread',
    'scheduled-detail', 'compose-schedule', 'schedule-dialog', 'schedule-form', 'schedule-at',
    'schedule-note', 'schedule-error', 'schedule-confirm', 'rule-list', 'rule-form', 'rule-name',
    'rule-field', 'rule-value', 'rule-action', 'rule-enabled', 'rule-error', 'rule-new', 'rule-cancel',
    'rule-save', 'blacklist-email', 'blacklist-add', 'blacklist-error', 'blacklist-list',
    'select-all'
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
  if (view && view.kind === 'contacts') return { kind: 'contacts' };
  if (!state.accounts.length) return null;
  if (!view) return defaultView();
  if (view.kind === 'scheduled') return { kind: 'scheduled' };
  if (view.kind === 'unified') return state.accounts.length >= 2 ? { kind: 'unified' } : defaultView();
  if (view.kind === 'starred') return { kind: 'starred' };
  if (view.kind === 'archived') return { kind: 'archived' };
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
  if (view.kind === 'starred') return '星标';
  if (view.kind === 'archived') return '归档';
  if (view.kind === 'drafts') return '草稿';
  if (view.kind === 'scheduled') return '定时发送';
  if (view.kind === 'folder') return ROLE_LABELS[view.role] || view.label || '邮件';
  if (view.kind === 'contacts') return '联系人';
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

async function navigate(view) {
  if (!(await confirmContactDiscard())) return;
  const next = normalizeView(view);
  if (!next) {
    openAccountDialog();
    return;
  }
  resetSearchUI(true);
  state.contactQuery = '';
  state.contactEditing = false;
  state.contactDraft = null;
  state.view = next;
  state.selectedKey = null;
  state.thread = null;
  state.threadLoading = false;
  state.selectedScheduleId = null;
  state.scheduledDetail = null;
  clearChecks();
  clearReader();
  writeUi();
  renderSidebar();
  renderHeader();
  if (next.kind !== 'contacts') hideContactsWorkspace();
  if (next.kind !== 'scheduled') hideScheduledDetail();
  loadView();
}

function writeUi() {
  try {
    localStorage.setItem(
      UI_KEY,
      JSON.stringify({
        view: state.view,
        expanded: state.expanded,
        filterUnread: state.filterUnread,
        threaded: state.threaded
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
      if (saved.threaded) state.threaded = true;
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
  const group = [];
  if (state.accounts.length >= 2) {
    const count = unifiedUnseen();
    const active = state.view.kind === 'unified';
    group.push(`
      <button type="button" class="nav-row${active ? ' is-active' : ''}" data-nav="unified">
        <span class="nav-icon">${icon('inbox')}</span>
        <span class="nav-label">全部收件箱</span>
        ${count ? `<span class="nav-count">${count}</span>` : ''}
      </button>
    `);
  }
  group.push(`
    <button type="button" class="nav-row${state.view.kind === 'starred' ? ' is-active' : ''}" data-nav="starred">
      <span class="nav-icon">${icon('star')}</span>
      <span class="nav-label">星标</span>
    </button>
  `);
  group.push(`
    <button type="button" class="nav-row${state.view.kind === 'archived' ? ' is-active' : ''}" data-nav="archived">
      <span class="nav-icon">${icon('archive')}</span>
      <span class="nav-label">归档</span>
    </button>
  `);
  group.push(`
    <button type="button" class="nav-row${state.view.kind === 'contacts' ? ' is-active' : ''}" data-nav="contacts">
      <span class="nav-icon">${icon('contacts')}</span>
      <span class="nav-label">联系人</span>
      ${state.contacts.length ? `<span class="nav-count">${state.contacts.length}</span>` : ''}
    </button>
  `);
  group.push(`
    <button type="button" class="nav-row${state.view.kind === 'scheduled' ? ' is-active' : ''}" data-nav="scheduled">
      <span class="nav-icon">${icon('clock')}</span>
      <span class="nav-label">定时发送</span>
      ${state.scheduled.length ? `<span class="nav-count">${state.scheduled.length}</span>` : ''}
    </button>
  `);
  parts.push(group.join(''));

  for (const account of state.accounts) {
    const expanded = state.expanded[account.id] !== false;
    const status = statusInfo(account.id);
    const stateClass = status ? status.state : '';
    parts.push(`<div class="account-block">
      <button type="button" class="account-row" data-account-toggle="${escapeHtml(account.id)}" title="${escapeHtml(
        account.email + (status && status.state === 'error' ? `\n${status.title}` : '')
      )}">
        <span class="account-dot" style="background:${safeColor(account.color)}"></span>
        <span class="account-name">${escapeHtml(account.name || account.email)}</span>
        ${status ? `<span class="account-state is-${escapeHtml(stateClass)}" title="${escapeHtml(status.title)}"></span>` : ''}
        ${status && status.state === 'error' ? `<span class="account-retry" data-retry-account="${escapeHtml(account.id)}" title="重试连接">重试</span>` : ''}
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
  if (state.view.kind === 'contacts') {
    els.viewTitle.textContent = '联系人';
    els.viewCount.textContent = state.contacts.length ? `${state.contacts.length} 位` : '';
    els.filterUnread.hidden = true;
    els.selectAll.hidden = true;
    els.markAllRead.hidden = true;
    els.refreshBtn.hidden = true;
    if (els.threadToggle) els.threadToggle.hidden = true;
    return;
  }
  if (state.view.kind === 'scheduled') {
    els.viewTitle.textContent = '定时发送';
    els.viewCount.textContent = state.scheduled.length ? `${state.scheduled.length} 封` : '';
    els.filterUnread.hidden = true;
    els.selectAll.hidden = true;
    els.markAllRead.hidden = true;
    els.refreshBtn.hidden = false;
    if (els.threadToggle) els.threadToggle.hidden = true;
    return;
  }
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

  const threadable = !noAccounts && !state.search && state.view.kind !== 'drafts';
  if (els.threadToggle) {
    els.threadToggle.hidden = !threadable;
    els.threadToggle.classList.toggle('is-on', state.threaded);
    els.threadToggle.setAttribute('aria-pressed', String(state.threaded));
    els.threadToggle.title = state.threaded ? '退出会话视图' : '会话视图';
  }
  els.filterUnread.hidden = noAccounts || (state.view.kind === 'drafts' && !state.search);
  els.filterUnread.classList.toggle('is-on', state.filterUnread);
  els.filterUnread.setAttribute('aria-pressed', String(state.filterUnread));
  els.selectAll.hidden = noAccounts || state.view.kind === 'drafts' || state.threaded;
  els.markAllRead.hidden = noAccounts || Boolean(state.search) || state.view.kind !== 'folder';
  els.refreshBtn.hidden = noAccounts;
}

function canThreadView() {
  return (
    state.threaded &&
    !state.search &&
    !['drafts', 'scheduled', 'contacts'].includes(state.view.kind)
  );
}

const SUBJECT_PREFIX = /^\s*(?:(?:re|fw|fwd|aw|sv|答复|回复|转发|转寄)\s*[:：]\s*)+/i;

function normalizedSubject(subject) {
  let value = String(subject == null ? '' : subject).replace(/\s+/g, ' ').trim();
  for (let guard = 0; guard < 8; guard += 1) {
    const next = value.replace(SUBJECT_PREFIX, '');
    if (next === value) break;
    value = next;
  }
  return value;
}

function threadKeyOf(message) {
  return `${message.accountId}|${normalizedSubject(message.subject).toLowerCase()}`;
}

function threadGroups() {
  const map = new Map();
  for (const message of state.messages) {
    const subject = normalizedSubject(message.subject);
    if (!subject) {
      map.set(`single:${messageKey(message)}`, {
        key: `single:${messageKey(message)}`,
        subject: message.subject || '无主题',
        messages: [message]
      });
      continue;
    }
    const key = threadKeyOf(message);
    let group = map.get(key);
    if (!group) {
      group = { key, subject, messages: [] };
      map.set(key, group);
    }
    group.messages.push(message);
  }
  const groups = [...map.values()]
    .map((group) => {
      group.messages.sort((a, b) => b.timestamp - a.timestamp || b.seq - a.seq);
      const latest = group.messages[0];
      return {
        ...group,
        latest,
        count: group.messages.length,
        unread: group.messages.some((message) => !message.seen),
        flagged: group.messages.some((message) => message.flagged),
        participants: [...new Set(group.messages.map((message) => senderName(message)))].slice(0, 3)
      };
    })
    .sort((a, b) => b.latest.timestamp - a.latest.timestamp || b.latest.seq - a.latest.seq);
  return state.filterUnread ? groups.filter((group) => group.unread) : groups;
}

function renderThreadRow(group) {
  const key = `thread:${group.key}`;
  const selected = state.selectedKey === key;
  const showAccount =
    (state.view.kind === 'unified' || state.view.kind === 'starred' || state.view.kind === 'archived') &&
    state.accounts.length > 1;
  const color = safeColor(group.latest.accountColor || (accountById(group.latest.accountId) || {}).color);
  const names = group.participants.join('、');
  return `<div class="msg-row thread-row${group.unread ? ' is-unread' : ''}${selected ? ' is-selected' : ''}" data-thread-key="${escapeHtml(
    group.key
  )}" role="option" aria-selected="${selected}">
    <span class="unread-mark"></span>
    <span class="msg-avatar" style="${avatarStyle(color)}">${escapeHtml(initialOf(names))}</span>
    <div class="msg-main">
      <div class="msg-line">
        ${showAccount ? `<span class="msg-acct-dot" style="background:${color}"></span>` : ''}
        <span class="msg-from">${escapeHtml(names)}</span>
        ${group.count > 1 ? `<span class="thread-count">${group.count}</span>` : ''}
        <span class="msg-date">${formatListDate(group.latest.date || group.latest.timestamp)}</span>
      </div>
      <div class="msg-line">
        <span class="msg-subject">${escapeHtml(group.subject || '无主题')}</span>
        ${group.flagged ? `<span class="msg-flag">${icon('star-filled')}</span>` : ''}
      </div>
    </div>
  </div>`;
}

function renderScheduledRow(item) {
  const account = accountById(item.accountId);
  const color = safeColor(account ? account.color : '');
  const to = String(item.to || '').trim() || '未填写收件人';
  const selected = state.selectedScheduleId === item.id;
  return `<div class="msg-row scheduled-row${selected ? ' is-selected' : ''}" data-schedule-id="${escapeHtml(
    item.id
  )}" role="option" aria-selected="${selected}">
    <span class="msg-avatar" style="${avatarStyle(color)}">${icon('clock')}</span>
    <div class="msg-main">
      <div class="msg-line">
        <span class="msg-subject" style="color:var(--text)">${escapeHtml(item.subject || '无主题')}</span>
        ${item.attachmentCount ? `<span class="msg-paperclip">${icon('paperclip')}</span>` : ''}
        ${item.lastError ? `<span class="scheduled-error" title="${escapeHtml(item.lastError)}">发送失败</span>` : ''}
        <span class="msg-date">${formatFullDate(item.sendAt)}</span>
      </div>
      <div class="msg-line">
        <span class="msg-from" style="font-weight:400;color:var(--text-2)">${escapeHtml(to)}</span>
      </div>
    </div>
  </div>`;
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
  } else if (state.view.kind === 'scheduled') {
    html = state.scheduled.length
      ? state.scheduled.map(renderScheduledRow).join('')
      : emptyListHtml('clock', '没有定时邮件');
  } else if (state.view.kind === 'drafts') {
    html = state.drafts.length
      ? state.drafts.map(renderDraftRow).join('')
      : emptyListHtml('drafts', '无草稿');
  } else {
    const list = visibleMessages();
    if (!list.length) {
      html = emptyListHtml(state.filterUnread ? 'unread-dot' : 'inbox', state.filterUnread ? '无未读邮件' : '无邮件');
    } else if (canThreadView()) {
      html = threadGroups()
        .map((group) => renderThreadRow(group))
        .join('');
    } else {
      html = list.map(renderMessageRow).join('');
    }
  }

  els.messageList.innerHTML = html;
  els.messageList.scrollTop = scrollTop;
  updateBatchBar();
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
  const checked = state.checked.has(key);
  const showAccount =
    (state.view.kind === 'unified' ||
      state.view.kind === 'starred' ||
      state.view.kind === 'archived' ||
      Boolean(state.search)) &&
    state.accounts.length > 1;
  const color = safeColor(message.accountColor || (accountById(message.accountId) || {}).color);
  const name = senderName(message);
  return `<div class="msg-row${message.seen ? '' : ' is-unread'}${selected ? ' is-selected' : ''}${checked ? ' is-checked' : ''}" data-key="${escapeHtml(key)}" role="option" aria-selected="${selected}">
    <span class="unread-mark"></span>
    <input type="checkbox" class="msg-check" data-check="${escapeHtml(key)}"${checked ? ' checked' : ''} tabindex="-1" aria-label="选择邮件">
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
    state.view.kind !== 'scheduled' &&
    (state.view.kind === 'unified' || state.view.kind === 'starred' || state.view.kind === 'archived'
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
/* Multi-select & batch actions                                       */
/* ------------------------------------------------------------------ */

function updateBatchBar() {
  if (state.checked.size) {
    const alive = new Set(state.messages.map(messageKey));
    for (const key of [...state.checked]) {
      if (!alive.has(key)) state.checked.delete(key);
    }
  }
  const count = state.checked.size;
  els.batchBar.hidden = count === 0;
  els.batchArchive.hidden = state.view.kind === 'archived';
  els.batchRestore.hidden = !viewIsTrash();
  els.messageList.classList.toggle('batch-on', count > 0);
  if (count) els.batchCount.textContent = `已选 ${count} 封`;
  const rows = visibleMessages();
  const allChecked = rows.length > 0 && rows.every((message) => state.checked.has(messageKey(message)));
  els.selectAll.classList.toggle('is-on', allChecked);
  els.selectAll.title = allChecked ? '取消全选' : '全选';
}

function clearChecks() {
  if (!state.checked.size) return;
  state.checked.clear();
  state.lastCheckKey = null;
  updateBatchBar();
}

function toggleCheck(key, { shift = false } = {}) {
  const list = visibleMessages();
  const index = list.findIndex((message) => messageKey(message) === key);
  if (index < 0) return;
  const lastIndex = list.findIndex((message) => messageKey(message) === state.lastCheckKey);
  if (shift && lastIndex >= 0) {
    const [from, to] = lastIndex < index ? [lastIndex, index] : [index, lastIndex];
    for (let i = from; i <= to; i += 1) state.checked.add(messageKey(list[i]));
  } else if (state.checked.has(key)) {
    state.checked.delete(key);
  } else {
    state.checked.add(key);
  }
  state.lastCheckKey = key;
  renderList({ preserveScroll: true });
}

/* One click selects every row on screen; clicking again clears the selection. */
function toggleSelectAll() {
  const list = visibleMessages();
  if (!list.length) return;
  const allChecked = list.every((message) => state.checked.has(messageKey(message)));
  state.checked.clear();
  if (!allChecked) {
    for (const message of list) state.checked.add(messageKey(message));
  }
  state.lastCheckKey = null;
  renderList({ preserveScroll: true });
}

function checkedMessages() {
  if (!state.checked.size) return [];
  return state.messages.filter((message) => state.checked.has(messageKey(message)));
}

/* One IMAP SELECT per account + folder, so a batch costs as few round-trips as possible. */
function groupCheckedByMailbox(messages) {
  const groups = new Map();
  for (const message of messages) {
    const key = `${message.accountId}|${message.path}`;
    let group = groups.get(key);
    if (!group) {
      group = { accountId: message.accountId, path: message.path, messages: [] };
      groups.set(key, group);
    }
    group.messages.push(message);
  }
  return [...groups.values()];
}

/* One call per account + folder, and folders of different accounts run at the
   same time because they use different connections. Returns one error string
   per failed folder, named so the user can tell which mailbox was affected. */
function mailboxLabel(group) {
  const account = accountById(group.accountId);
  const folder = ((account && account.folders) || []).find((item) => item.path === group.path);
  const name = (folder && folder.name) || String(group.path || '').split('/').pop() || '该文件夹';
  const owner = account ? account.email || account.name || '' : '';
  return owner ? `${owner} 的 ${name}` : name;
}

async function forEachMailboxGroup(messages, run) {
  const groups = groupCheckedByMailbox(messages);
  const failed = [];
  let index = 0;
  async function worker() {
    while (index < groups.length) {
      const group = groups[index];
      index += 1;
      const uids = group.messages.map((message) => Number(message.uid)).filter((uid) => uid > 0);
      if (!uids.length) continue;
      try {
        await run(group, uids);
      } catch (err) {
        failed.push(`${mailboxLabel(group)}：${err && err.message ? err.message : '操作失败'}`);
      }
    }
  }
  const workers = [];
  for (let i = 0; i < Math.min(3, groups.length); i += 1) workers.push(worker());
  await Promise.all(workers);
  return failed;
}

function setBatchBusy(busy) {
  for (const button of [
    els.batchStar,
    els.batchUnstar,
    els.batchRead,
    els.batchUnread,
    els.batchRestore,
    els.batchArchive,
    els.batchTrash
  ]) {
    button.disabled = busy;
  }
}

/* Flag bookkeeping for one message; the unread badge is refreshed once per
   mailbox group, not once per row. */
function applyFlagLocally(message, add, remove) {
  if (add.includes('\\Flagged')) message.flagged = true;
  if (remove.includes('\\Flagged')) message.flagged = false;
  if (add.includes('\\Seen') && !message.seen) message.seen = true;
  if (remove.includes('\\Seen') && message.seen) message.seen = false;
}

async function batchSetFlags(add, remove, label) {
  const messages = checkedMessages();
  if (!messages.length) return;
  setBatchBusy(true);
  const failed = await forEachMailboxGroup(messages, async (group, uids) => {
    await api.mail.setFlags({ accountId: group.accountId, path: group.path, uids, add, remove });
    let unseenDelta = 0;
    for (const message of group.messages) {
      if (add.includes('\\Seen') && !message.seen) unseenDelta -= 1;
      if (remove.includes('\\Seen') && message.seen) unseenDelta += 1;
      applyFlagLocally(message, add, remove);
    }
    if (unseenDelta) bumpUnseen(group.accountId, group.path, unseenDelta);
  });
  /* The starred view only ever contains flagged mail, so un-starring leaves the view. */
  if (state.view.kind === 'starred' && remove.includes('\\Flagged')) {
    state.messages = state.messages.filter((message) => message.flagged);
  }
  setBatchBusy(false);
  renderList({ preserveScroll: true });
  renderHeader();
  toast(failed.length ? `${label}：${failed.length} 个文件夹失败（${failed[0]}）` : label);
}

function isInTrashFolder(message) {
  const trash = folderOf(accountById(message.accountId), 'trash');
  return Boolean(trash && message.path === trash.path);
}

/* 还原 only makes sense while browsing an account's 已删除 folder, which is the
   one view where every row is known to sit in the trash. */
function viewIsTrash() {
  return state.view.kind === 'folder' && state.view.role === 'trash';
}

/* Rows and unread badges move in one pass, so a batch never shows the counts
   ticking down one message at a time. */
function removeMessagesLocally(messages) {
  const keys = new Set(messages.map((message) => messageKey(message)));
  const dropped = new Map();
  for (const message of messages) {
    if (message.seen) continue;
    const mapKey = message.accountId + '\u0000' + message.path;
    const entry = dropped.get(mapKey) || { accountId: message.accountId, path: message.path, count: 0 };
    entry.count += 1;
    dropped.set(mapKey, entry);
  }
  state.messages = state.messages.filter((item) => !keys.has(messageKey(item)));
  for (const key of keys) state.checked.delete(key);
  for (const entry of dropped.values()) bumpUnseen(entry.accountId, entry.path, -entry.count);
  if (state.selectedKey && keys.has(state.selectedKey)) {
    state.selectedKey = null;
    clearReader();
  }
}

async function batchMove(target, label) {
  const messages = checkedMessages();
  if (!messages.length) return;
  const permanent = target === 'trash' ? messages.filter(isInTrashFolder) : [];
  if (permanent.length) {
    const confirmed = await api.dialog.confirm({
      title: '永久删除',
      message:
        permanent.length === messages.length
          ? `永久删除这 ${messages.length} 封邮件？`
          : `${permanent.length} 封邮件已在已删除文件夹中，将被永久删除。`,
      confirmLabel: '删除',
      cancelLabel: '取消',
      danger: true
    });
    if (!confirmed) return;
  }
  setBatchBusy(true);
  els.batchCount.textContent = `正在处理 ${messages.length} 封…`;
  let doneFolders = 0;
  const failed = await forEachMailboxGroup(messages, async (group, uids) => {
    if (isInTrashFolder(group.messages[0])) {
      await api.mail.deletePermanent({ accountId: group.accountId, path: group.path, uids });
    } else {
      await api.mail.move({ accountId: group.accountId, path: group.path, uids, target });
    }
    removeMessagesLocally(group.messages);
    doneFolders += 1;
  });
  setBatchBusy(false);
  state.lastCheckKey = null;
  renderList({ preserveScroll: true });
  renderHeader();
  updateFooter();
  toast(failed.length ? `${label}：${failed.length} 个文件夹失败（${failed[0]}）` : label);
  if (doneFolders) {
    window.setTimeout(() => {
      refreshAccounts({ manual: false });
    }, 1400);
  }
}

/* Restoring is the same batched shape as deleting: one MOVE per account folder
   back into that account's inbox. */
async function batchRestore() {
  const messages = checkedMessages().filter(isInTrashFolder);
  if (!messages.length) return;
  setBatchBusy(true);
  els.batchCount.textContent = `正在恢复 ${messages.length} 封…`;
  const failed = await forEachMailboxGroup(messages, async (group, uids) => {
    await api.mail.restore({ accountId: group.accountId, path: group.path, uids });
    removeMessagesLocally(group.messages);
  });
  setBatchBusy(false);
  state.lastCheckKey = null;
  renderList({ preserveScroll: true });
  renderHeader();
  updateFooter();
  toast(failed.length ? `还原：${failed.length} 个文件夹失败（${failed[0]}）` : `已还原 ${messages.length} 封到收件箱`);
  if (messages.length > failed.length) {
    window.setTimeout(() => {
      refreshAccounts({ manual: false });
    }, 1400);
  }
}

/* ------------------------------------------------------------------ */
/* Loading mail                                                       */
/* ------------------------------------------------------------------ */

/* Unified, starred and archived all page with one cursor per account. */
function pagedView() {
  if (state.view.kind === 'unified') return api.mail.listUnified;
  if (state.view.kind === 'starred') return api.mail.listStarred;
  if (state.view.kind === 'archived') return api.mail.listArchived;
  return null;
}

async function loadView({ preserveReader = false, keepScroll = false } = {}) {
  if (state.view.kind === 'contacts') {
    state.loading = false;
    showContactsWorkspace();
    return;
  }
  if (state.view.kind === 'scheduled') {
    state.loading = true;
    state.listError = null;
    state.scheduledDetail = null;
    state.selectedScheduleId = null;
    els.listBanner.hidden = true;
    clearReader();
    hideScheduledDetail();
    renderScheduledDetail();
    renderList();
    renderHeader();
    updateFooter();
    try {
      const rows = await api.scheduled.list();
      state.scheduled = Array.isArray(rows) ? rows : [];
    } catch (err) {
      state.listError = err && err.message ? err.message : '无法读取定时邮件';
    }
    state.loading = false;
    renderList({ preserveScroll: keepScroll });
    renderHeader();
    updateFooter();
    renderScheduledDetail();
    return;
  }
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
  hideScheduledDetail();
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

    const paged = pagedView();
    if (paged) {
      const data = await paged({ limit: PAGE_SIZE });
      if (token !== state.loadToken) return;
      state.messages = data.messages || [];
      state.messagesCursors = data.cursors || {};
      state.listErrors = data.errors || [];
    } else {
      const data = await api.mail.list({
        accountId: state.view.accountId,
        path: state.view.path,
        role: state.view.role,
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
  if (state.loading || state.loadingMore || state.search || state.view.kind === 'drafts' || state.view.kind === 'scheduled' || !state.accounts.length) {
    return;
  }
  const token = state.loadToken;
  state.loadingMore = true;
  updateFooter();
  try {
    let incoming = [];
    const paged = pagedView();
    if (paged) {
      const data = await paged({
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
        role: state.view.role,
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
    state.view.kind === 'scheduled' ||
    !state.accounts.length ||
    state.pageCount !== 1
  ) {
    return;
  }
  const token = state.loadToken;
  try {
    const paged = pagedView();
    if (paged) {
      const data = await paged({ limit: PAGE_SIZE });
      if (token !== state.loadToken || state.search) return;
      state.messages = data.messages || [];
      state.messagesCursors = data.cursors || {};
      state.listErrors = data.errors || [];
    } else {
      const data = await api.mail.list({
        accountId: state.view.accountId,
        path: state.view.path,
        role: state.view.role,
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

/* One trash sweep per session; the main process still caps it at about a day so
   restarting the app does not re-scan every 已删除 folder. */
async function maybePurgeTrash() {
  if (state.purgeAttempted) return;
  state.purgeAttempted = true;
  let report = null;
  try {
    report = await api.mail.purgeTrash();
  } catch {
    return;
  }
  const total = report ? Number(report.total) : 0;
  if (!total) return;
  const failed = ((report && report.results) || []).filter((item) => item && item.error);
  const text = `已彻底删除 ${total} 封 ${report.days} 天前的邮件`;
  toast(failed.length ? `${text}（${failed.length} 个账户失败：${failed[0].error}）` : text);
  if (viewIsTrash()) await loadView({ preserveReader: true, keepScroll: true });
}

function startAccountSync(manual) {
  if (!state.accounts.length) return Promise.resolve(false);

  state.syncing = true;
  setSyncUi(true);
  const syncing = {};
  for (const account of state.accounts) {
    syncing[account.id] = { accountId: account.id, state: 'syncing', error: '', at: Date.now() };
  }
  state.accountStatus = { ...state.accountStatus, ...syncing };
  renderSidebar();
  const promise = (async () => {
    let succeeded = false;
    try {
      const list = await api.folders.sync();
      state.accounts = (Array.isArray(list) ? list : []).map(normalizeAccount);
      const nextStatus = {};
      for (const account of state.accounts) {
        nextStatus[account.id] = account.error
          ? { accountId: account.id, state: 'error', error: account.error, at: Date.now() }
          : { accountId: account.id, state: 'online', error: '', at: Date.now() };
      }
      state.accountStatus = nextStatus;
      state.globalSyncError = null;
      succeeded = true;
      await detectNewMail();
      const next = normalizeView(state.view);
      if (!next && state.accounts.length) {
        state.view = defaultView();
      } else if (next && !sameView(next, state.view)) {
        state.view = next;
      }
      maybePurgeTrash();
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

/* A push only names the account that changed; folder status and notifications
   still come from the normal sync path, so a push that lands mid-sync is retried
   instead of racing it. */
const PUSH_DEBOUNCE_MS = 600;
let pushTimer = null;
let pushRetries = 0;
const pushPending = new Set();

function subscribeMailPush() {
  if (!api.mail || typeof api.mail.onPush !== 'function') return;
  api.mail.onPush((payload) => {
    const accountId = payload && payload.accountId ? String(payload.accountId) : '';
    if (!accountId) return;
    pushPending.add(accountId);
    scheduleMailPush();
  });
}

function scheduleMailPush() {
  if (pushTimer) return;
  pushTimer = window.setTimeout(() => {
    pushTimer = null;
    applyMailPush();
  }, PUSH_DEBOUNCE_MS);
}

async function applyMailPush() {
  if (!pushPending.size) return;
  if (state.syncing || state.loading) {
    if (pushRetries < 20) {
      pushRetries += 1;
      scheduleMailPush();
    }
    return;
  }
  pushRetries = 0;
  const ids = [...pushPending];
  pushPending.clear();
  let touched = false;
  for (const accountId of ids) {
    try {
      const updated = await api.folders.syncOne(accountId);
      const index = state.accounts.findIndex((account) => account.id === accountId);
      if (index >= 0) state.accounts[index] = normalizeAccount(updated);
      else if (updated && updated.id) state.accounts.push(normalizeAccount(updated));
      touched = true;
    } catch {}
  }
  if (!touched) return;
  await detectNewMail();
  renderSidebar();
  renderHeader();
  updateListBanner();
  if (!document.hidden) await silentReloadList();
}

/* ------------------------------------------------------------------ */
/* Connection status                                                  */
/* ------------------------------------------------------------------ */

function subscribeMailStatus() {
  api.mail.onStatus((status) => applyAccountStatus(status));
}

function subscribeScheduled() {
  if (!api.scheduled || typeof api.scheduled.onChange !== 'function') return;
  let timer = null;
  api.scheduled.onChange((payload) => {
    if (payload && payload.type === 'sent') {
      toast(payload.warning ? `定时邮件已发送：${payload.warning}` : '定时邮件已发送');
    }
    if (payload && payload.type === 'error') toast('定时邮件发送失败，稍后会自动重试');
    if (timer) clearTimeout(timer);
    timer = window.setTimeout(async () => {
      timer = null;
      await loadScheduledSummary();
      if (state.view.kind === 'scheduled' && !state.loading) await refreshScheduledView();
    }, 250);
  });
}

function subscribeFilters() {
  if (!api.mail || typeof api.mail.onFiltered !== 'function') return;
  let timer = null;
  api.mail.onFiltered((payload) => {
    const processed = Number(payload && payload.processed) || 0;
    if (!processed) return;
    toast(`过滤器处理了 ${processed} 封邮件`);
    if (timer) clearTimeout(timer);
    timer = window.setTimeout(async () => {
      timer = null;
      if (state.view.kind === 'contacts' || state.view.kind === 'scheduled') return;
      if (state.pageCount === 1 && !state.search) await silentReloadList();
    }, 500);
  });
}

function applyAccountStatus(status) {
  if (!status || !status.accountId) return;
  const previous = state.accountStatus[status.accountId];
  if (previous && previous.state === status.state && previous.error === (status.error || '')) return;
  state.accountStatus = { ...state.accountStatus, [status.accountId]: status };
  renderSidebar();
}

async function refreshAccountStatuses() {
  try {
    const list = await api.mail.statuses();
    const next = {};
    for (const item of Array.isArray(list) ? list : []) {
      if (item && item.accountId) next[item.accountId] = item;
    }
    state.accountStatus = next;
    renderSidebar();
  } catch {
    /* 状态只是辅助信息，取不到不影响收发信 */
  }
}

function statusInfo(accountId) {
  const status = state.accountStatus[accountId];
  if (!status) return null;
  const labels = {
    connecting: '正在连接',
    syncing: '正在同步',
    online: '已连接',
    offline: '离线，正在自动重试'
  };
  return {
    state: status.state,
    title: status.error || labels[status.state] || '状态未知'
  };
}

async function retryAccount(accountId) {
  const account = accountById(accountId);
  if (!account) return;
  applyAccountStatus({ accountId, state: 'connecting', error: '' });
  try {
    const updated = await api.folders.syncOne(accountId);
    const index = state.accounts.findIndex((item) => item.id === accountId);
    if (index >= 0 && updated) state.accounts[index] = normalizeAccount(updated);
    applyAccountStatus({
      accountId,
      state: updated && updated.error ? 'error' : 'online',
      error: updated && updated.error ? updated.error : ''
    });
    renderSidebar();
    renderHeader();
    updateListBanner();
    if (state.view.kind !== 'folder' || state.view.accountId === accountId) {
      await loadView({ preserveReader: true, keepScroll: true });
    }
  } catch (err) {
    applyAccountStatus({ accountId, state: 'error', error: err && err.message ? err.message : '重试失败' });
    toast(err && err.message ? err.message : '重试失败');
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
  hideScheduledDetail();
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
  if (els.readerThread) {
    els.readerThread.hidden = true;
    els.readerThread.innerHTML = '';
  }
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

/* ------------------------------------------------------------------ */
/* Body translation                                                   */
/* ------------------------------------------------------------------ */

const TRANSLATE_PIECE = 450;
/* The free service has a small daily quota, so a single email only sends the
   first screen or two of text and the rest is left as-is. */
const TRANSLATE_CHARS = 6000;
const SKIP_TRANSLATE_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSRIPT', 'TEXTAREA', 'TITLE', 'HEAD', 'IFRAME']);

function collectTextNodes(doc) {
  const nodes = [];
  if (!doc.body) return nodes;
  const walk = (parent) => {
    for (const child of parent.childNodes) {
      if (child.nodeType === 3) {
        if (child.data.trim() && !SKIP_TRANSLATE_TAGS.has(child.parentElement ? child.parentElement.tagName : '')) {
          nodes.push(child);
        }
      } else if (child.nodeType === 1 && !SKIP_TRANSLATE_TAGS.has(child.tagName)) {
        walk(child);
      }
    }
  };
  walk(doc.body);
  return nodes;
}

/* One request per piece keeps the free service inside its size limit; pieces
   of the same node are stitched back together after translation. */
function splitPiece(text, limit) {
  if (text.length <= limit) return [text];
  const parts = text.match(/[^.!?\n]+[.!?]*\n*|\n+/g) || [text];
  const pieces = [];
  let current = '';
  for (const part of parts) {
    if (current && current.length + part.length > limit) {
      pieces.push(current);
      current = part;
    } else {
      current += part;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

function planTranslation(doc) {
  const entries = [];
  let used = 0;
  let truncated = false;
  for (const node of collectTextNodes(doc)) {
    const pieces = splitPiece(node.data, TRANSLATE_PIECE);
    for (let index = 0; index < pieces.length; index += 1) {
      const piece = pieces[index];
      const core = piece.trim();
      if (core && used + core.length > TRANSLATE_CHARS) {
        truncated = true;
        /* Keep the tail as an untranslated entry so the body is never shortened. */
        entries.push({ node, piece: pieces.slice(index).join(''), core: '' });
        break;
      }
      if (core) used += core.length;
      entries.push({ node, piece, core });
    }
  }
  return { entries, segments: entries.filter((entry) => entry.core).map((entry) => entry.core), truncated };
}

function applyTranslation(entries, translated) {
  const chunks = new Map();
  let cursor = 0;
  let done = 0;
  for (const entry of entries) {
    let text = entry.piece;
    if (entry.core) {
      const value = String(translated[cursor] || '').trim();
      cursor += 1;
      if (value) {
        const lead = entry.piece.slice(0, entry.piece.length - entry.piece.trimStart().length);
        const trail = entry.piece.slice(entry.piece.trimEnd().length);
        text = `${lead}${value}${trail}`;
        done += 1;
      }
    }
    chunks.set(entry.node, (chunks.get(entry.node) || '') + text);
  }
  for (const [node, text] of chunks) node.data = text;
  return done;
}

function cjkRatio(text) {
  const eastern = (text.match(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/g) || []).length;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  const total = eastern + latin;
  return total ? eastern / total : 0;
}

async function toggleTranslate() {
  if (state.readerTranslating) return;
  const data = state.reader;
  if (!data) return;
  const key = messageKey(data);

  if (state.readerTranslated) {
    state.readerTranslated = false;
    setReaderDocument(state.readerDocument);
    updateReaderButtons();
    return;
  }
  if (state.readerTranslation && state.readerTranslation.key === key) {
    state.readerTranslated = true;
    setReaderDocument(state.readerTranslation.document);
    updateReaderButtons();
    return;
  }

  let doc;
  try {
    doc = new DOMParser().parseFromString(state.readerDocument, 'text/html');
  } catch {
    return;
  }
  const plan = planTranslation(doc);
  if (!plan.segments.length) {
    toast('没有可翻译的正文');
    return;
  }
  if (cjkRatio(plan.segments.join(' ')) > 0.2) {
    toast('正文已是中文');
    return;
  }

  state.readerTranslating = true;
  updateReaderButtons();
  toast('正在翻译正文…');
  try {
    const result = await api.translate.segments(plan.segments);
    const done = applyTranslation(plan.entries, (result && result.translated) || []);
    if (!done) throw new Error((result && result.notice) || '翻译服务没有返回内容');
    const document = `<!DOCTYPE html>${doc.documentElement.outerHTML}`;
    state.readerTranslation = { key, document };
    state.readerTranslated = true;
    setReaderDocument(document);
    const tail = plan.truncated ? '（正文过长，只翻译了前面部分）' : '';
    toast(result.notice ? `${result.notice}${tail}` : `已翻译成中文${result.provider === 'deepl' ? '（DeepL）' : ''}${tail}`);
  } catch (err) {
    toast(err && err.message ? err.message : '翻译失败');
  } finally {
    state.readerTranslating = false;
    updateReaderButtons();
  }
}

function clearReader() {
  state.reader = null;
  state.thread = null;
  state.threadLoading = false;
  state.readerLoading = false;
  state.readerError = null;
  state.readerRetry = null;
  state.readerAllowRemote = false;
  state.readerHasRemote = false;
  state.readerDocument = '';
  state.readerTranslated = false;
  state.readerTranslating = false;
  state.readerTranslation = null;
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

async function openThread(groupKey) {
  const groups = threadGroups();
  const group = groups.find((item) => item.key === groupKey);
  if (!group) return;
  const latest = group.latest;
  state.thread = {
    key: group.key,
    subject: group.subject,
    messages: group.messages.slice().sort((a, b) => a.timestamp - b.timestamp || a.seq - b.seq),
    accountId: latest.accountId,
    selectedKey: messageKey(latest)
  };
  state.threadLoading = true;
  state.selectedKey = `thread:${group.key}`;
  renderList({ preserveScroll: true });
  showReaderLoading();
  const token = ++state.readToken;
  try {
    const data = await api.mail.thread({
      accountId: latest.accountId,
      subject: group.subject,
      path: latest.path
    });
    if (token !== state.readToken) return;
    const fetched = Array.isArray(data && data.messages) ? data.messages : [];
    if (fetched.length) {
      const seen = new Map();
      for (const message of fetched) {
        seen.set(`${message.path}\u0000${message.uid}`, message);
      }
      for (const message of group.messages) {
        const key = `${message.path}\u0000${message.uid}`;
        if (!seen.has(key)) seen.set(key, message);
      }
      state.thread.messages = [...seen.values()].sort(
        (a, b) => a.timestamp - b.timestamp || a.seq - b.seq
      );
    }
  } catch (err) {
    if (token !== state.readToken) return;
  } finally {
    if (token === state.readToken) state.threadLoading = false;
  }
  if (!state.thread || token !== state.readToken) return;
  const newest = state.thread.messages[state.thread.messages.length - 1] || latest;
  await selectThreadMessage(newest);
}

async function selectThreadMessage(message) {
  if (!message) return;
  const key = messageKey(message);
  const token = ++state.readToken;
  state.reader = null;
  state.readerError = null;
  state.readerRetry = message;
  state.readerLoading = true;
  state.readerAllowRemote = false;
  state.readerHasRemote = false;
  if (state.thread) state.thread.selectedKey = key;
  showReaderLoading();
  renderThreadStrip();
  try {
    const data = await api.mail.read({
      accountId: message.accountId,
      path: message.path,
      uid: message.uid
    });
    if (token !== state.readToken) return;
    state.reader = data;
    state.readerLoading = false;
    const summary = state.messages.find((item) => messageKey(item) === key) || message;
    if (data.seen && !summary.seen) {
      summary.seen = true;
      bumpUnseen(summary.accountId, summary.path, -1);
    }
    summary.seen = Boolean(data.seen);
    if (typeof data.flagged === 'boolean') summary.flagged = data.flagged;
    if (state.thread) {
      const threadMessage = state.thread.messages.find((item) => messageKey(item) === key);
      if (threadMessage) {
        threadMessage.seen = summary.seen;
        threadMessage.flagged = summary.flagged;
      }
    }
    renderReader();
    renderThreadStrip();
    renderList({ preserveScroll: true });
  } catch (err) {
    if (token !== state.readToken) return;
    state.readerLoading = false;
    state.readerError = err && err.message ? err.message : '无法打开邮件';
    renderReaderEmpty(state.readerError, '重试');
    renderThreadStrip();
  }
}

function renderThreadStrip() {
  if (!els.readerThread) return;
  const thread = state.thread;
  if (!thread || !thread.messages.length) {
    els.readerThread.hidden = true;
    els.readerThread.innerHTML = '';
    return;
  }
  const selectedKey = thread.selectedKey;
  els.readerThread.hidden = false;
  els.readerThread.innerHTML = `<div class="thread-strip-head">
      <span>${thread.messages.length} 封邮件</span>
      <span class="thread-strip-hint">按时间顺序</span>
    </div>
    <div class="thread-strip-list">${thread.messages
      .map((message) => {
        const key = messageKey(message);
        const active = key === selectedKey;
        const name = senderName(message);
        return `<button type="button" class="thread-chip${active ? ' is-active' : ''}" data-thread-uid="${Number(
          message.uid
        )}" data-thread-path="${escapeHtml(message.path)}">
          <span class="thread-chip-name">${escapeHtml(name)}</span>
          <span class="thread-chip-date">${escapeHtml(formatListDate(message.date || message.timestamp))}</span>
          <span class="thread-chip-subject">${escapeHtml(message.subject || '无主题')}</span>
        </button>`;
      })
      .join('')}</div>`;
}

async function selectMessage(message, { force = false } = {}) {
  if (!message) return;
  const key = messageKey(message);
  if (!force && state.selectedKey === key && state.reader && !state.readerError) return;
  state.thread = null;
  if (els.readerThread) {
    els.readerThread.hidden = true;
    els.readerThread.innerHTML = '';
  }

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
  if (state.readerTranslation && state.readerTranslation.key !== messageKey(data)) {
    state.readerTranslation = null;
    state.readerTranslated = false;
    state.readerTranslating = false;
  }
  renderedTheme = resolvedTheme();
  els.readerEmpty.hidden = true;
  els.readerView.hidden = false;
  els.readerLoading.hidden = true;

  els.readerSubject.textContent = state.thread ? state.thread.subject : data.subject || '无主题';
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
  renderThreadStrip();

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
    state.readerDocument = built.document;
    /* Repainting for a theme or flag change keeps a finished translation. */
    setReaderDocument(state.readerTranslated ? state.readerTranslation.document : built.document);
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

  els.actionTranslate.disabled = state.readerTranslating;
  els.actionTranslate.classList.toggle('is-on', state.readerTranslated);
  els.actionTranslate.title = state.readerTranslating
    ? '正在翻译…'
    : state.readerTranslated
      ? '显示原文'
      : '翻译正文';

  const account = accountById(data.accountId);
  const archive = folderOf(account, 'archive');
  const inArchive = archive && data.path === archive.path;
  els.actionArchive.hidden = !archive || inArchive;
  const trash = folderOf(account, 'trash');
  const inTrash = trash && data.path === trash.path;
  els.actionTrash.disabled = !trash;
  els.actionTrash.title = inTrash ? '永久删除' : '删除';
  els.actionRestore.hidden = !inTrash;
}

function renderAttachments(attachments) {
  if (!attachments.length) {
    els.readerAttachments.hidden = true;
    els.readerAttachments.innerHTML = '';
    return;
  }
  const total = attachments.reduce((sum, item) => sum + (Number(item.size) || 0), 0);
  els.readerAttachments.hidden = false;
  els.readerAttachments.innerHTML = `<div class="attachment-head">
      <span class="attachment-sum">${attachments.length} 个附件 · ${formatSize(total)}</span>
      ${attachments.length > 1 ? '<button type="button" class="link-btn" data-save-all-attachments>全部保存</button>' : ''}
    </div>
    <div class="attachment-list">${attachments
      .map(
        (attachment) => `<button type="button" class="attachment-chip" data-attachment-index="${Number(
          attachment.index
        )}" title="保存附件">
        <span class="attachment-name">${escapeHtml(attachment.name || '附件')}</span>
        <span class="attachment-size">${formatSize(attachment.size)}</span>
        <span class="icon-btn">${icon('download')}</span>
      </button>`
      )
      .join('')}</div>`;
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

async function restoreCurrent() {
  const data = state.reader;
  if (!data) return;
  els.actionRestore.disabled = true;
  try {
    await api.mail.restore({
      accountId: data.accountId,
      path: data.path,
      uid: data.uid
    });
    afterMessageRemoved(data, 'inbox');
    toast('已还原到收件箱');
  } catch (err) {
    toast(err && err.message ? err.message : '还原失败');
    updateReaderButtons();
  } finally {
    els.actionRestore.disabled = false;
  }
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
    sendAt: String(data.sendAt || ''),
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
  els.composeHint.textContent = compose.sendAt ? `定时发送：${formatFullDate(compose.sendAt)}` : '';
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
  const total = compose.attachments.reduce((sum, item) => sum + (Number(item.size) || 0), 0);
  els.composeAttachments.hidden = false;
  els.composeAttachments.innerHTML = `<div class="attachment-summary">
      <span>${compose.attachments.length} 个附件 · ${formatSize(total)}</span>
      <span>上限 25 MB</span>
    </div>
    <div class="attachment-chips">${compose.attachments
      .map(
        (attachment, index) => `<span class="compose-chip">
        <span class="name">${escapeHtml(attachment.name || '附件')}</span>
        <span class="size">${formatSize(attachment.size)}</span>
        <button type="button" class="chip-remove" data-remove-attachment="${index}" title="移除">${icon('close')}</button>
      </span>`
      )
      .join('')}</div>`;
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
      sendAt: compose.sendAt || '',
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
    els.composeHint.textContent = compose.sendAt ? `定时发送：${formatFullDate(compose.sendAt)}` : '';
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
      const counted = !compose.sendAt;
      compose.id = null;
      try {
        await api.drafts.remove(id);
        if (counted) adjustDraftCount(compose.accountId, -1);
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

function localDateTimeValue(date) {
  const value = new Date(date);
  const pad = (number) => String(number).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(
    value.getHours()
  )}:${pad(value.getMinutes())}`;
}

function openScheduleDialog() {
  const compose = state.compose;
  if (!compose) return;
  syncComposeFieldValues();
  if (!compose.to.trim()) {
    toast('请填写收件人');
    els.composeTo.focus();
    return;
  }
  els.scheduleError.hidden = true;
  els.scheduleAt.value = compose.sendAt
    ? localDateTimeValue(compose.sendAt)
    : localDateTimeValue(Date.now() + 60 * 60 * 1000);
  els.scheduleNote.textContent = compose.sendAt
    ? '修改发送时间后，原定时时间会被替换。'
    : '到时应用会在后台自动发送；关闭窗口后仍然有效。';
  els.scheduleDialog.showModal();
  window.setTimeout(() => els.scheduleAt.focus(), 40);
}

function closeScheduleDialog() {
  if (els.scheduleDialog.open) els.scheduleDialog.close();
}

async function scheduleCompose() {
  const compose = state.compose;
  if (!compose) return;
  syncComposeFieldValues();
  if (!compose.to.trim()) {
    els.scheduleError.textContent = '请填写收件人';
    els.scheduleError.hidden = false;
    return;
  }
  const at = new Date(els.scheduleAt.value);
  if (!Number.isFinite(at.getTime()) || at.getTime() < Date.now() + 60 * 1000) {
    els.scheduleError.textContent = '请选择至少 1 分钟之后的时间';
    els.scheduleError.hidden = false;
    return;
  }
  const totalBytes = compose.attachments.reduce((sum, item) => sum + (Number(item.size) || 0), 0);
  if (totalBytes > 25 * 1024 * 1024) {
    els.scheduleError.textContent = '附件总大小不能超过 25 MB';
    els.scheduleError.hidden = false;
    return;
  }
  const countedAsDraft = !compose.sendAt;
  if (compose.autosaveTimer) {
    clearTimeout(compose.autosaveTimer);
    compose.autosaveTimer = null;
  }
  let waits = 0;
  while (compose.saving && waits < 120) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    waits += 1;
  }
  compose.sendAt = at.toISOString();
  const saved = await saveCompose({ manual: false });
  if (!saved) {
    els.scheduleError.textContent = '定时邮件保存失败';
    els.scheduleError.hidden = false;
    return;
  }
  if (countedAsDraft) adjustDraftCount(compose.accountId, -1);
  closeScheduleDialog();
  hideComposeUi();
  toast(`已安排在 ${formatFullDate(compose.sendAt)} 发送`);
  await loadScheduledSummary();
  if (state.view.kind === 'scheduled') await refreshScheduledView();
}

function hideComposeUi() {
  const compose = state.compose;
  if (compose && compose.autosaveTimer) clearTimeout(compose.autosaveTimer);
  state.compose = null;
  closeContactPicker();
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
      if (!compose.sendAt) adjustDraftCount(compose.accountId, -1);
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
      sendAt: draft.sendAt || '',
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

async function addComposeAttachments(files = null) {
  const compose = state.compose;
  if (!compose) return;
  try {
    const picked = files || (await api.files.pick());
    if (!Array.isArray(picked) || !picked.length) return;
    const known = new Set(compose.attachments.map((item) => item.path));
    let total = compose.attachments.reduce((sum, item) => sum + (Number(item.size) || 0), 0);
    for (const file of picked) {
      if (!file || !file.path || known.has(file.path)) continue;
      if (compose.attachments.length >= 20) {
        toast('一封邮件最多 20 个附件');
        break;
      }
      total += Number(file.size) || 0;
      if (total > 25 * 1024 * 1024) {
        toast('附件总大小不能超过 25 MB');
        break;
      }
      compose.attachments.push({ name: file.name, path: file.path, size: Number(file.size) || 0 });
      known.add(file.path);
    }
    renderComposeAttachments();
    scheduleAutosave();
  } catch (err) {
    toast(err && err.message ? err.message : '无法添加附件');
  }
}

function droppedFiles(event) {
  const files = [];
  const list = event.dataTransfer && event.dataTransfer.files ? event.dataTransfer.files : [];
  for (const file of list) {
    const filePath = api.files && typeof api.files.pathFor === 'function' ? api.files.pathFor(file) : file.path;
    if (!filePath) continue;
    files.push({ path: filePath, name: file.name, size: file.size });
  }
  return files;
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

function oauthProviderOf(provider) {
  return provider && provider.oauth ? provider.oauth : '';
}

/* 授权票据只在本次对话框内有效；关闭或切换提供方后必须重新授权。 */
function clearOAuthTicket() {
  state.oauth = null;
  els.accountOauthStatus.textContent = '';
  const account = state.editingAccountId ? accountById(state.editingAccountId) : null;
  els.accountEmail.readOnly = Boolean(account && account.authType === 'oauth2');
}

function setAccountAuth(type) {
  state.accountAuth = type === 'oauth2' ? 'oauth2' : 'password';
  const oauthMode = state.accountAuth === 'oauth2';
  els.accountPasswordField.hidden = oauthMode;
  els.accountOauthPanel.hidden = !oauthMode;
  for (const input of document.querySelectorAll('input[name="account-auth-type"]')) {
    input.checked = input.value === state.accountAuth;
  }
  const account = state.editingAccountId ? accountById(state.editingAccountId) : null;
  els.accountEmail.readOnly = Boolean(state.oauth) || Boolean(account && account.authType === 'oauth2');
  if (!oauthMode) return;
  const provider = providerById(els.accountProvider.value);
  const authorized = Boolean(state.oauth) || Boolean(account && account.authType === 'oauth2' && account.hasOAuth);
  els.accountOauthBtn.textContent = authorized
    ? `重新授权（${provider.oauthLabel || provider.label}）`
    : `使用 ${provider.oauthLabel || provider.label} 登录`;
  if (state.oauth) {
    els.accountOauthStatus.textContent = `已授权：${state.oauth.email}`;
  } else if (account && account.authType === 'oauth2') {
    els.accountOauthStatus.textContent = `已授权：${account.oauthEmail || account.email}`;
  } else {
    els.accountOauthStatus.textContent = '将在系统浏览器中打开授权页，完成后自动返回';
  }
}

function setOAuthBusy(busy) {
  state.oauthPending = Boolean(busy);
  els.accountOauthBtn.disabled = Boolean(busy);
}

async function startAccountOAuth() {
  if (state.accountBusy || state.oauthPending) return;
  const provider = providerById(els.accountProvider.value);
  const oauthKey = oauthProviderOf(provider);
  if (!oauthKey) {
    accountError('该提供方不支持 OAuth 登录');
    return;
  }
  accountError('');
  setOAuthBusy(true);
  els.accountOauthStatus.textContent = '正在打开浏览器，请完成授权…';
  try {
    const result = await api.accounts.oauthStart(oauthKey);
    state.oauth = { ticket: result.ticket, email: result.email, provider: oauthKey };
    els.accountEmail.value = result.email;
    if (!els.accountName.value.trim() && result.name) els.accountName.value = result.name;
    setAccountAuth('oauth2');
  } catch (err) {
    state.oauth = null;
    setAccountAuth('oauth2');
    accountError(err && err.message ? err.message : '授权失败');
  } finally {
    setOAuthBusy(false);
  }
}

function updatePasswordFormatHint() {
  const provider = providerById(els.accountProvider.value);
  const value = els.accountPassword.value.replace(/\s+/g, '');
  const mismatch = Boolean(provider.strictPasswordFormat) && value.length > 0 && !provider.strictPasswordFormat.test(value);
  els.accountPasswordWarn.hidden = !mismatch;
  els.accountPasswordWarn.textContent = mismatch
    ? `${provider.label} 不接受登录密码，请改用${provider.passwordLabel}`
    : '';
}

function applyProviderToForm(provider, { fillServers = true, revealAdvanced = true } = {}) {
  if (fillServers && provider.id !== 'custom') {
    setServerFields(provider.imap, provider.smtp);
  }
  const oauthKey = oauthProviderOf(provider);
  els.accountAuthMethod.hidden = !oauthKey;
  els.accountHint.textContent = provider.hint || '';
  els.accountPasswordLabel.textContent = provider.passwordLabel || '密码或授权码';
  if (!state.editingAccountId) els.accountPassword.placeholder = provider.passwordLabel || '密码或授权码';
  els.accountHelp.hidden = !provider.helpUrl;
  els.accountHelp.textContent = provider.helpLabel || '查看获取方式';
  els.accountHelp.dataset.url = provider.helpUrl || '';
  updatePasswordFormatHint();
  if (revealAdvanced && provider.id === 'custom') els.accountAdvanced.open = true;
  if (!oauthKey && state.accountAuth === 'oauth2') setAccountAuth('password');
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
  state.oauth = null;
  state.oauthPending = false;
  state.accountAuth = 'password';
  els.accountTitle.textContent = account ? '编辑账户' : '添加账户';
  els.accountEmail.value = account ? account.email : '';
  els.accountName.value = account ? account.name || '' : '';
  els.accountEmail.readOnly = Boolean(account && account.authType === 'oauth2');
  els.accountPassword.value = '';
  els.accountPassword.type = 'password';
  els.accountEye.innerHTML = icon('eye');
  els.accountEye.title = '显示密码';
  els.accountPassword.placeholder = account ? '留空则不修改' : '密码或授权码';
  els.accountOauthStatus.textContent = '';
  els.accountDelete.hidden = !account;
  els.accountError.hidden = true;
  els.accountError.textContent = '';
  els.accountAdvanced.open = false;

  const providerId = account ? providerIdForAccount(account) : 'custom';
  els.accountProvider.value = providerId;
  if (account) {
    setServerFields(account.imap, account.smtp);
    applyProviderToForm(providerById(providerId), { fillServers: false, revealAdvanced: false });
  } else {
    const provider = providerById('custom');
    setServerFields({ host: '', port: '', secure: true }, { host: '', port: '', secure: true });
    applyProviderToForm(provider, { fillServers: false });
  }
  setAccountAuth(account && account.authType === 'oauth2' ? 'oauth2' : 'password');

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
  const existing = state.editingAccountId ? accountById(state.editingAccountId) : null;
  const imap = { host: imapHost, port: imapPort, secure: els.imapSecure.checked };
  const smtp = { host: smtpHost, port: smtpPort, secure: els.smtpSecure.checked };
  const base = {
    id: state.editingAccountId || undefined,
    email,
    name: els.accountName.value.trim(),
    imap,
    smtp
  };

  if (state.accountAuth === 'oauth2') {
    const keepsExisting = Boolean(existing && existing.authType === 'oauth2' && existing.hasOAuth);
    if (!state.oauth && !keepsExisting) throw new Error('请先点击上方按钮完成授权');
    return {
      ...base,
      authType: 'oauth2',
      oauthTicket: state.oauth ? state.oauth.ticket : undefined
    };
  }

  // Google shows app passwords in four-character groups; the spaces are not part
  // of the secret and IMAP login fails when they are sent along with it.
  const provider = providerById(els.accountProvider.value);
  const password = provider.strictPasswordFormat
    ? els.accountPassword.value.replace(/\s+/g, '')
    : els.accountPassword.value;
  if (!password && !(existing && existing.authType !== 'oauth2' && existing.hasPassword)) {
    throw new Error('请输入密码或授权码');
  }
  return {
    ...base,
    authType: 'password',
    password: password || undefined
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
  const alive = new Set(state.accounts.map((account) => account.id));
  state.accountStatus = Object.fromEntries(
    Object.entries(state.accountStatus).filter(([accountId]) => alive.has(accountId))
  );
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
  const titles = { accounts: '账户', general: '常规', rules: '规则与黑名单', appearance: '外观', update: '更新' };
  els.settingsTitle.textContent = titles[tab] || '设置';
  if (tab === 'update') renderSettingsUpdate();
  if (tab === 'rules') loadRules();
}

/* ------------------------------------------------------------------ */
/* Rules and blacklist                                                */
/* ------------------------------------------------------------------ */

const RULE_ACTION_LABELS = {
  read: '标为已读',
  star: '加星标',
  archive: '归档',
  trash: '移入已删除'
};

const RULE_FIELD_LABELS = {
  from: '发件人包含',
  subject: '主题包含',
  to: '收件人包含'
};

async function loadRules() {
  try {
    const data = await api.rules.list();
    state.rules = Array.isArray(data && data.rules) ? data.rules : [];
    state.blacklist = Array.isArray(data && data.blacklist) ? data.blacklist : [];
    renderRules();
  } catch (err) {
    els.ruleList.innerHTML = `<p class="field-hint">${escapeHtml(
      err && err.message ? err.message : '无法读取规则'
    )}</p>`;
  }
}

function renderRules() {
  if (!state.rules.length) {
    els.ruleList.innerHTML = '<p class="rules-empty">还没有过滤器。新建一条规则，让新邮件自动归档、加星或标为已读。</p>';
  } else {
    els.ruleList.innerHTML = state.rules
      .map((rule) => `<div class="rule-row${rule.enabled ? '' : ' is-off'}" data-rule-id="${escapeHtml(rule.id)}">
        <label class="switch" title="${rule.enabled ? '停用规则' : '启用规则'}">
          <input type="checkbox" data-toggle-rule="${escapeHtml(rule.id)}"${rule.enabled ? ' checked' : ''}>
          <span></span>
        </label>
        <div class="rule-main">
          <div class="rule-name">${escapeHtml(rule.name)}</div>
          <div class="rule-condition">${escapeHtml(RULE_FIELD_LABELS[rule.field] || rule.field)}“${escapeHtml(
        rule.value
      )}” · ${escapeHtml(RULE_ACTION_LABELS[rule.action] || rule.action)}</div>
        </div>
        <button type="button" class="icon-btn" data-edit-rule="${escapeHtml(rule.id)}" title="编辑规则">${icon('edit')}</button>
        <button type="button" class="icon-btn" data-remove-rule="${escapeHtml(rule.id)}" title="删除规则">${icon('trash')}</button>
      </div>`)
      .join('');
  }

  if (!state.blacklist.length) {
    els.blacklistList.innerHTML = '<p class="rules-empty">黑名单为空。</p>';
  } else {
    els.blacklistList.innerHTML = state.blacklist
      .map(
        (entry) => `<div class="blacklist-row">
        <span class="blacklist-email">${escapeHtml(entry.email)}</span>
        <button type="button" class="icon-btn" data-remove-blacklist="${escapeHtml(entry.email)}" title="移出黑名单">${icon('close')}</button>
      </div>`
      )
      .join('');
  }
}

function openRuleForm(rule = null) {
  state.editingRuleId = rule ? rule.id : null;
  els.ruleForm.hidden = false;
  els.ruleError.hidden = true;
  els.ruleName.value = rule ? rule.name || '' : '';
  els.ruleField.value = rule ? rule.field : 'from';
  els.ruleValue.value = rule ? rule.value : '';
  els.ruleAction.value = rule ? rule.action : 'read';
  els.ruleEnabled.checked = rule ? rule.enabled !== false : true;
  els.ruleSave.textContent = rule ? '保存修改' : '保存规则';
  els.ruleName.focus();
}

function closeRuleForm() {
  state.editingRuleId = null;
  els.ruleForm.hidden = true;
  els.ruleError.hidden = true;
}

async function submitRuleForm() {
  const name = els.ruleName.value.trim();
  const value = els.ruleValue.value.trim();
  if (!value) {
    els.ruleError.textContent = '请填写匹配内容';
    els.ruleError.hidden = false;
    return;
  }
  els.ruleSave.disabled = true;
  try {
    await api.rules.save({
      id: state.editingRuleId || '',
      name: name || undefined,
      field: els.ruleField.value,
      value,
      action: els.ruleAction.value,
      enabled: els.ruleEnabled.checked
    });
    closeRuleForm();
    await loadRules();
    toast('规则已保存');
  } catch (err) {
    els.ruleError.textContent = err && err.message ? err.message : '保存失败';
    els.ruleError.hidden = false;
  } finally {
    els.ruleSave.disabled = false;
  }
}

async function toggleRule(id, enabled) {
  const rule = state.rules.find((item) => item.id === id);
  if (!rule) return;
  try {
    await api.rules.save({ ...rule, enabled });
    await loadRules();
  } catch (err) {
    toast(err && err.message ? err.message : '操作失败');
    await loadRules();
  }
}

async function removeRule(id) {
  const rule = state.rules.find((item) => item.id === id);
  const confirmed = await api.dialog.confirm({
    title: '删除规则',
    message: `删除“${rule ? rule.name : '这条规则'}”？`,
    confirmLabel: '删除',
    cancelLabel: '取消',
    danger: true
  });
  if (!confirmed) return;
  try {
    await api.rules.remove(id);
    await loadRules();
    toast('规则已删除');
  } catch (err) {
    toast(err && err.message ? err.message : '删除失败');
  }
}

async function addBlacklistEntry() {
  const email = els.blacklistEmail.value.trim();
  els.blacklistError.hidden = true;
  if (!email) return;
  try {
    state.blacklist = await api.rules.addBlacklist(email);
    els.blacklistEmail.value = '';
    renderRules();
    toast('已加入黑名单');
  } catch (err) {
    els.blacklistError.textContent = err && err.message ? err.message : '无法加入黑名单';
    els.blacklistError.hidden = false;
  }
}

async function removeBlacklistEntry(email) {
  try {
    await api.rules.removeBlacklist(email);
    await loadRules();
    toast('已移出黑名单');
  } catch (err) {
    toast(err && err.message ? err.message : '操作失败');
  }
}

function renderSettingsAccounts() {
  if (!state.accounts.length) {
    els.settingsAccounts.innerHTML = '<div class="settings-accounts-empty">未添加账户</div>';
    return;
  }
  els.settingsAccounts.innerHTML = state.accounts
    .map((account) => {
      const color = safeColor(account.color);
      const authBadge =
        account.authType === 'oauth2'
          ? `<span class="account-badge" title="OAuth 授权登录">OAuth</span>`
          : '';
      return `<div class="settings-account">
        <span class="avatar" style="${avatarStyle(color)}">${escapeHtml(initialOf(account.name || account.email))}</span>
        <span class="settings-account-info">
          <span class="settings-account-name">${escapeHtml(account.name || account.email)}${authBadge}</span>
          ${account.name ? `<span class="settings-account-email">${escapeHtml(account.email)}</span>` : ''}
        </span>
        <button type="button" class="icon-btn" data-edit-account="${escapeHtml(account.id)}" title="编辑账户">${icon('edit')}</button>
        <button type="button" class="icon-btn" data-remove-account="${escapeHtml(account.id)}" title="删除账户">${icon('trash')}</button>
      </div>`;
    })
    .join('');
}

/* The system owns the autostart entry, so the switch mirrors Windows rather
   than a stored copy that could drift from reality. */
function refreshAutoLaunch() {
  api.app
    .getAutoLaunch()
    .then((enabled) => {
      state.autoLaunch = Boolean(enabled);
      els.autoLaunchInput.checked = state.autoLaunch;
    })
    .catch(() => {});
}

function fillGeneralSettings() {
  els.refreshSelect.value = String(state.settings.refreshSeconds);
  els.trashPurgeSelect.value = String(Number(state.settings.trashPurgeDays) || 0);
  els.signatureInput.value = state.settings.signature || '';
  els.blockRemoteInput.checked = state.settings.remoteImages === 'block';
  els.notifyInput.checked = state.settings.notifyNewMail !== false;
  els.trayInput.checked = state.settings.closeToTray !== false;
  refreshAutoLaunch();
  /* The saved key is a credential and never comes back to the renderer, so the
     field stays empty and only shows whether one is already stored. */
  els.deeplKeyInput.value = '';
  state.deeplKeyTouched = false;
  renderDeeplKeyState();
  els.generalNote.textContent = '';
}

function renderDeeplKeyState() {
  const saved = Boolean(state.settings.hasDeeplKey);
  const typed = els.deeplKeyInput.value.trim();
  if (typed) {
    els.deeplKeyState.textContent = '保存后将优先使用 DeepL 翻译';
    return;
  }
  els.deeplKeyState.textContent = saved
    ? '已保存密钥，翻译时优先使用 DeepL；在此清空可改用免费翻译'
    : '未设置，使用免费翻译服务';
}

async function saveGeneralSettings() {
  const refreshSeconds = Number(els.refreshSelect.value);
  try {
    state.settings = await api.settings.update({
      refreshSeconds,
      trashPurgeDays: Number(els.trashPurgeSelect.value),
      signature: els.signatureInput.value,
      remoteImages: els.blockRemoteInput.checked ? 'block' : 'allow',
      notifyNewMail: els.notifyInput.checked,
      closeToTray: els.trayInput.checked
    });
    if (state.deeplKeyTouched) {
      state.settings = await api.settings.setDeeplKey(els.deeplKeyInput.value);
      state.deeplKeyTouched = false;
      els.deeplKeyInput.value = '';
    }
    if (els.autoLaunchInput.checked !== state.autoLaunch) {
      try {
        state.autoLaunch = Boolean(await api.app.setAutoLaunch(els.autoLaunchInput.checked));
      } catch (err) {
        toast(err && err.message ? err.message : '开机启动设置失败');
      }
      els.autoLaunchInput.checked = state.autoLaunch;
    }
    renderDeeplKeyState();
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

function renderUpdateRepoLink() {
  const repo = String(state.settings.updateRepo || '').trim();
  const valid = /^[\w.-]+\/[\w.-]+$/.test(repo);
  els.updateRepoLink.hidden = !valid;
  els.updateRepoLink.textContent = valid ? repo : '—';
  els.updateRepoLink.dataset.url = valid ? `https://github.com/${repo}` : '';
}

function renderSettingsUpdate() {
  els.updateVersion.textContent = state.appVersion || '—';
  els.updateCheckInput.checked = state.settings.updateCheck !== false;
  renderUpdateRepoLink();
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
      updateCheck: els.updateCheckInput.checked
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

function setUpdateProgress(visible, percent, text) {
  els.updateProgress.hidden = !visible;
  if (!visible) return;
  els.updateProgressFill.style.width = `${Math.max(0, Math.min(100, percent || 0))}%`;
  els.updateProgressText.textContent = text || '';
}

function applyUpdateReady(info) {
  state.updateReady = info || null;
  if (!info) return;
  setUpdateProgress(
    true,
    100,
    `${info.verified ? '下载完成，已校验' : '下载完成'}（${formatSize(info.size)}）`
  );
  els.updateDownload.textContent = '重启并安装';
  els.updateDownload.disabled = false;
  els.updateIgnore.hidden = true;
  els.updateCancel.hidden = true;
}

function onUpdateProgress(payload) {
  if (!payload || !state.updateOffer) return;
  if (payload.phase === 'downloading') {
    const total = Number(payload.total) || 0;
    const received = Number(payload.received) || 0;
    const text = total
      ? `正在下载 ${formatSize(received)} / ${formatSize(total)}`
      : `正在下载 ${formatSize(received)}`;
    setUpdateProgress(true, Number(payload.percent) || 0, text);
    return;
  }
  if (payload.phase === 'ready') {
    setUpdateProgress(true, 100, payload.verified ? '下载完成，已校验' : '下载完成');
    return;
  }
  if (payload.phase === 'installing') {
    setUpdateProgress(true, 100, '正在退出并安装，完成后会打开新版本');
    els.updateDownload.disabled = true;
  }
}

async function startUpdateDownload() {
  const offer = state.updateOffer;
  if (!offer || state.updateDownloading) return;
  state.updateDownloading = true;
  els.updateDownload.disabled = true;
  els.updateDownload.textContent = '下载中…';
  els.updateIgnore.disabled = true;
  els.updateCancel.hidden = false;
  setUpdateProgress(true, 0, '正在连接下载地址…');
  try {
    const info = await api.update.download(offer.latest);
    state.updateDownloading = false;
    applyUpdateReady(info);
  } catch (err) {
    state.updateDownloading = false;
    els.updateDownload.disabled = false;
    els.updateDownload.textContent = '重试下载';
    els.updateIgnore.disabled = false;
    els.updateCancel.hidden = true;
    setUpdateProgress(true, 0, err && err.message ? err.message : '下载失败');
  }
}

async function installUpdate() {
  try {
    await api.update.install();
  } catch (err) {
    toast(err && err.message ? err.message : '安装失败');
  }
}

async function cancelUpdateDownload() {
  try {
    await api.update.cancel();
  } catch {}
  state.updateDownloading = false;
  els.updateDownload.disabled = false;
  els.updateDownload.textContent = '下载更新';
  els.updateIgnore.disabled = false;
  els.updateCancel.hidden = true;
  setUpdateProgress(false, 0, '');
}

function showUpdateDialog(result) {
  state.updateOffer = result;
  els.updateFrom.textContent = result.current;
  els.updateTo.textContent = result.latest;
  els.updateNotes.textContent = result.notes || '';
  els.updateDownload.disabled = false;
  els.updateDownload.textContent = '下载更新';
  els.updateIgnore.hidden = false;
  els.updateIgnore.disabled = false;
  els.updateCancel.hidden = true;
  setUpdateProgress(false, 0, '');
  if (state.updateReady && state.updateReady.version === result.latest) applyUpdateReady(state.updateReady);
  if (!els.updateDialog.open) els.updateDialog.showModal();
}

async function dismissUpdateDialog(action) {
  if (state.updateDownloading) return;
  const offer = state.updateOffer;
  els.updateDialog.close();
  if (!offer) return;
  try {
    if (action === 'ignore') {
      state.settings = await api.settings.update({ updateSkipped: offer.latest });
      renderSettingsUpdate();
      toast(`不再提示 ${offer.latest}`);
    }
  } catch (err) {
    toast(err && err.message ? err.message : '操作失败');
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
  if (state.view.kind === 'contacts') return;
  if (state.view.kind === 'scheduled') {
    if (!state.scheduled.length) return;
    let index = state.scheduled.findIndex((item) => item.id === state.selectedScheduleId);
    if (index < 0) index = delta > 0 ? -1 : state.scheduled.length;
    const nextIndex = Math.max(0, Math.min(state.scheduled.length - 1, index + delta));
    const item = state.scheduled[nextIndex];
    selectScheduled(item.id);
    window.requestAnimationFrame(() => {
      const row = [...els.messageList.querySelectorAll('.scheduled-row')].find(
        (entry) => entry.dataset.scheduleId === item.id
      );
      if (row) row.scrollIntoView({ block: 'nearest' });
    });
    return;
  }
  if (state.view.kind === 'drafts') return;
  if (canThreadView()) {
    const groups = threadGroups();
    if (!groups.length) return;
    let index = groups.findIndex((group) => state.selectedKey === `thread:${group.key}`);
    if (index < 0) index = delta > 0 ? -1 : groups.length;
    const nextIndex = Math.max(0, Math.min(groups.length - 1, index + delta));
    const group = groups[nextIndex];
    openThread(group.key);
    window.requestAnimationFrame(() => {
      const row = [...els.messageList.querySelectorAll('.thread-row')].find(
        (item) => item.dataset.threadKey === group.key
      );
      if (row) row.scrollIntoView({ block: 'nearest' });
    });
    return;
  }
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
/* Scheduled send                                                     */
/* ------------------------------------------------------------------ */

async function loadScheduledSummary() {
  try {
    const rows = await api.scheduled.list();
    state.scheduled = Array.isArray(rows) ? rows : [];
  } catch {
    state.scheduled = state.scheduled || [];
  }
  renderSidebar();
  if (state.view.kind === 'scheduled' && !state.loading) {
    renderList({ preserveScroll: true });
    renderHeader();
    if (state.selectedScheduleId) {
      const item = state.scheduled.find((entry) => entry.id === state.selectedScheduleId);
      if (!item) {
        state.selectedScheduleId = null;
        state.scheduledDetail = null;
        hideScheduledDetail();
        renderScheduledDetail();
      } else {
        selectScheduled(item.id);
      }
    }
  }
}

function hideScheduledDetail() {
  if (!els.scheduledDetail) return;
  els.scheduledDetail.hidden = true;
  els.scheduledDetail.innerHTML = '';
  state.scheduledDetail = null;
  state.selectedScheduleId = null;
}

function scheduledAddressText(value) {
  return String(value || '').trim() || '未填写';
}

function renderScheduledDetail() {
  if (!els.scheduledDetail) return;
  const item = state.scheduledDetail;
  if (!item) {
    els.scheduledDetail.hidden = false;
    els.scheduledDetail.innerHTML = `<div class="scheduled-empty">
      <span class="empty-icon">${icon('clock')}</span>
      <p>${state.scheduled.length ? '从左侧选择一封定时邮件' : '还没有定时邮件'}</p>
      <p class="field-hint">在写信页点“定时发送”即可安排发送时间。</p>
    </div>`;
    return;
  }
  const account = accountById(item.accountId);
  els.scheduledDetail.hidden = false;
  els.scheduledDetail.innerHTML = `<div class="scheduled-inner">
    <header class="scheduled-head">
      <span class="msg-avatar scheduled-avatar" style="${avatarStyle(account ? account.color : '')}">${icon('clock')}</span>
      <div class="scheduled-id">
        <h2 class="scheduled-subject">${escapeHtml(item.subject || '无主题')}</h2>
        <p class="scheduled-meta">${escapeHtml(formatFullDate(item.sendAt))}</p>
      </div>
      <button type="button" class="btn primary" data-schedule-action="edit">${icon('edit')}<span>编辑</span></button>
    </header>
    <div class="scheduled-body">
      <div class="contact-field"><span class="contact-field-label">发件人</span><span class="contact-field-value">${escapeHtml(
        account ? account.email : '账户不存在'
      )}</span></div>
      <div class="contact-field"><span class="contact-field-label">收件人</span><span class="contact-field-value">${escapeHtml(
        scheduledAddressText(item.to)
      )}</span></div>
      ${item.cc ? `<div class="contact-field"><span class="contact-field-label">抄送</span><span class="contact-field-value">${escapeHtml(item.cc)}</span></div>` : ''}
      <div class="contact-field"><span class="contact-field-label">定时时间</span><span class="contact-field-value">${escapeHtml(
        formatFullDate(item.sendAt)
      )}</span></div>
      <div class="contact-field"><span class="contact-field-label">附件</span><span class="contact-field-value">${
        item.attachments && item.attachments.length
          ? item.attachments.map((attachment) => `${escapeHtml(attachment.name)}（${formatSize(attachment.size)}）`).join('，')
          : '无'
      }</span></div>
      ${item.lastError ? `<div class="scheduled-error-box"><span>${icon('warning')}</span><span>上次发送失败：${escapeHtml(item.lastError)}${
        item.nextAttempt && Number(item.nextAttempt) > Date.now()
          ? `；将于 ${escapeHtml(formatFullDate(item.nextAttempt))} 自动重试`
          : ''
      }</span></div>` : ''}
      <p class="field-hint">到时间后应用会在后台自动发送，关闭窗口后仍然有效。</p>
    </div>
    <footer class="scheduled-foot">
      <button type="button" class="btn danger-ghost" data-schedule-action="delete">删除</button>
      <span class="spacer"></span>
      <button type="button" class="btn" data-schedule-action="cancel">取消定时</button>
      <button type="button" class="btn" data-schedule-action="send">立即发送</button>
    </footer>
  </div>`;
  hydrateIcons(els.scheduledDetail);
}

async function selectScheduled(id) {
  const entry = state.scheduled.find((item) => item.id === id);
  if (!entry) return;
  state.selectedScheduleId = id;
  renderList({ preserveScroll: true });
  try {
    const detail = await api.drafts.get(id);
    if (state.selectedScheduleId !== id) return;
    if (!detail) throw new Error('定时邮件不存在');
    state.scheduledDetail = detail;
    renderScheduledDetail();
  } catch (err) {
    state.scheduledDetail = null;
    renderScheduledDetail();
    toast(err && err.message ? err.message : '无法读取定时邮件');
  }
}

async function refreshScheduledView() {
  try {
    const rows = await api.scheduled.list();
    state.scheduled = Array.isArray(rows) ? rows : [];
  } catch {}
  renderSidebar();
  if (state.view.kind === 'scheduled') {
    renderList({ preserveScroll: true });
    renderHeader();
    const item = state.selectedScheduleId
      ? state.scheduled.find((entry) => entry.id === state.selectedScheduleId)
      : null;
    if (!item) {
      state.selectedScheduleId = null;
      state.scheduledDetail = null;
      hideScheduledDetail();
      renderScheduledDetail();
    } else {
      await selectScheduled(item.id);
    }
  }
}

async function sendScheduledNow(id) {
  const confirmed = await api.dialog.confirm({
    title: '立即发送',
    message: '现在发送这封定时邮件？',
    confirmLabel: '发送',
    cancelLabel: '取消'
  });
  if (!confirmed) return;
  try {
    const result = await api.scheduled.sendNow(id);
    toast(result && result.warning ? `已发送：${result.warning}` : '已发送');
    await refreshScheduledView();
  } catch (err) {
    toast(err && err.message ? err.message : '发送失败');
  }
}

async function cancelScheduled(id) {
  const confirmed = await api.dialog.confirm({
    title: '取消定时',
    message: '取消定时后，这封邮件会回到草稿箱。',
    confirmLabel: '取消定时',
    cancelLabel: '保留',
    danger: true
  });
  if (!confirmed) return;
  try {
    const item = state.scheduled.find((entry) => entry.id === id);
    await api.scheduled.cancel(id);
    if (item) adjustDraftCount(item.accountId, 1);
    toast('已取消定时，邮件已回到草稿箱');
    await refreshScheduledView();
    await refreshDraftRows();
  } catch (err) {
    toast(err && err.message ? err.message : '操作失败');
  }
}

async function deleteScheduled(id) {
  const item = state.scheduled.find((entry) => entry.id === id);
  const confirmed = await api.dialog.confirm({
    title: '删除定时邮件',
    message: `删除“${item ? item.subject || '无主题' : '这封邮件'}”？`,
    confirmLabel: '删除',
    cancelLabel: '取消',
    danger: true
  });
  if (!confirmed) return;
  try {
    await api.drafts.remove(id);
    toast('已删除');
    await refreshScheduledView();
  } catch (err) {
    toast(err && err.message ? err.message : '删除失败');
  }
}

function editScheduled(item) {
  if (!item) return;
  openComposeShell({
    id: item.id,
    accountId: item.accountId,
    kind: item.kind || 'new',
    to: item.to,
    cc: item.cc,
    bcc: item.bcc,
    subject: item.subject,
    html: item.html,
    inReplyTo: item.inReplyTo,
    references: item.references,
    attachments: item.attachments,
    sendAt: item.sendAt,
    focus: 'editor'
  });
}

/* ------------------------------------------------------------------ */
/* Contacts                                                           */
/* ------------------------------------------------------------------ */

async function loadContacts() {
  try {
    const rows = await api.contacts.list();
    state.contacts = Array.isArray(rows) ? rows : [];
  } catch (err) {
    console.error(err);
    state.contacts = [];
  }
  renderSidebar();
  if (state.view.kind === 'contacts') {
    if (!state.selectedContact || !contactByEmail(state.selectedContact)) {
      state.selectedContact = state.contacts[0] ? state.contacts[0].email : null;
    }
    renderContactList();
    renderContactDetail();
    renderHeader();
  }
}

function filteredContacts(query) {
  const text = String(query || '').trim().toLowerCase();
  if (!text) return state.contacts;
  return state.contacts.filter(
    (contact) =>
      String(contact.email || '').toLowerCase().includes(text) ||
      String(contact.name || '').toLowerCase().includes(text)
  );
}

function contactByEmail(email) {
  return state.contacts.find((contact) => contact.email === String(email || '')) || null;
}

function activeContact() {
  return contactByEmail(state.selectedContact);
}

function contactDraftDirty() {
  if (!state.contactEditing) return false;
  const nameEl = document.getElementById('contact-name');
  const emailEl = document.getElementById('contact-email');
  if (!nameEl || !emailEl) return false;
  const draft = state.contactDraft || {};
  return (
    nameEl.value.trim() !== String(draft.name || '').trim() ||
    emailEl.value.trim() !== String(draft.email || '').trim()
  );
}

async function confirmContactDiscard() {
  if (state.view.kind !== 'contacts' || !contactDraftDirty()) return true;
  return api.dialog.confirm({
    title: '放弃修改',
    message: '当前联系人还有未保存的修改，确定放弃？',
    confirmLabel: '放弃',
    cancelLabel: '继续编辑',
    danger: true
  });
}

function contactError(message) {
  const el = document.getElementById('contact-error');
  if (!el) return;
  const text = String(message || '');
  el.textContent = text;
  el.hidden = !text;
}

function showContactsWorkspace() {
  const workspace = els.contactsView ? els.contactsView.parentElement : null;
  if (workspace) workspace.classList.add('is-contacts');
  if (els.contactsView) els.contactsView.hidden = false;
  if (els.searchInput) {
    els.searchInput.placeholder = '搜索联系人';
    els.searchInput.setAttribute('aria-label', '搜索联系人');
  }
  if (!state.contactEditing && !activeContact() && state.contacts.length) {
    state.selectedContact = state.contacts[0].email;
  }
  renderSidebar();
  renderContactList();
  renderContactDetail();
  renderHeader();
}

function hideContactsWorkspace() {
  const workspace = els.contactsView ? els.contactsView.parentElement : null;
  if (workspace) workspace.classList.remove('is-contacts');
  if (els.contactsView) els.contactsView.hidden = true;
  if (els.searchInput) {
    els.searchInput.placeholder = '搜索邮件';
    els.searchInput.setAttribute('aria-label', '搜索邮件');
  }
}

function renderContactList() {
  if (!els.contactsViewList) return;
  const list = filteredContacts(state.contactQuery);
  if (els.contactsViewCount) {
    els.contactsViewCount.textContent = state.contacts.length
      ? state.contactQuery
        ? `${list.length}/${state.contacts.length} 位`
        : `${state.contacts.length} 位`
      : '';
  }
  els.contactsViewList.innerHTML = list.length
    ? list
        .map(
          (contact) => `<button type="button" class="contact-row${contact.email === state.selectedContact ? ' is-active' : ''}" data-contact="${escapeHtml(contact.email)}">
            <span class="msg-avatar" style="${avatarStyle('#7d8590')}">${escapeHtml(initialOf(contact.name || contact.email))}</span>
            <span class="contact-row-text">
              <span class="contact-row-name">${escapeHtml(contact.name || contact.email)}</span>
              ${contact.name ? `<span class="contact-row-email">${escapeHtml(contact.email)}</span>` : ''}
            </span>
          </button>`
        )
        .join('')
    : `<div class="contacts-view-empty">${state.contactQuery ? '没有匹配的联系人' : '还没有联系人'}</div>`;
  hydrateIcons(els.contactsViewList);
}

function renderContactDetail() {
  if (!els.contactDetail) return;

  if (state.contactEditing) {
    const draft = state.contactDraft || { name: '', email: '', originalEmail: '' };
    const isNew = !draft.originalEmail;
    const title = isNew ? '新建联系人' : '编辑联系人';
    els.contactDetail.innerHTML = `
      <form class="contact-detail-form" id="contact-form" novalidate>
        <header class="contact-detail-head">
          <span class="msg-avatar contact-detail-avatar" style="${avatarStyle('#7d8590')}">${escapeHtml(
            initialOf(draft.name || draft.email || '?')
          )}</span>
          <div class="contact-detail-id">
            <h2 class="contact-detail-name">${escapeHtml(title)}</h2>
            <p class="contact-email-text">${isNew ? '填写姓名与邮箱地址' : escapeHtml(draft.originalEmail)}</p>
          </div>
        </header>
        <div class="contact-detail-body">
          <label class="field">
            <span class="field-label">姓名</span>
            <input id="contact-name" type="text" autocomplete="off" value="${escapeHtml(draft.name || '')}">
          </label>
          <label class="field">
            <span class="field-label">邮箱地址</span>
            <input id="contact-email" type="text" inputmode="email" autocomplete="off" spellcheck="false" value="${escapeHtml(
              draft.email || ''
            )}">
          </label>
          <p class="field-hint">联系人保存在本机。</p>
          <p class="form-error" id="contact-error" hidden></p>
        </div>
        <footer class="contact-detail-foot">
          ${
            isNew
              ? ''
              : '<button type="button" class="btn danger-ghost" data-contact-action="delete">删除联系人</button>'
          }
          <span class="spacer"></span>
          <button type="button" class="btn" data-contact-action="cancel">取消</button>
          <button type="submit" class="btn primary" id="contact-submit">${isNew ? '添加' : '保存'}</button>
        </footer>
      </form>`;
  } else {
    const contact = activeContact();
    if (!contact) {
      els.contactDetail.innerHTML = `
        <div class="contact-empty">
          <span class="empty-icon" data-icon="contacts"></span>
          <p>${state.contacts.length ? '从左侧选择联系人' : '还没有联系人'}</p>
          <button type="button" class="btn primary" data-contact-action="new">新建联系人</button>
        </div>`;
    } else {
      const displayName = contact.name || contact.email;
      els.contactDetail.innerHTML = `
        <div class="contact-detail-inner">
          <header class="contact-detail-head">
            <span class="msg-avatar contact-detail-avatar" style="${avatarStyle('#7d8590')}">${escapeHtml(
              initialOf(displayName)
            )}</span>
            <div class="contact-detail-id">
              <h2 class="contact-detail-name">${escapeHtml(displayName)}</h2>
              <div class="contact-email-row">
                <span class="contact-email-text">${escapeHtml(contact.email)}</span>
                <button type="button" class="icon-btn contact-copy" data-contact-action="copy" title="复制邮箱" aria-label="复制邮箱">
                  <span data-icon="copy"></span>
                </button>
              </div>
            </div>
            <button type="button" class="btn primary contact-compose-btn" data-contact-action="compose">
              <span data-icon="compose"></span><span>写信</span>
            </button>
          </header>
          <div class="contact-detail-body">
            <div class="contact-field">
              <span class="contact-field-label">姓名</span>
              <span class="contact-field-value">${escapeHtml(contact.name || '—')}</span>
            </div>
            <div class="contact-field">
              <span class="contact-field-label">邮箱</span>
              <span class="contact-field-value">${escapeHtml(contact.email)}</span>
            </div>
          </div>
          <footer class="contact-detail-foot">
            <button type="button" class="btn danger-ghost" data-contact-action="delete">删除联系人</button>
            <span class="spacer"></span>
            <button type="button" class="btn" data-contact-action="edit"><span data-icon="edit"></span><span>编辑</span></button>
          </footer>
        </div>`;
    }
  }
  hydrateIcons(els.contactDetail);
}

async function selectContact(email) {
  if (!(await confirmContactDiscard())) return;
  state.contactEditing = false;
  state.contactDraft = null;
  state.selectedContact = email;
  renderContactList();
  renderContactDetail();
}

async function startNewContact() {
  if (!(await confirmContactDiscard())) return;
  state.selectedContact = null;
  state.contactEditing = true;
  state.contactDraft = { name: '', email: '', originalEmail: '' };
  renderContactList();
  renderContactDetail();
  const nameEl = document.getElementById('contact-name');
  if (nameEl) nameEl.focus();
}

function startContactEdit() {
  const contact = activeContact();
  if (!contact) return;
  state.contactEditing = true;
  state.contactDraft = {
    name: contact.name || '',
    email: contact.email,
    originalEmail: contact.email
  };
  renderContactDetail();
  const nameEl = document.getElementById('contact-name');
  if (nameEl) nameEl.focus();
}

function cancelContactEdit() {
  state.contactEditing = false;
  state.contactDraft = null;
  if (!activeContact() && state.contacts.length) {
    state.selectedContact = state.contacts[0].email;
  }
  renderContactList();
  renderContactDetail();
}

async function submitContactForm() {
  const nameEl = document.getElementById('contact-name');
  const emailEl = document.getElementById('contact-email');
  if (!emailEl) return;
  const name = nameEl ? nameEl.value.trim() : '';
  const email = emailEl.value.trim();
  if (!email) {
    contactError('请填写邮箱地址');
    emailEl.focus();
    return;
  }
  const submit = document.getElementById('contact-submit');
  const creating = !state.contactDraft || !state.contactDraft.originalEmail;
  if (submit) submit.disabled = true;
  try {
    const saved = await api.contacts.save({
      name,
      email,
      originalEmail: state.contactDraft ? state.contactDraft.originalEmail : ''
    });
    state.contactEditing = false;
    state.contactDraft = null;
    state.selectedContact = saved.email;
    await loadContacts();
    renderContactList();
    renderContactDetail();
    toast(creating ? '已添加联系人' : '联系人已保存');
  } catch (err) {
    contactError(err && err.message ? err.message : '保存失败');
  } finally {
    if (submit) submit.disabled = false;
  }
}

async function removeContact() {
  const target = state.contactEditing
    ? contactByEmail(state.contactDraft && state.contactDraft.originalEmail)
    : activeContact();
  if (!target) return;

  const confirmed = await api.dialog.confirm({
    title: '删除联系人',
    message: `删除联系人 ${target.email}？`,
    confirmLabel: '删除',
    cancelLabel: '取消',
    danger: true
  });
  if (!confirmed) return;

  const index = state.contacts.findIndex((item) => item.email === target.email);
  try {
    await api.contacts.remove({ email: target.email });
    state.contactEditing = false;
    state.contactDraft = null;
    await loadContacts();
    const next = state.contacts[Math.min(Math.max(index, 0), state.contacts.length - 1)] || null;
    state.selectedContact = next ? next.email : null;
    renderContactList();
    renderContactDetail();
    toast('联系人已删除');
  } catch (err) {
    if (state.contactEditing) contactError(err && err.message ? err.message : '删除失败');
    else toast(err && err.message ? err.message : '删除失败');
  }
}

async function copyContactEmail() {
  const contact = activeContact() || (state.contactEditing
    ? contactByEmail(state.contactDraft && state.contactDraft.originalEmail)
    : null);
  if (!contact) return;
  try {
    await api.app.copyText(contact.email);
    toast('已复制邮箱');
    const button = els.contactDetail.querySelector('[data-contact-action="copy"]');
    if (button) {
      button.classList.add('is-copied');
      button.innerHTML = icon('check');
      window.setTimeout(() => {
        if (!button.isConnected) return;
        button.classList.remove('is-copied');
        button.innerHTML = icon('copy');
      }, 1600);
    }
  } catch (err) {
    toast(err && err.message ? err.message : '复制失败');
  }
}

function composeToContact() {
  const contact = activeContact();
  if (!contact) return;
  openComposeShell({ kind: 'new', to: contact.email });
}


function closeContactPicker() {
  state.contactPickField = null;
  els.contactPop.hidden = true;
  els.contactSearch.value = '';
}

function renderContactPickList(query) {
  const list = filteredContacts(query);
  els.contactPopList.innerHTML = list.length
    ? list
        .map(
          (contact) => `<button type="button" class="contact-pop-item" data-pick-contact="${escapeHtml(contact.email)}">
            <span class="contact-row-name">${escapeHtml(contact.name || contact.email)}</span>
            ${contact.name ? `<span class="contact-row-email">${escapeHtml(contact.email)}</span>` : ''}
          </button>`
        )
        .join('')
    : '<p class="contacts-empty">没有匹配的联系人，可直接在地址栏输入</p>';
}

function openContactPicker(field, line) {
  if (state.contactPickField === field && !els.contactPop.hidden) {
    closeContactPicker();
    return;
  }
  state.contactPickField = field;
  renderContactPickList('');
  const box = els.contactPop.parentElement;
  const input = line.querySelector('input');
  const anchorLeft = input ? input.offsetLeft : line.offsetLeft;
  const left = Math.max(0, Math.min(anchorLeft, box.clientWidth - 302));
  els.contactPop.style.left = `${left}px`;
  els.contactPop.style.top = `${line.offsetTop + line.offsetHeight + 2}px`;
  els.contactPop.hidden = false;
  els.contactSearch.value = '';
  els.contactSearch.focus();
}

function composeFieldFor(name) {
  if (name === 'cc') return els.composeCc;
  if (name === 'bcc') return els.composeBcc;
  return els.composeTo;
}

/* The part before `<` is display text, so compare the real address. */
function addressOfPart(part) {
  const match = /<([^>]+)>/.exec(part);
  return String(match ? match[1] : part).trim().toLowerCase();
}

function insertPickedContact(email) {
  const field = composeFieldFor(state.contactPickField);
  const contact = state.contacts.find((item) => item.email === email);
  if (!field || !contact) return;
  const current = field.value.trim();
  const already = current
    .split(',')
    .some((part) => addressOfPart(part) === contact.email.toLowerCase());
  if (!already) {
    const label = contact.name && contact.name !== contact.email ? `${contact.name} <${contact.email}>` : contact.email;
    field.value = current ? `${current.replace(/[,;]\s*$/, '')}, ${label}` : label;
    if (state.compose) {
      state.compose.dirty = true;
      scheduleAutosave();
    }
  }
  closeContactPicker();
  field.focus();
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
    if (state.view.kind === 'contacts') {
      state.contactQuery = query;
      renderContactList();
      return;
    }
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
      if (state.view.kind === 'contacts') return;
      if (state.searchTimer) clearTimeout(state.searchTimer);
      const query = els.searchInput.value.trim();
      if (query) runSearch(query);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (state.view.kind === 'contacts') {
        state.contactQuery = '';
        els.searchInput.value = '';
        els.searchClear.hidden = true;
        renderContactList();
        els.searchInput.blur();
        return;
      }
      clearSearch();
      els.searchInput.blur();
    }
  });

  els.searchClear.addEventListener('click', () => {
    if (state.view.kind === 'contacts') {
      state.contactQuery = '';
      els.searchInput.value = '';
      els.searchClear.hidden = true;
      renderContactList();
      els.searchInput.focus();
      return;
    }
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

  els.selectAll.addEventListener('click', toggleSelectAll);

  if (els.threadToggle) {
    els.threadToggle.addEventListener('click', () => {
      state.threaded = !state.threaded;
      state.thread = null;
      state.selectedKey = null;
      clearChecks();
      writeUi();
      renderHeader();
      renderList();
      clearReader();
    });
  }

  els.batchStar.addEventListener('click', () => batchSetFlags(['\\Flagged'], [], '已加星标'));
  els.batchUnstar.addEventListener('click', () => batchSetFlags([], ['\\Flagged'], '已取消星标'));
  els.batchRead.addEventListener('click', () => batchSetFlags(['\\Seen'], [], '已标为已读'));
  els.batchUnread.addEventListener('click', () => batchSetFlags([], ['\\Seen'], '已标为未读'));
  els.batchArchive.addEventListener('click', () => batchMove('archive', '已归档'));
  els.batchRestore.addEventListener('click', batchRestore);
  els.batchTrash.addEventListener('click', () => batchMove('trash', '已删除'));
  els.batchClear.addEventListener('click', () => {
    clearChecks();
    renderList({ preserveScroll: true });
  });

  els.sidebarNav.addEventListener('click', (event) => {
    const unified = event.target.closest('[data-nav="unified"]');
    if (unified) {
      navigate({ kind: 'unified' });
      return;
    }
    const starred = event.target.closest('[data-nav="starred"]');
    if (starred) {
      navigate({ kind: 'starred' });
      return;
    }
    const archived = event.target.closest('[data-nav="archived"]');
    if (archived) {
      navigate({ kind: 'archived' });
      return;
    }
    const contacts = event.target.closest('[data-nav="contacts"]');
    if (contacts) {
      navigate({ kind: 'contacts' });
      return;
    }
    const scheduled = event.target.closest('[data-nav="scheduled"]');
    if (scheduled) {
      navigate({ kind: 'scheduled' });
      return;
    }
    const retry = event.target.closest('[data-retry-account]');
    if (retry) {
      event.stopPropagation();
      retryAccount(retry.dataset.retryAccount);
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
    const scheduleRow = event.target.closest('[data-schedule-id]');
    if (scheduleRow) {
      await selectScheduled(scheduleRow.dataset.scheduleId);
      return;
    }
    const threadRow = event.target.closest('[data-thread-key]');
    if (threadRow) {
      await openThread(threadRow.dataset.threadKey);
      return;
    }
    const row = event.target.closest('[data-key]');
    if (!row) return;
    const check = event.target.closest('[data-check]');
    if (check) {
      event.preventDefault();
      toggleCheck(check.dataset.check, { shift: event.shiftKey });
      return;
    }
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
  els.actionTranslate.addEventListener('click', toggleTranslate);
  els.actionReply.addEventListener('click', () => composeFromReader('reply'));
  els.actionReplyAll.addEventListener('click', () => composeFromReader('replyAll'));
  els.actionForward.addEventListener('click', () => composeFromReader('forward'));
  els.actionArchive.addEventListener('click', archiveCurrent);
  els.actionRestore.addEventListener('click', restoreCurrent);
  els.actionTrash.addEventListener('click', deleteCurrent);

  if (els.readerThread) {
    els.readerThread.addEventListener('click', async (event) => {
      const chip = event.target.closest('[data-thread-uid]');
      if (!chip || !state.thread) return;
      const message = state.thread.messages.find(
        (item) => Number(item.uid) === Number(chip.dataset.threadUid) && item.path === chip.dataset.threadPath
      );
      if (message) selectThreadMessage(message);
    });
  }

  els.readerAttachments.addEventListener('click', async (event) => {
    const saveAll = event.target.closest('[data-save-all-attachments]');
    if (saveAll && state.reader) {
      saveAll.disabled = true;
      try {
        const result = await api.mail.saveAllAttachments({
          accountId: state.reader.accountId,
          path: state.reader.path,
          uid: state.reader.uid
        });
        if (result && result.canceled === false) {
          toast(`已保存 ${result.files.length} 个附件`);
        }
      } catch (err) {
        toast(err && err.message ? err.message : '无法保存附件');
      } finally {
        saveAll.disabled = false;
      }
      return;
    }
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
  bindContactsView();
  bindScheduledView();
  bindCompose();
  bindKeyboard();
}

function bindScheduledView() {
  if (!els.scheduledDetail) return;
  els.scheduledDetail.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-schedule-action]');
    if (!button) return;
    const id = state.selectedScheduleId;
    if (!id) return;
    if (button.dataset.scheduleAction === 'edit') {
      editScheduled(state.scheduledDetail);
    } else if (button.dataset.scheduleAction === 'send') {
      await sendScheduledNow(id);
    } else if (button.dataset.scheduleAction === 'cancel') {
      await cancelScheduled(id);
    } else if (button.dataset.scheduleAction === 'delete') {
      await deleteScheduled(id);
    }
  });
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
    state.oauth = null;
    state.oauthPending = false;
  });

  els.accountForm.addEventListener('submit', (event) => {
    event.preventDefault();
    submitAccountForm();
  });

  els.accountProvider.addEventListener('change', () => {
    const provider = providerById(els.accountProvider.value);
    const wasOAuth = state.accountAuth === 'oauth2';
    clearOAuthTicket();
    applyProviderToForm(provider);
    if (wasOAuth && oauthProviderOf(provider)) setAccountAuth('oauth2');
  });

  for (const input of document.querySelectorAll('input[name="account-auth-type"]')) {
    input.addEventListener('change', () => setAccountAuth(input.value));
  }

  els.accountOauthBtn.addEventListener('click', startAccountOAuth);

  els.accountPassword.addEventListener('input', updatePasswordFormatHint);

  els.accountHelp.addEventListener('click', () => {
    const url = els.accountHelp.dataset.url;
    if (url) api.app.open(url).catch(() => {});
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
  els.ruleNew.addEventListener('click', () => openRuleForm());
  els.ruleCancel.addEventListener('click', closeRuleForm);
  els.ruleForm.addEventListener('submit', (event) => {
    event.preventDefault();
    submitRuleForm();
  });
  els.ruleList.addEventListener('click', async (event) => {
    const edit = event.target.closest('[data-edit-rule]');
    if (edit) {
      const rule = state.rules.find((item) => item.id === edit.dataset.editRule);
      if (rule) openRuleForm(rule);
      return;
    }
    const remove = event.target.closest('[data-remove-rule]');
    if (remove) await removeRule(remove.dataset.removeRule);
  });
  els.ruleList.addEventListener('change', (event) => {
    const toggle = event.target.closest('[data-toggle-rule]');
    if (toggle) toggleRule(toggle.dataset.toggleRule, toggle.checked);
  });
  els.blacklistAdd.addEventListener('click', addBlacklistEntry);
  els.blacklistEmail.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addBlacklistEntry();
    }
  });
  els.blacklistList.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-remove-blacklist]');
    if (remove) removeBlacklistEntry(remove.dataset.removeBlacklist);
  });
  els.settingsAddAccount.addEventListener('click', () => openAccountDialog());
  els.generalSave.addEventListener('click', saveGeneralSettings);
  els.deeplKeyInput.addEventListener('input', () => {
    state.deeplKeyTouched = true;
    renderDeeplKeyState();
  });
  els.updateCheckNow.addEventListener('click', () => checkForUpdate());
  els.updateCheckInput.addEventListener('change', saveUpdateSettings);
  els.updateRepoLink.addEventListener('click', () => {
    const url = els.updateRepoLink.dataset.url;
    if (url) api.app.open(url).catch(() => {});
  });
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
  els.updateDownload.addEventListener('click', () => {
    const ready = state.updateReady && state.updateOffer && state.updateReady.version === state.updateOffer.latest;
    if (ready) installUpdate();
    else startUpdateDownload();
  });
  els.updateCancel.addEventListener('click', cancelUpdateDownload);
  els.updateDialog.addEventListener('cancel', (event) => {
    if (state.updateDownloading) event.preventDefault();
  });
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

function bindContactsView() {
  els.contactsViewList.addEventListener('click', (event) => {
    const row = event.target.closest('[data-contact]');
    if (!row) return;
    selectContact(row.dataset.contact);
  });

  els.contactNew.addEventListener('click', startNewContact);

  els.contactDetail.addEventListener('click', (event) => {
    const action = event.target.closest('[data-contact-action]');
    if (!action) return;
    const name = action.dataset.contactAction;
    if (name === 'compose') composeToContact();
    else if (name === 'copy') copyContactEmail();
    else if (name === 'edit') startContactEdit();
    else if (name === 'cancel') cancelContactEdit();
    else if (name === 'delete') removeContact();
    else if (name === 'new') startNewContact();
  });

  els.contactDetail.addEventListener('submit', (event) => {
    if (event.target.id !== 'contact-form') return;
    event.preventDefault();
    submitContactForm();
  });
}

function bindCompose() {
  els.composeClose.addEventListener('click', () => closeCompose());
  els.composeDiscard.addEventListener('click', discardCompose);
  els.composeSend.addEventListener('click', sendCompose);
  els.composeSave.addEventListener('click', () => saveCompose({ manual: true }));
  els.composeAttach.addEventListener('click', () => addComposeAttachments());
  els.composeSchedule.addEventListener('click', openScheduleDialog);
  for (const button of document.querySelectorAll('[data-close="schedule"]')) {
    button.addEventListener('click', closeScheduleDialog);
  }
  els.scheduleForm.addEventListener('submit', (event) => {
    event.preventDefault();
    scheduleCompose();
  });
  els.scheduleDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeScheduleDialog();
  });

  els.compose.addEventListener('dragover', (event) => {
    if (!state.compose) return;
    const hasFiles = Array.from(event.dataTransfer ? event.dataTransfer.types : []).includes('Files');
    if (!hasFiles) return;
    event.preventDefault();
    els.compose.classList.add('is-dragging');
  });
  els.compose.addEventListener('dragleave', (event) => {
    if (!els.compose.contains(event.relatedTarget)) els.compose.classList.remove('is-dragging');
  });
  els.compose.addEventListener('drop', (event) => {
    if (!state.compose) return;
    const hasFiles = Array.from(event.dataTransfer ? event.dataTransfer.types : []).includes('Files');
    if (!hasFiles) return;
    event.preventDefault();
    els.compose.classList.remove('is-dragging');
    const files = droppedFiles(event);
    if (files.length) addComposeAttachments(files);
  });
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

  for (const button of document.querySelectorAll('.contact-pick')) {
    button.addEventListener('click', () => {
      if (!state.compose) return;
      openContactPicker(button.dataset.pick, button.closest('.compose-line'));
    });
  }
  els.contactSearch.addEventListener('input', () => renderContactPickList(els.contactSearch.value));
  els.contactSearch.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      const field = composeFieldFor(state.contactPickField);
      closeContactPicker();
      field.focus();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const first = els.contactPopList.querySelector('[data-pick-contact]');
      if (first) insertPickedContact(first.dataset.pickContact);
    }
  });
  els.contactPopList.addEventListener('click', (event) => {
    const item = event.target.closest('[data-pick-contact]');
    if (item) insertPickedContact(item.dataset.pickContact);
  });
  els.compose.addEventListener('click', (event) => {
    if (els.contactPop.hidden) return;
    if (event.target.closest('.contact-pop') || event.target.closest('.contact-pick')) return;
    closeContactPicker();
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
        if (!els.contactPop.hidden) {
          const field = composeFieldFor(state.contactPickField);
          closeContactPicker();
          field.focus();
          return;
        }
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
      } else if (state.checked.size) {
        event.preventDefault();
        clearChecks();
        renderList({ preserveScroll: true });
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
    openAccount: (id) => openAccountDialog(id),
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
    },
    pushMail: (accountId) => {
      const id = String(accountId || (state.accounts[0] && state.accounts[0].id) || '');
      if (id && typeof window.__dymailPush === 'function') window.__dymailPush(id);
      return Boolean(id);
    }
  };
}
