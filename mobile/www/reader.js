import { h, ic, iconBtn, openPage, closeTop, actionSheet, confirmSheet, toast, person, fmtFull, fmtSize } from './ui.js';
import { S, hooks, keyOf, roleOf, setSeen, setStar, moveTo, remove, restore } from './state.js';
import { buildEmailDocument } from './shared/sanitize.js';
import { openCompose } from './compose.js';
import { translateDocument } from './translate.js';

async function openExternal(href) {
  const yes = await confirmSheet({ title: '打开外部链接？', message: href.length > 160 ? `${href.slice(0, 160)}…` : href, ok: '打开' });
  if (!yes) return;
  try {
    await S.api.app.open(href);
  } catch (err) {
    toast(err && err.message ? err.message : '无法打开链接');
  }
}

/* Runs on every iframe load: tidies the document, scales over-wide mails to the screen,
   keeps the frame as tall as its content, and routes link taps through our own confirmation. */
function prepareFrame(frame) {
  const doc = frame.contentDocument;
  if (!doc || !doc.documentElement || !doc.body) return;
  /* Property assignment (not a <style> tag) so it keeps working under the message's own CSP. */
  doc.body.style.margin = '0';
  doc.body.style.overflowWrap = 'anywhere';
  for (const el of doc.querySelectorAll('img, video, table')) {
    el.style.maxWidth = '100%';
    if (el.tagName === 'IMG') el.style.height = 'auto';
  }
  const fit = () => {
    doc.body.style.zoom = '';
    const available = frame.clientWidth;
    const width = Math.max(doc.documentElement.scrollWidth, doc.body.scrollWidth);
    if (available && width > available + 2) doc.body.style.zoom = String(available / width);
    frame.style.height = `${Math.ceil(doc.documentElement.scrollHeight)}px`;
  };
  frame.__fit = fit;
  fit();
  setTimeout(fit, 350);
  for (const img of doc.images) img.addEventListener('load', fit);
  doc.addEventListener('click', (event) => {
    const link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!link) return;
    event.preventDefault();
    const href = link.getAttribute('href') || '';
    if (/^https?:\/\//i.test(href)) openExternal(href);
    else if (/^mailto:/i.test(href)) openCompose({ kind: 'new', to: decodeURIComponent(href.slice(7).split('?')[0]) });
  });
}

function mountBody(host, full, allowRemote) {
  host.replaceChildren();
  host.__tr = null; // a fresh document is untranslated
  const dark = document.documentElement.dataset.theme === 'dark';
  const built = buildEmailDocument({ html: full.html, text: full.text, allowRemote, theme: dark ? 'dark' : 'light' });
  if (built.hasRemote && !allowRemote) {
    host.append(
      h(
        'div',
        { class: 'remote' },
        h('span', null, '已阻止远程图片'),
        h('button', { type: 'button', onClick: () => mountBody(host, full, true) }, '加载')
      )
    );
  }
  const frame = h('iframe', { class: 'mailframe', sandbox: 'allow-same-origin', title: '邮件正文' });
  frame.addEventListener('load', () => prepareFrame(frame));
  frame.srcdoc = built.document;
  host.__frame = frame;
  host.append(frame);
}

async function toggleTranslate(card) {
  const host = card && card.host;
  const frame = host && host.__frame;
  if (!frame || !frame.contentDocument || !frame.contentDocument.body) return toast('正文还没有加载完成');
  if (host.__tr) {
    host.__tr.restore();
    host.__tr = null;
    if (frame.__fit) frame.__fit();
    return toast('已显示原文');
  }
  toast('正在翻译正文…');
  try {
    const result = await translateDocument(frame.contentDocument, S.api);
    host.__tr = result;
    if (frame.__fit) frame.__fit();
    const tail = result.truncated ? '（正文过长，只翻译了前面部分）' : '';
    toast(result.notice ? `${result.notice}${tail}` : `已翻译成中文${result.provider === 'deepl' ? '（DeepL）' : ''}${tail}`);
  } catch (err) {
    toast(err && err.message ? err.message : '翻译失败');
  }
}

