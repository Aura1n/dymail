/* The mobile counterpart of src/preload/preload.js.
 *
 * Builds the same `dymail.*` surface the desktop renderer uses, but over the loopback bridge served
 * by mobile/core/index.js (POST /rpc for calls, Server-Sent Events for pushes). Keep this file in
 * step with preload.js: every channel here must exist in main.js's registerIpc(). */

export function createNativeApi({ url, token }) {
  const base = String(url).replace(/\/+$/, '');

  async function call(channel, payload) {
    let response;
    try {
      response = await fetch(`${base}/rpc`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dymail-token': token },
        body: JSON.stringify({ channel, payload: payload === undefined ? {} : payload })
      });
    } catch {
      throw new Error('无法连接本地邮件服务，请重启应用');
    }
    let body = null;
    try {
      body = await response.json();
    } catch {
      /* handled below */
    }
    if (!body || body.ok !== true) throw new Error((body && body.error) || '操作失败');
    return body.data;
  }

  /* Opening links and copying text must happen inside the app, so the core asks us to do it. */
  async function openLink(link) {
    const href = String(link || '');
    if (!/^https?:\/\//i.test(href)) throw new Error('只允许打开 http(s) 链接');
    const browser = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser;
    if (browser && browser.open) await browser.open({ url: href });
    else window.open(href, '_blank', 'noopener,noreferrer');
    return true;
  }

  async function copy(text) {
    const value = String(text || '');
    if (!value) throw new Error('没有可复制的内容');
    await navigator.clipboard.writeText(value);
    return true;
  }

  const listeners = new Map();
  const PUSHES = ['mail:push', 'mail:status', 'mail:filtered', 'scheduled:changed', 'update:progress'];

  /* Opened right away (not on first subscribe): commands from the core, such as "open the sign-in page
     in the browser" during OAuth, can arrive before the UI subscribes to anything. */
  let source = null;
  function connectEvents() {
    if (typeof EventSource === 'undefined') return;
    source = new EventSource(`${base}/events?token=${encodeURIComponent(token)}`);
    for (const name of PUSHES) {
      source.addEventListener(name, (event) => {
        let data = null;
        try {
          data = JSON.parse(event.data);
        } catch {
          /* keep null */
        }
        const fn = listeners.get(name);
        if (fn) fn(data);
      });
    }
    source.addEventListener('native', (event) => {
      let command = null;
      try {
        command = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!command) return;
      if (command.type === 'open' && command.url) openLink(command.url).catch(() => {});
      else if (command.type === 'copy' && command.text) copy(command.text).catch(() => {});
    });
  }
  connectEvents();

  const subscribe = (channel) => (handler) => {
    if (typeof handler === 'function') listeners.set(channel, handler); // one listener per channel, like the preload
  };

  return {
    app: {
      info: () => call('app:info'),
      open: openLink,
      copyText: copy,
      getAutoLaunch: async () => false,
      setAutoLaunch: async () => false,
      notify: (payload) => call('app:notify', payload)
    },
    update: {
      check: () => call('mobile:update-check'),
      download: async () => { throw new Error('请通过下载链接安装更新'); },
      install: async () => false,
      cancel: async () => true,
      onProgress: subscribe('update:progress')
    },
    accounts: {
      list: () => call('accounts:list'),
      save: (payload) => call('accounts:save', payload),
      remove: (id) => call('accounts:remove', { id }),
      oauthStart: (provider) => call('accounts:oauth-authorize', { provider }),
      oauthProviders: () => call('mobile:oauth-providers')
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
      thread: (payload) => call('mail:thread', payload),
      read: (payload) => call('mail:read', payload),
      setFlags: (payload) => call('mail:set-flags', payload),
      markAllRead: (payload) => call('mail:mark-all-read', payload),
      move: (payload) => call('mail:move', payload),
      deletePermanent: (payload) => call('mail:delete-permanent', payload),
      restore: (payload) => call('mail:restore', payload),
      purgeTrash: () => call('mail:purge-trash', {}),
      saveAttachment: (payload) => call('mail:save-attachment', payload),
      saveAllAttachments: (payload) => call('mail:save-all-attachments', payload),
      onPush: subscribe('mail:push'),
      onStatus: subscribe('mail:status'),
      onFiltered: subscribe('mail:filtered')
    },
    compose: { send: (payload) => call('compose:send', payload) },
    drafts: {
      list: (accountId) => call('drafts:list', { accountId }),
      get: (id) => call('drafts:get', { id }),
      save: (payload) => call('drafts:save', payload),
      remove: (id) => call('drafts:remove', { id })
    },
    scheduled: {
      list: (accountId) => call('scheduled:list', { accountId }),
      cancel: (id) => call('scheduled:cancel', { id }),
      sendNow: (id) => call('scheduled:send-now', { id }),
      onChange: subscribe('scheduled:changed')
    },
    rules: {
      list: () => call('rules:list'),
      save: (payload) => call('rules:save', payload),
      remove: (id) => call('rules:remove', { id }),
      addBlacklist: (email) => call('blacklist:add', { email }),
      removeBlacklist: (email) => call('blacklist:remove', { email })
    },
    contacts: {
      list: () => call('contacts:list'),
      save: (payload) => call('contacts:save', payload),
      remove: (payload) => call('contacts:remove', payload)
    },
    settings: {
      get: () => call('settings:get'),
      update: (patch) => call('settings:update', patch),
      setDeeplKey: (key) => call('settings:set-deepl-key', { key })
    },
    translate: { segments: (segments) => call('translate:segments', { segments }) },
    /* A phone has no file paths to hand over: stage() uploads the bytes to the core, which returns a path. */
    files: {
      pick: async () => [],
      pathFor: () => '',
      stage: (name, data) => call('mobile:stage-file', { name, data })
    }
  };
}
