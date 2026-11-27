import { h, ic, iconBtn, openPage, closeTop, actionSheet, confirmSheet, toast, fmtTime } from './ui.js';
import { S, UI, saveUi, hooks } from './state.js';
import { PROVIDERS, providerById, providerForEmail } from './providers.js';
import { checkForUpdate } from './update.js';
import { openRules } from './rules.js';
import { backgroundSection } from './background-ui.js';
import { openContacts } from './contacts.js';

const media = window.matchMedia('(prefers-color-scheme: dark)');

export function applyTheme() {
  const pref = S.settings.theme || 'system';
  const dark = pref === 'dark' || (pref === 'system' && media.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? '#212121' : '#ffffff';
}
media.addEventListener('change', applyTheme);

async function patch(change) {
  try {
    S.settings = { ...S.settings, ...(await S.api.settings.update(change)) };
    return true;
  } catch (err) {
    toast(err && err.message ? err.message : '保存失败');
    return false;
  }
}

function segmented(options, current, onPick) {
  const wrap = h('div', { class: 'seg' });
  const draw = (value) => {
    wrap.replaceChildren(
      ...options.map(([val, label]) =>
        h('button', { type: 'button', class: val === value ? 'on' : '', onClick: () => { draw(val); onPick(val); } }, label)
      )
    );
  };
  draw(current);
  return wrap;
}

function selectCell(label, options, current, onPick) {
  const select = h('select', null, options.map(([val, text]) => h('option', { value: String(val), selected: String(val) === String(current) }, text)));
  select.addEventListener('change', () => onPick(select.value));
  return h('label', { class: 'cell' }, h('span', { class: 'grow' }, label), select);
}

function switchCell(label, on, onChange) {
  let value = Boolean(on);
  const sw = h('button', { class: `switch${value ? ' on' : ''}`, type: 'button', role: 'switch', 'aria-checked': String(value), 'aria-label': label });
  const flip = () => {
    value = !value;
    sw.classList.toggle('on', value);
    sw.setAttribute('aria-checked', String(value));
    onChange(value);
  };
  sw.addEventListener('click', (event) => { event.stopPropagation(); flip(); });
  return h('div', { class: 'cell press', role: 'button', tabindex: '0', onClick: flip }, h('span', { class: 'grow' }, label), sw);
}

function linkCell(iconName, label, onClick, sub) {
  return h('button', { class: 'cell press', type: 'button', onClick }, ic(iconName, 20), h('span', { class: 'grow' }, label), sub ? h('span', { class: 'sub' }, sub) : null, ic('right', 18));
}

export function openSettings() {
  openPage((page) => {
    const accountsCard = h('div', { class: 'card' });
    const drawAccounts = () => {
      accountsCard.replaceChildren(
        ...S.accounts.map((a) =>
          h(
            'button',
            {
              class: 'cell press',
              type: 'button',
              onClick: () =>
                actionSheet(a.email, [
                  {
                    label: '移除此账户',
                    icon: 'trash',
                    danger: true,
                    run: async () => {
                      const yes = await confirmSheet({ title: `移除 ${a.email}？`, message: '只会从本应用中移除，不会删除服务器上的邮件。', ok: '移除', danger: true });
                      if (!yes) return;
                      try {
                        await S.api.accounts.remove(a.id);
                        await hooks.refreshAccounts();
                        if (S.view.accountId === a.id) S.view = { kind: 'unified', title: '收件箱' };
                        hooks.reload();
                        drawAccounts();
                        toast('已移除');
                      } catch (err) {
                        toast(err && err.message ? err.message : '移除失败');
                      }
                    }
                  }
                ])
            },
            h('i', { style: `width:10px;height:10px;border-radius:50%;background:${a.color || '#888'};flex:none` }),
            h('span', { class: 'grow' }, a.email),
            ic('right', 18)
          )
        ),
        h('button', { class: 'cell press', type: 'button', onClick: () => openAddAccount(drawAccounts) }, ic('plus', 20), h('span', { class: 'grow' }, '添加账户'))
      );
    };
    drawAccounts();

    const signature = h('textarea', { placeholder: '例如：姓名 · 职位', rows: 3 });
    signature.value = S.settings.signature || '';
    signature.addEventListener('change', () => patch({ signature: signature.value }));

    const remote = segmented([['allow', '自动加载'], ['block', '手动加载']], S.settings.remoteImages === 'block' ? 'block' : 'allow', (v) => patch({ remoteImages: v }));

    /* ---- translation key ---- */
    const keyInput = h('input', { class: 'plain', type: 'password', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
    const keyClear = h('button', { class: 'cell press', type: 'button' }, h('span', { class: 'grow' }, '清除 DeepL 密钥'));
    const drawKey = () => {
      keyInput.placeholder = S.settings.hasDeeplKey ? '已保存（输入新密钥可替换）' : '可选，填写后优先使用 DeepL';
      keyClear.hidden = !S.settings.hasDeeplKey;
    };
    const saveKey = async (value) => {
      try {
        S.settings = { ...S.settings, ...(await S.api.settings.setDeeplKey(value)) };
        keyInput.value = '';
        drawKey();
        toast(value ? '已保存密钥' : '已清除密钥');
      } catch (err) {
        toast(err && err.message ? err.message : '保存失败');
      }
    };
    keyInput.addEventListener('change', () => { if (keyInput.value.trim()) saveKey(keyInput.value.trim()); });
    keyClear.addEventListener('click', () => saveKey(''));
    drawKey();

    /* ---- updates ---- */
    const updateStatus = h('span', { class: 'sub' });
    const checkBtn = h('button', { class: 'cell press', type: 'button' }, ic('refresh', 20), h('span', { class: 'grow' }, '检查更新'), updateStatus);
    const skipped = h('div', { class: 'cell press', role: 'button', tabindex: '0' });
    const drawSkipped = () => {
      const v = S.settings.updateSkipped || '';
      skipped.hidden = !v;
      skipped.replaceChildren(h('span', { class: 'grow' }, `已跳过版本 ${v}`), h('span', { class: 'sub' }, '恢复提醒'));
    };
    skipped.addEventListener('click', async () => {
      if (await patch({ updateSkipped: '' })) {
        drawSkipped();
        toast('已恢复该版本的更新提醒');
      }
    });
    drawSkipped();

    const lastCheck = () => (Number(S.settings.updateLastCheck) ? `上次检查 ${fmtTime(S.settings.updateLastCheck)}` : '尚未检查');
    updateStatus.textContent = lastCheck();
    checkBtn.addEventListener('click', async () => {
      if (checkBtn.disabled) return;
      checkBtn.disabled = true;
      updateStatus.classList.remove('err');
      updateStatus.textContent = '检查中…';
      try {
        const result = await checkForUpdate({ silent: false });
        drawSkipped();
        updateStatus.textContent = result.hasUpdate ? `最新版本 ${result.latest}` : result.note || `已是最新版本 ${result.current}`;
      } catch (err) {
        updateStatus.classList.add('err');
        updateStatus.textContent = err && err.message ? err.message : '检查更新失败';
      }
      checkBtn.disabled = false;
    });

    const repo = h('input', { class: 'plain', type: 'text', placeholder: 'owner/repo', autocapitalize: 'off', spellcheck: 'false' });
    repo.value = S.settings.updateRepo || '';
    repo.addEventListener('change', async () => {
      const previous = S.settings.updateRepo || '';
      if (!(await patch({ updateRepo: repo.value.trim() }))) repo.value = previous;
    });

    page.append(
      h('header', { class: 'topbar' }, iconBtn('back', '返回', () => closeTop()), h('div', { class: 'title' }, '设置')),
      h(
        'div',
        { class: 'scroll' },
        h(
          'div',
          { class: 'page' },
          h('div', { class: 'section' }, '外观'),
          h('div', { class: 'card' }, h('div', { class: 'cell col' }, segmented([['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']], S.settings.theme || 'system', async (v) => { await patch({ theme: v }); applyTheme(); }))),
          h('div', { class: 'section' }, '账户'),
          accountsCard,
          h('div', { class: 'section' }, '邮件'),
          h(
            'div',
            { class: 'card' },
            switchCell('会话视图（按主题合并）', UI.threads, (on) => { UI.threads = on; saveUi(); hooks.render(); }),
            h('div', { class: 'cell col' }, h('span', { class: 'sub' }, '远程图片'), remote),
            h('div', { class: 'cell col' }, h('span', { class: 'sub' }, '签名'), signature),
            selectCell('自动同步', [[0, '仅手动'], [60, '每分钟'], [300, '每 5 分钟'], [900, '每 15 分钟']], S.settings.refreshSeconds ?? 60, (v) => patch({ refreshSeconds: Number(v) })),
            selectCell('已删除邮件保留', [[0, '不自动清理'], [15, '15 天'], [30, '30 天'], [60, '60 天'], [90, '90 天']], S.settings.trashPurgeDays ?? 30, (v) => patch({ trashPurgeDays: Number(v) }))
          ),
          backgroundSection(),
          h('div', { class: 'section' }, '工具'),
          h('div', { class: 'card' }, linkCell('filter', '过滤规则与黑名单', openRules), linkCell('book', '联系人', openContacts)),
          h('div', { class: 'section' }, '翻译'),
          h('div', { class: 'card' }, h('label', { class: 'cell' }, h('span', null, 'DeepL 密钥'), keyInput), keyClear),
          h('div', { class: 'note', style: 'margin-top:8px' }, '不填写时使用免费的 MyMemory 翻译，长文效果一般。'),
          h('div', { class: 'section' }, '更新'),
          h(
            'div',
            { class: 'card' },
            h('div', { class: 'cell' }, h('span', { class: 'grow' }, '当前版本'), h('span', { class: 'sub' }, S.demo ? '预览版 · 演示数据' : (S.info && S.info.version) || '')),
            switchCell('自动检查更新', S.settings.updateCheck !== false, (on) => patch({ updateCheck: on })),
            h('label', { class: 'cell' }, h('span', null, '更新源'), repo),
            checkBtn,
            skipped
          ),
          h('div', { class: 'note', style: 'margin-top:8px' }, '发现新版本后会提示下载，安装包在系统浏览器里下载，由 Android 确认安装。')
        )
      )
    );
  });
}

function guessSecure(port, kind) {
  const n = Number(port);
  return kind === 'imap' ? n !== 143 : n === 465;
}

/* Which OAuth logins this build can actually offer (client IDs are baked in at build time).
   Cached: the answer cannot change while the app runs. Demo mode always "has" them. */
let oauthCache = null;
function oauthAvailability() {
  if (S.demo) return Promise.resolve({ google: true, microsoft: true });
  if (!oauthCache) {
    oauthCache = S.api.accounts.oauthProviders().catch(() => ({ google: false, microsoft: false }));
  }
  return oauthCache;
}

export function openAddAccount(onDone) {
  const st = { provider: providerById('gmail'), oauth: null, oauthOk: null, busy: false };
  let errorEl;
  let body;

  const input = (props) => h('input', { class: 'input', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', ...props });

  openPage((page) => {
    const email = input({ type: 'email', inputmode: 'email', placeholder: 'name@example.com' });
    const name = input({ type: 'text', placeholder: '可选' });
    const secret = input({ type: 'password', placeholder: '' });
    const imapHost = input({ type: 'text', placeholder: 'imap.example.com' });
    const imapPort = input({ type: 'number', inputmode: 'numeric', placeholder: '993' });
    const smtpHost = input({ type: 'text', placeholder: 'smtp.example.com' });
    const smtpPort = input({ type: 'number', inputmode: 'numeric', placeholder: '465' });
    const oauthBtn = h('button', { class: 'btn block', type: 'button' });
    const oauthState = h('div', { class: 'note' });
    const hint = h('div', { class: 'note' });
    const helpLink = h('button', { class: 'linkrow', type: 'button' });
    const chips = h('div', { class: 'chiprow' });
    const passRow = h('div', { class: 'formrow' }, h('label', null, '密码'), secret);
    const customRows = h('div', null, h('div', { class: 'formrow' }, h('label', null, 'IMAP 服务器'), h('div', { class: 'cols' }, imapHost, imapPort)), h('div', { class: 'formrow' }, h('label', null, 'SMTP 服务器'), h('div', { class: 'cols' }, smtpHost, smtpPort)));
    const submit = h('button', { class: 'btn primary', type: 'button', style: 'width:100%;flex:none' }, '添加账户');
    errorEl = h('div', { class: 'error' });

    const showError = (text) => { errorEl.textContent = text || ''; };

    const drawProvider = () => {
      const p = st.provider;
      chips.replaceChildren(
        ...PROVIDERS.map((item) =>
          h('button', { class: `pillchip${item.id === p.id ? ' on' : ''}`, type: 'button', onClick: () => { st.provider = item; st.oauth = null; drawProvider(); } }, item.label)
        )
      );
      const isCustom = p.id === 'custom';
      customRows.hidden = !isCustom;
      if (isCustom) {
        if (!imapPort.value) imapPort.value = '993';
        if (!smtpPort.value) smtpPort.value = '465';
      }
      /* Three states per OAuth provider: enabled (real button), blocked (this build has no client
         ID — explain instead of offering a dead button), or not an OAuth provider at all. */
      const oauthEnabled = Boolean(p.oauth) && Boolean(st.oauthOk && st.oauthOk[p.oauth]);
      const oauthBlocked = Boolean(p.oauth) && Boolean(st.oauthOk) && !st.oauthOk[p.oauth];
      const oauthLabel = p.oauth === 'google' ? 'Google' : p.oauth === 'microsoft' ? 'Microsoft' : '';
      oauthBtn.hidden = !oauthEnabled;
      oauthBtn.textContent = st.oauth ? `已授权 ${st.oauth.email}（重新授权）` : `使用 ${oauthLabel} 账号登录`;
      oauthState.hidden = !oauthEnabled || Boolean(st.oauth);
      oauthState.textContent = '将打开系统浏览器完成授权，完成后回到本应用';
      hint.textContent = (oauthBlocked ? p.noOauthHint : p.hint) || '';
      helpLink.hidden = !p.helpUrl || Boolean(st.oauth) || oauthBlocked;
      helpLink.textContent = `${p.helpLabel || `获取${p.passwordLabel || '密码'}`} ↗`;
      passRow.hidden = Boolean(st.oauth) || oauthBlocked;
      passRow.querySelector('label').textContent = p.passwordLabel || '密码';
      /* Outlook without OAuth cannot work at all (Microsoft killed password login) — don't pretend. */
      submit.disabled = st.busy || oauthBlocked;
    };

    helpLink.addEventListener('click', () => {
      const url = st.provider.helpUrl;
      if (!url) return;
      S.api.app.open(url).catch((err) => toast(err && err.message ? err.message : '无法打开链接'));
    });

    email.addEventListener('input', () => {
      const guess = providerForEmail(email.value);
      if (guess && guess !== st.provider.id) {
        st.provider = providerById(guess);
        st.oauth = null;
        drawProvider();
      }
    });

    oauthBtn.addEventListener('click', async () => {
      showError('');
      oauthBtn.disabled = true;
      try {
        const result = await S.api.accounts.oauthStart(st.provider.oauth);
        st.oauth = { ticket: result.ticket, email: result.email };
        email.value = result.email;
        if (!name.value && result.name) name.value = result.name;
      } catch (err) {
        st.oauth = null;
        showError(err && err.message ? err.message : '授权失败');
      }
      oauthBtn.disabled = false;
      drawProvider();
    });

    submit.addEventListener('click', async () => {
      if (st.busy) return;
      showError('');
      const p = st.provider;
      const custom = p.id === 'custom';
      const imap = custom ? { host: imapHost.value.trim(), port: Number(imapPort.value), secure: guessSecure(imapPort.value, 'imap') } : p.imap;
      const smtp = custom ? { host: smtpHost.value.trim(), port: Number(smtpPort.value), secure: guessSecure(smtpPort.value, 'smtp') } : p.smtp;
      const payload = { email: email.value.trim(), name: name.value.trim(), imap, smtp };
      if (st.oauth) {
        payload.authType = 'oauth2';
        payload.oauthTicket = st.oauth.ticket;
      } else {
        /* Auth codes / app passwords never contain spaces; pasted ones often carry a stray
           space or newline. Only true login passwords (aliyun, custom) are kept verbatim. */
        const entered = p.passwordLabel === '密码' ? secret.value : secret.value.replace(/\s+/g, '');
        if (!entered) {
          showError(`请输入${p.passwordLabel || '密码'}`);
          return;
        }
        payload.authType = 'password';
        payload.password = entered;
      }
      st.busy = true;
      submit.disabled = true;
      submit.textContent = '正在验证连接…';
      try {
        await S.api.accounts.save(payload);
        await closeTop();
        toast('账户已添加');
        await hooks.refreshAccounts();
        hooks.reload();
        if (typeof onDone === 'function') onDone();
      } catch (err) {
        showError(err && err.message ? err.message : '添加失败');
        submit.disabled = false;
        submit.textContent = '添加账户';
      }
      st.busy = false;
    });

    body = h(
      'div',
      { class: 'page' },
      chips,
      oauthBtn,
      oauthState,
      hint,
      helpLink,
      h('div', { class: 'formrow' }, h('label', null, '邮箱地址'), email),
      h('div', { class: 'formrow' }, h('label', null, '显示名称'), name),
      passRow,
      customRows,
      errorEl,
      submit
    );
    drawProvider();
    oauthAvailability().then((available) => { st.oauthOk = available; drawProvider(); });

    page.append(h('header', { class: 'topbar' }, iconBtn('back', '返回', () => closeTop()), h('div', { class: 'title' }, '添加账户')), h('div', { class: 'scroll' }, body));
  });
}