async function blockSender(full) {
  const address = person(full.from).address;
  if (!address) {
    toast('没有可屏蔽的地址');
    return false;
  }
  const yes = await confirmSheet({
    title: `屏蔽 ${address}？`,
    message: '今后来自该地址的邮件会自动移入「已删除」。',
    ok: '屏蔽',
    danger: true
  });
  if (!yes) return false;
  try {
    await S.api.rules.addBlacklist(address);
    toast('已屏蔽');
    return true;
  } catch (err) {
    toast(err && err.message ? err.message : '屏蔽失败');
    return false;
  }
}

/* One page for both cases: a single mail (one always-open card) and a conversation
   (a card per message, newest open). `targets` are the list rows the toolbar acts on. */
function openConversation({ targets, summaries, subject, fetchThread }) {
  const latest = targets.reduce((a, b) => ((b.timestamp || 0) > (a.timestamp || 0) ? b : a), targets[0]);
  let items = summaries.slice();
  let active = null;
  let starBtn;
  let listEl;
  let bar;
  const cards = [];

  const sortAsc = (list) => list.slice().sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0) || a.uid - b.uid);

  function buildBar() {
    if (!active || !active.full) return;
    const role = roleOf(latest);
    const inTrash = role === 'trash';
    const inArchive = role === 'archive';
    const me = String((S.accounts.find((a) => a.id === latest.accountId) || {}).email || '').toLowerCase();
    const full = active.full;
    const others = [...(full.to || []), ...(full.cc || [])].filter((a) => a && a.address && a.address.toLowerCase() !== me);
    const multi = others.length > 1;

    const pill = (name, label, onClick) =>
      h('button', { class: 'pillbtn', type: 'button', onClick }, ic(name, 20), label ? h('span', null, label) : null);

    bar.replaceChildren(
      pill('reply', '回复', () => {
        if (!multi) return openCompose({ kind: 'reply', full });
        actionSheet('', [
          { label: '回复', icon: 'reply', run: () => openCompose({ kind: 'reply', full }) },
          { label: '全部回复', icon: 'reply', run: () => openCompose({ kind: 'replyAll', full }) }
        ]);
      }),
      pill('forward', '转发', () => openCompose({ kind: 'forward', full })),
      h('span', { class: 'sep' }),
      inTrash
        ? pill('undo', '', async () => { if (await restore(targets)) closeTop(); })
        : pill('archive', '', async () => {
            const ok = inArchive ? await moveTo(targets, 'inbox', '已移回收件箱') : await moveTo(targets, 'archive', '已归档');
            if (ok) closeTop();
          }),
      pill('trash', '', async () => { if (await remove(targets)) closeTop(); })
    );
    bar.hidden = false;
  }

  function markSeen(m) {
    let changed = false;
    if (!m.seen) {
      m.seen = true;
      changed = true;
    }
    const key = keyOf(m);
    for (const row of S.messages) {
      if (keyOf(row) === key && !row.seen) {
        row.seen = true;
        changed = true;
      }
    }
    if (changed) {
      hooks.render();
      hooks.refreshAccounts(true);
    }
  }

  async function load(card) {
    if (card.full || card.loading) return;
    card.loading = true;
    card.body.replaceChildren(h('div', { class: 'loading' }, h('span', { class: 'spinner' })));
    try {
      const full = await S.api.mail.read({ accountId: card.m.accountId, path: card.m.path, uid: card.m.uid });
      card.full = full;
      markSeen(card.m);
      const toList = (full.to || []).map((a) => person(a).label).filter(Boolean).join('、');
      const ccList = (full.cc || []).map((a) => person(a).label).filter(Boolean).join('、');
      const atts = full.attachments || [];
      card.host = h('div');
      card.body.replaceChildren(
        toList || ccList
          ? h('div', { class: 'tolines', style: 'margin-left:0' }, toList ? `发给 ${toList}` : '', ccList ? `${toList ? ' · ' : ''}抄送 ${ccList}` : '')
          : null,
        atts.length
          ? h(
              'div',
              { class: 'chips' },
              atts.map((att) =>
                h(
                  'button',
                  {
                    class: 'chip',
                    type: 'button',
                    onClick: async () => {
                      try {
                        await S.api.mail.saveAttachment({ accountId: full.accountId, path: full.path, uid: full.uid, index: att.index, name: att.name });
                        toast('已保存附件');
                      } catch (err) {
                        toast(err && err.message ? err.message : '保存失败');
                      }
                    }
                  },
                  ic('clip', 16),
                  h('span', { class: 'n' }, att.name),
                  h('small', null, fmtSize(att.size))
                )
              )
            )
          : null,
        card.host
      );
      mountBody(card.host, full, S.settings.remoteImages !== 'block');
      if (card.open) {
        active = card;
        buildBar();
      }
    } catch (err) {
      card.body.replaceChildren(h('div', { class: 'hint' }, err && err.message ? err.message : '读取失败'));
    } finally {
      card.loading = false;
    }
  }

  function makeCard(m, collapsible, open) {
    const from = person(m.from);
    const card = { m, open, full: null, loading: false, host: null };
    card.body = h('div', { class: 'cardbody' });
    const head = h(
      'div',
      { class: 'who' },
      h('div', { class: 'avatar' }, (from.label || '?').slice(0, 1).toUpperCase()),
      h('div', { class: 'info' }, h('div', { class: 'name' }, from.label), h('div', { class: 'addr' }, from.name ? from.address : '')),
      h('div', { class: 'date' }, fmtFull(m.date || m.timestamp)),
      collapsible ? h('span', { class: 'chev' }, ic('right', 16)) : null
    );
    card.el = h('div', { class: `mcard${collapsible ? ' collapsible' : ''}${open ? '' : ' closed'}` }, head, card.body);
    if (collapsible) {
      head.addEventListener('click', () => {
        card.open = !card.open;
        card.el.classList.toggle('closed', !card.open);
        if (card.open) {
          active = card;
          if (card.full) buildBar();
          else load(card);
        }
      });
    }
    return card;
  }

  function drawCards() {
    const sorted = sortAsc(items);
    const collapsible = sorted.length > 1;
    cards.length = 0;
    listEl.replaceChildren(
      ...sorted.map((m, index) => {
        const open = index === sorted.length - 1;
        const card = makeCard(m, collapsible, open);
        cards.push(card);
        return card.el;
      })
    );
    const last = cards[cards.length - 1];
    if (last) {
      active = last;
      load(last);
    }
  }

  openPage((root) => {
    const allStarred = () => targets.every((t) => t.flagged);
    starBtn = iconBtn(
      'star',
      '星标',
      async () => {
        const next = !allStarred();
        if (await setStar(targets, next)) starBtn.classList.toggle('on', next);
      },
      allStarred() ? 'on' : ''
    );
    listEl = h('div', null, h('div', { class: 'loading' }, h('span', { class: 'spinner' })));
    bar = h('div', { class: 'actionbar', hidden: true });

    root.append(
      h(
        'header',
        { class: 'topbar' },
        iconBtn('back', '返回', () => closeTop()),
        h('div', { class: 'title' }),
        starBtn,
        iconBtn('more', '更多', () => {
          if (!active || !active.full) return;
          const card = active;
          actionSheet('', [
            { label: '标为未读', icon: 'mailcheck', run: async () => { if (await setSeen(targets, false)) closeTop(); } },
            { label: card.host && card.host.__tr ? '显示原文' : '翻译成中文', icon: 'languages', run: () => toggleTranslate(card) },
            {
              label: '屏蔽此发件人',
              icon: 'ban',
              danger: true,
              run: async () => {
                if (!(await blockSender(card.full))) return;
                if (roleOf(latest) !== 'trash' && (await moveTo(targets, 'trash', '已屏蔽并移到「已删除」'))) closeTop();
              }
            },
            {
              label: '复制发件人地址',
              icon: 'user',
              run: () => { S.api.app.copyText(person(card.full.from).address).then(() => toast('已复制'), () => toast('复制失败')); }
            }
          ]);
        })
      ),
      h(
        'div',
        { class: 'scroll' },
        h('div', { class: 'reader-body' }, h('h1', null, subject || '（无主题）'), listEl)
      ),
      bar
    );
  });

  (async () => {
    if (fetchThread) {
      try {
        const data = await S.api.mail.thread({ accountId: latest.accountId, subject: latest.subject, path: latest.path });
        const list = Array.isArray(data && data.messages) ? data.messages : [];
        if (list.length) items = list;
      } catch {
        /* the rows we already have are enough to show something */
      }
    }
    drawCards();
  })();
}

export function openReader(m) {
  openConversation({ targets: [m], summaries: [m], subject: m.subject, fetchThread: false });
}

export function openThread(group) {
  openConversation({ targets: group.messages, summaries: group.messages, subject: group.subject || group.latest.subject, fetchThread: true });
}
