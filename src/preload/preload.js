'use strict';

const { contextBridge, ipcRenderer } = require('electron');

async function call(channel, payload) {
  const response = await ipcRenderer.invoke(channel, payload);
  if (!response || response.ok !== true) {
    throw new Error((response && response.error) || '操作失败');
  }
  return response.data;
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
    check: () => call('update:check')
  },
  accounts: {
    list: () => call('accounts:list'),
    save: (payload) => call('accounts:save', payload),
    remove: (id) => call('accounts:remove', { id })
  },
  folders: {
    sync: () => call('folders:sync')
  },
  mail: {
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
    saveAttachment: (payload) => call('mail:save-attachment', payload)
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
