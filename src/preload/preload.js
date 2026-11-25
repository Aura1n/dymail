'use strict';

const { contextBridge, ipcRenderer } = require('electron');

async function call(channel, payload) {
  const response = await ipcRenderer.invoke(channel, payload);
  if (!response || response.ok !== true) {
    throw new Error((response && response.error) || '操作失败');
  }
  return response.data;
}

let mailPushListener = null;

function onMailPush(handler) {
  if (typeof handler !== 'function') return;
  if (mailPushListener) ipcRenderer.removeListener('mail:push', mailPushListener);
  mailPushListener = (_event, payload) => handler(payload);
  ipcRenderer.on('mail:push', mailPushListener);
}

let mailStatusListener = null;

function onMailStatus(handler) {
  if (typeof handler !== 'function') return;
  if (mailStatusListener) ipcRenderer.removeListener('mail:status', mailStatusListener);
  mailStatusListener = (_event, payload) => handler(payload);
  ipcRenderer.on('mail:status', mailStatusListener);
}

let updateProgressListener = null;

function onUpdateProgress(handler) {
  if (typeof handler !== 'function') return;
  if (updateProgressListener) ipcRenderer.removeListener('update:progress', updateProgressListener);
  updateProgressListener = (_event, payload) => handler(payload);
  ipcRenderer.on('update:progress', updateProgressListener);
}

contextBridge.exposeInMainWorld('dymail', {
  app: {
    info: () => call('app:info'),
    open: (url) => call('app:open', { url }),
    getAutoLaunch: () => call('app:get-autolaunch'),
    setAutoLaunch: (enabled) => call('app:set-autolaunch', { enabled }),
    notify: (payload) => call('app:notify', payload)
  },
  update: {
    check: () => call('update:check'),
    download: (version) => call('update:download', { version }),
    install: () => call('update:install'),
    cancel: () => call('update:cancel'),
    onProgress: onUpdateProgress
  },
  accounts: {
    list: () => call('accounts:list'),
    save: (payload) => call('accounts:save', payload),
    remove: (id) => call('accounts:remove', { id }),
    oauthStart: (provider) => call('accounts:oauth-authorize', { provider })
  },
  folders: {
    sync: () => call('folders:sync'),
    syncOne: (accountId) => call('folders:sync-one', { accountId })
  },
  mail: {
    statuses: () => call('mail:statuses'),
    list: (payload) => call('mail:list', payload),
    listUnified: (payload) => call('mail:list-unified', payload),
    listStarred: (payload) => call('mail:list-starred', payload),
    listArchived: (payload) => call('mail:list-archived', payload),
    search: (payload) => call('mail:search', payload),
    read: (payload) => call('mail:read', payload),
    document: (document) => call('mail:document', { document }),
    setFlags: (payload) => call('mail:set-flags', payload),
    markAllRead: (payload) => call('mail:mark-all-read', payload),
    move: (payload) => call('mail:move', payload),
    deletePermanent: (payload) => call('mail:delete-permanent', payload),
    restore: (payload) => call('mail:restore', payload),
    purgeTrash: () => call('mail:purge-trash', {}),
    saveAttachment: (payload) => call('mail:save-attachment', payload),
    onPush: onMailPush,
    onStatus: onMailStatus
  },
  compose: {
    send: (payload) => call('compose:send', payload)
  },
  drafts: {
    list: (accountId) => call('drafts:list', { accountId }),
    get: (id) => call('drafts:get', { id }),
    save: (payload) => call('drafts:save', payload),
    remove: (id) => call('drafts:remove', { id })
  },
  contacts: {
    list: () => call('contacts:list'),
    save: (payload) => call('contacts:save', payload),
    remove: (payload) => call('contacts:remove', payload)
  },
  files: {
    pick: () => call('files:pick')
  },
  settings: {
    get: () => call('settings:get'),
    update: (patch) => call('settings:update', patch),
    setDeeplKey: (key) => call('settings:set-deepl-key', { key })
  },
  translate: {
    segments: (segments) => call('translate:segments', { segments })
  },
  dialog: {
    confirm: (payload) => call('dialog:confirm', payload)
  },
  window: {
    setChrome: (payload) => call('window:set-chrome', payload)
  }
});
