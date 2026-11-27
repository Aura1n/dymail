import { h, ic, iconBtn, openPage, openSheet, closeTop, actionSheet, confirmSheet, toast, person, fmtFull, fmtSize, fmtSchedule } from './ui.js';
import { S, hooks, accountById, loadContacts } from './state.js';
import { escapeHtml } from './shared/sanitize.js';

const MAX_TOTAL = 25 * 1024 * 1024; // same ceiling the mail layer enforces
const MAX_FILES = 20;

export function plainFromHtml(html) {
  if (!html) return '';
  const source = String(html).replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h[1-6]|tr|blockquote)>/gi, '\n');
  const doc = new DOMParser().parseFromString(source, 'text/html');
  for (const el of doc.querySelectorAll('script, style, head')) el.remove();
  return String((doc.body && doc.body.textContent) || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function textToHtml(text) {
  const trimmed = String(text || '').replace(/\s+$/, '');
  if (!trimmed) return '';
  return trimmed
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export function fmtAddr(a) {
  const p = person(a);
  if (!p.address) return '';
  if (!p.name || p.name === p.address) return p.address;
  return /[,;"<>]/.test(p.name) ? `"${p.name.replace(/"/g, '')}" <${p.address}>` : `${p.name} <${p.address}>`;
}

const prefixed = (subject, prefix) => {
  const s = String(subject || '').trim();
  return new RegExp(`^${prefix}\\s*[:：]`, 'i').test(s) ? s : `${prefix}: ${s}`;
};

const toBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error(`读取失败：${file.name}`));
    reader.readAsDataURL(file);
  });

/* The core wants a path, the WebView only has bytes: hand them over and get a path back.
   (The demo build has no core, so it just fabricates one — nothing is sent anywhere.) */
async function stageFile(file) {
  if (!S.api.files || typeof S.api.files.stage !== 'function') {
    return { name: file.name, size: file.size, path: `demo://${file.name}` };
  }
  return S.api.files.stage(file.name, await toBase64(file));
}

const pad = (n) => String(n).padStart(2, '0');
const localInput = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;

/* kind: new | reply | replyAll | forward | draft */
export function openCompose(opts = {}) {
  const kind = opts.kind || 'new';
  const full = opts.full || null;
  const fallbackAccount =
    (opts.accountId && accountById(opts.accountId)) || (S.view.accountId && accountById(S.view.accountId)) || S.accounts[0];

  if (!fallbackAccount) {
    toast('请先添加一个邮箱账户');
    return;
  }

  const st = {
    id: null,
    kind,
    accountId: fallbackAccount.id,
    to: '',
    cc: '',
    bcc: '',
    subject: '',
    body: '',
    quote: '',
    quoteHtml: '',
    inReplyTo: '',
    references: '',
    attachments: [],
    sendAt: '',
    origSendAt: '', // the schedule the draft had when it was opened; only a deliberate "send" may change it
    showCc: false,
    sending: false,
    uploading: 0,
    dirty: false,
    done: false
  };

  const signature = (S.settings.signature || '').trim();
  const withSignature = () => (signature ? `\n\n${signature}` : '');

  if (kind === 'draft' && opts.draft) {
    const d = opts.draft;
    st.id = d.id;
    st.accountId = d.accountId;
    st.to = d.to || '';
    st.cc = d.cc || '';
    st.bcc = d.bcc || '';
    st.subject = d.subject || '';
    st.body = plainFromHtml(d.html);
    st.inReplyTo = d.inReplyTo || '';
    st.references = d.references || '';
    st.attachments = Array.isArray(d.attachments) ? d.attachments.map((a) => ({ name: a.name, path: a.path, size: a.size })) : [];
    st.sendAt = d.sendAt || '';
    st.origSendAt = st.sendAt;
    st.showCc = Boolean(st.cc || st.bcc);
  } else if (full && kind !== 'new') {
    st.accountId = full.accountId;
    const me = String((accountById(full.accountId) || {}).email || '').toLowerCase();
    const from = full.from || {};
    const original = (full.text && full.text.trim()) || plainFromHtml(full.html);
    const when = fmtFull(full.date);
    const who = person(from).label;

    if (kind === 'forward') {
      st.subject = prefixed(full.subject, 'Fwd');
      st.quote = `---------- 转发的邮件 ----------\n发件人：${fmtAddr(from)}\n日期：${when}\n主题：${full.subject || ''}\n\n${original}`;
      st.quoteHtml = `<p>---------- 转发的邮件 ----------<br>发件人：${escapeHtml(fmtAddr(from))}<br>日期：${escapeHtml(when)}<br>主题：${escapeHtml(full.subject || '')}</p>${textToHtml(original)}`;
    } else {
      st.subject = prefixed(full.subject, 'Re');
      const fromMe = String(from.address || '').toLowerCase() === me;
      const others = [...(full.to || []), ...(full.cc || [])].filter(
        (a) => a && a.address && a.address.toLowerCase() !== me && a.address.toLowerCase() !== String(from.address || '').toLowerCase()
      );
      st.to = fromMe ? (full.to || []).map(fmtAddr).filter(Boolean).join(', ') : fmtAddr(from);
      if (kind === 'replyAll') {
        st.cc = others.map(fmtAddr).join(', ');
        st.showCc = Boolean(st.cc);
      }
      st.inReplyTo = full.messageId || '';
      st.references = `${full.references || ''} ${full.messageId || ''}`.trim();
      st.quote = `${when}，${who} 写道：\n${original.split('\n').map((line) => `> ${line}`).join('\n')}`;
      st.quoteHtml = `<p>${escapeHtml(`${when}，${who} 写道：`)}</p><blockquote style="margin:0 0 0 .5em;padding-left:1em;border-left:2px solid #ccc">${textToHtml(original)}</blockquote>`;
    }
    st.body = withSignature();
  } else {
    if (opts.to) st.to = opts.to;
    st.body = withSignature();
  }

  let sendBtn;
  let toInput;
  let textarea;
  let acctLabel;
  let attachRow;
  let schedRow;
  let suggest;
  let contacts = [];
  loadContacts().then((list) => { contacts = list; });

  const totalBytes = () => st.attachments.reduce((sum, a) => sum + (Number(a.size) || 0), 0);
  const canSend = () => st.to.trim().length > 0 && !st.sending && !st.uploading;
  const mark = () => { st.dirty = true; };

  const refresh = () => {
    if (!sendBtn) return;
    sendBtn.disabled = !canSend();
    sendBtn.replaceChildren(ic(st.sendAt ? 'clock' : 'up', 20));
    sendBtn.setAttribute('aria-label', st.sendAt ? '定时发送' : '发送');
  };

  /* ---- recipients with contact suggestions ---- */
  const lastToken = (value) => {
    const cut = Math.max(value.lastIndexOf(','), value.lastIndexOf(';'));
    return { head: value.slice(0, cut + 1), token: value.slice(cut + 1).trim() };
  };

  const hideSuggest = () => { suggest.hidden = true; suggest.replaceChildren(); };
  const showSuggest = (input, key) => {
    const { head, token } = lastToken(input.value);
    if (!token) return hideSuggest();
    const q = token.toLowerCase();
    const found = contacts
      .filter((c) => c.email.toLowerCase().includes(q) || String(c.name || '').toLowerCase().includes(q))
      .slice(0, 6);
    if (!found.length) return hideSuggest();
    suggest.replaceChildren(
      ...found.map((c) =>
        h(
          'button',
          {
            class: 'pillchip',
            type: 'button',
            onMousedown: (e) => e.preventDefault(), // keep the keyboard up
            onClick: () => {
              const entry = fmtAddr({ name: c.name, address: c.email });
              st[key] = `${head ? `${head.trimEnd()} ` : ''}${entry}, `;
              input.value = st[key];
              mark();
              refresh();
              hideSuggest();
              input.focus();
            }
          },
          c.name && c.name !== c.email ? `${c.name}` : c.email
        )
      )
    );
    suggest.hidden = false;
  };

  const bind = (input, key, { suggestions = false } = {}) => {
    input.value = st[key];
    input.addEventListener('input', () => {
      st[key] = input.value;
      mark();
      refresh();
      if (suggestions) showSuggest(input, key);
    });
    if (suggestions) {
      input.addEventListener('focus', () => showSuggest(input, key));
      input.addEventListener('blur', () => setTimeout(hideSuggest, 120));
    }
    return input;
  };

  const field = (label, input, extra) => h('div', { class: 'field' }, h('label', null, label), input, extra);

  /* ---- attachments ---- */
  const drawAttachments = () => {
    attachRow.hidden = st.attachments.length === 0 && !st.uploading;
    attachRow.replaceChildren(
      ...st.attachments.map((a, index) =>
        h(
          'span',
          { class: 'chip' },
          ic('clip', 14),
          h('span', { class: 'n' }, a.name),
          h('small', null, fmtSize(a.size)),
          h('button', { type: 'button', 'aria-label': '移除附件', class: 'x', onClick: () => { st.attachments.splice(index, 1); mark(); drawAttachments(); } }, ic('close', 14))
        )
      ),
      st.uploading ? h('span', { class: 'chip' }, h('span', { class: 'spinner' }), h('span', { class: 'n' }, '正在添加…')) : null
    );
  };

  async function addFiles(fileList) {
    const files = [...fileList];
    for (const file of files) {
      if (st.attachments.length >= MAX_FILES) return toast(`最多添加 ${MAX_FILES} 个附件`);
      if (totalBytes() + file.size > MAX_TOTAL) return toast('附件总大小不能超过 25 MB');
      st.uploading += 1;
      refresh();
      drawAttachments();
      try {
        const staged = await stageFile(file);
        st.attachments.push({ name: staged.name, path: staged.path, size: staged.size });
        mark();
      } catch (err) {
        toast(err && err.message ? err.message : `无法添加 ${file.name}`);
      } finally {
        st.uploading -= 1;
        refresh();
        drawAttachments();
      }
    }
  }

  function pickFiles() {
    const input = h('input', { type: 'file', multiple: true, hidden: true });
    input.addEventListener('change', () => {
      if (input.files && input.files.length) addFiles(input.files);
      input.remove();
    });
    document.body.append(input);
    input.click();
  }

  /* ---- scheduled send ---- */
  const drawSchedule = () => {
    schedRow.hidden = !st.sendAt;
    schedRow.replaceChildren(
      st.sendAt
        ? h(
            'span',
            { class: 'chip' },
            ic('clock', 14),
            h('span', { class: 'n' }, `将于 ${fmtSchedule(st.sendAt)} 发送`),
            h('button', { type: 'button', class: 'x', 'aria-label': '取消定时', onClick: () => setSendAt('') }, ic('close', 14))
          )
        : null
    );
    refresh();
  };

  function setSendAt(value) {
    st.sendAt = value ? new Date(value).toISOString() : '';
    mark();
    drawSchedule();
  }

  function pickSchedule() {
    const now = new Date();
    const at = (date, hour) => { const d = new Date(date); d.setHours(hour, 0, 0, 0); return d; };
    const options = [];
    const evening = at(now, 18);
    if (evening.getTime() > now.getTime() + 10 * 60000) options.push(['今天 18:00', evening]);
    options.push(['明天 09:00', at(new Date(now.getTime() + 86400000), 9)]);
    const monday = new Date(now);
    monday.setDate(monday.getDate() + ((8 - monday.getDay()) % 7 || 7));
    options.push(['下周一 09:00', at(monday, 9)]);

    openSheet((sheet) => {
      const custom = h('input', { class: 'input', type: 'datetime-local', min: localInput(new Date(now.getTime() + 60000)) });
      custom.value = localInput(at(new Date(now.getTime() + 86400000), 9));
      sheet.append(h('h3', null, '定时发送'));
      for (const [label, date] of options) {
        sheet.append(
          h('button', { class: 'sheetitem', type: 'button', onClick: async () => { await closeTop(); setSendAt(date); } }, ic('clock', 20), h('span', null, label))
        );
      }
      sheet.append(
        h('div', { class: 'formrow', style: 'margin:10px 12px 0' }, h('label', null, '自定义时间'), custom),
        h(
          'div',
          { class: 'btnrow' },
          st.sendAt ? h('button', { class: 'btn', type: 'button', onClick: async () => { await closeTop(); setSendAt(''); } }, '取消定时') : null,
          h(
            'button',
            {
              class: 'btn primary',
              type: 'button',
              onClick: async () => {
                const picked = new Date(custom.value);
                if (!custom.value || !Number.isFinite(picked.getTime()) || picked.getTime() < Date.now() + 30000) {
                  return toast('请选择一个未来的时间');
                }
                await closeTop();
                setSendAt(picked);
              }
            },
            '确定'
          )
        )
      );
    });
  }

  /* ---- persistence / sending ---- */
  const payload = (sendAt) => ({
    id: st.id || undefined,
    accountId: st.accountId,
    kind: ['reply', 'replyAll', 'forward'].includes(st.kind) ? st.kind : 'new',
    to: st.to,
    cc: st.cc,
    bcc: st.bcc,
    subject: st.subject,
    html: textToHtml(st.body) + st.quoteHtml,
    inReplyTo: st.inReplyTo,
    references: st.references,
    attachments: st.attachments.map((a) => ({ name: a.name, path: a.path, size: a.size })),
    sendAt
  });

  const refreshViews = () => {
    hooks.refreshAccounts(true);
    if (['drafts', 'scheduled'].includes(S.view.kind) || (S.view.kind === 'folder' && S.view.role === 'sent')) hooks.reload();
  };

  async function saveDraft() {
    /* Closing the page must never start a countdown the user didn't confirm: keep the original schedule. */
    try {
      await S.api.drafts.save(payload(st.origSendAt));
      toast(st.origSendAt ? '已保存修改' : '已存入草稿');
      refreshViews();
    } catch (err) {
      toast(err && err.message ? err.message : '草稿保存失败');
    }
  }

  async function send() {
    if (!canSend()) return;
    if (!st.subject.trim()) {
      const yes = await confirmSheet({ title: '没有主题', message: '仍要发送这封邮件吗？', ok: st.sendAt ? '安排发送' : '发送' });
      if (!yes) return;
    }

    if (st.sendAt) {
      if (Date.parse(st.sendAt) < Date.now() + 30000) return toast('定时时间已过，请重新选择');
      st.sending = true;
      refresh();
      try {
        await S.api.drafts.save(payload(st.sendAt));
        st.done = true;
        await closeTop();
        toast(`已安排在 ${fmtSchedule(st.sendAt)} 发送`);
        refreshViews();
      } catch (err) {
        st.sending = false;
        refresh();
        toast(err && err.message ? err.message : '设置定时发送失败');
      }
      return;
    }

    st.sending = true;
    refresh();
    try {
      const result = await S.api.compose.send({
        accountId: st.accountId,
        to: st.to,
        cc: st.cc,
        bcc: st.bcc,
        subject: st.subject,
        html: textToHtml(st.body) + st.quoteHtml,
        text: st.body + (st.quote ? `\n\n${st.quote}` : ''),
        inReplyTo: st.inReplyTo,
        references: st.references,
        attachments: st.attachments.map((a) => ({ name: a.name, path: a.path, size: a.size }))
      });
      if (st.id) await S.api.drafts.remove(st.id).catch(() => {});
      st.done = true;
      await closeTop();
      toast(result && result.warning ? result.warning : '已发送');
      refreshViews();
    } catch (err) {
      st.sending = false;
      refresh();
      toast(err && err.message ? err.message : '发送失败');
    }
  }

  openPage(
    (page) => {
      toInput = bind(h('input', { type: 'text', inputmode: 'email', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: '姓名或邮箱，多个用逗号分隔' }), 'to', { suggestions: true });
      const ccInput = bind(h('input', { type: 'text', inputmode: 'email', autocapitalize: 'off', placeholder: '抄送' }), 'cc', { suggestions: true });
      const bccInput = bind(h('input', { type: 'text', inputmode: 'email', autocapitalize: 'off', placeholder: '密送' }), 'bcc', { suggestions: true });
      const subjectInput = bind(h('input', { type: 'text', placeholder: '主题' }), 'subject');

      const ccRows = h('div', { hidden: !st.showCc }, field('抄送', ccInput), field('密送', bccInput));
      const ccLink = h(
        'button',
        { class: 'link', type: 'button', onClick: () => { st.showCc = true; ccRows.hidden = false; ccLink.hidden = true; ccInput.focus(); } },
        '抄送/密送'
      );
      ccLink.hidden = st.showCc;

      suggest = h('div', { class: 'suggest chiprow', hidden: true });

      acctLabel = h('span', { class: 't' });
      const setAcct = () => {
        const a = accountById(st.accountId);
        acctLabel.textContent = a ? (a.name ? `${a.name} <${a.email}>` : a.email) : '';
      };
      setAcct();
      const acctRow =
        S.accounts.length > 1
          ? field(
              '发件人',
              h(
                'button',
                {
                  class: 'acct',
                  type: 'button',
                  onClick: () =>
                    actionSheet(
                      '选择发件账户',
                      S.accounts.map((a) => ({ label: a.email, icon: a.id === st.accountId ? 'check' : null, run: () => { st.accountId = a.id; mark(); setAcct(); } }))
                    )
                },
                acctLabel,
                ic('down', 16)
              )
            )
          : null;

      textarea = h('textarea', { placeholder: '写点什么…', spellcheck: 'true' });
      textarea.value = st.body;
      textarea.addEventListener('input', () => { st.body = textarea.value; mark(); });

      sendBtn = h('button', { class: 'send', type: 'button', onClick: send }, ic('up', 20));
      attachRow = h('div', { class: 'chips attach', hidden: true });
      schedRow = h('div', { class: 'chips attach', hidden: true });

      const quotePill = st.quote
        ? h(
            'div',
            { class: 'quote' },
            h(
              'button',
              { type: 'button', onClick: (event) => { st.quote = ''; st.quoteHtml = ''; mark(); event.currentTarget.parentElement.remove(); } },
              kind === 'forward' ? '含转发内容' : '含引用原文',
              ic('close', 12)
            )
          )
        : h('div', { class: 'quote' });

      page.append(
        h(
          'header',
          { class: 'topbar' },
          iconBtn('close', '关闭', () => closeTop()),
          h('div', { class: 'title' }, kind === 'new' || kind === 'draft' ? '新邮件' : kind === 'forward' ? '转发' : '回复'),
          S.demo ? h('span', { class: 'demo-tag' }, '演示') : null
        ),
        h('div', { class: 'fields' }, acctRow, field('收件人', toInput, ccLink), ccRows, field('主题', subjectInput)),
        suggest,
        h(
          'div',
          { class: 'composer' },
          textarea,
          attachRow,
          schedRow,
          h(
            'div',
            { class: 'foot' },
            h('button', { class: 'iconbtn small', type: 'button', 'aria-label': '添加附件', onClick: pickFiles }, ic('clip', 20)),
            h('button', { class: 'iconbtn small', type: 'button', 'aria-label': '定时发送', onClick: pickSchedule }, ic('clock', 20)),
            quotePill,
            sendBtn
          )
        )
      );
      drawAttachments();
      drawSchedule();
    },
    {
      rise: true,
      onClose: () => {
        if (!st.done && st.dirty && (st.to.trim() || st.subject.trim() || st.attachments.length || st.body.trim() !== signature)) saveDraft();
      }
    }
  );

  setTimeout(() => {
    if (kind === 'new' && !st.to) toInput.focus();
    else {
      textarea.focus();
      textarea.setSelectionRange(0, 0);
    }
  }, 340);
}
