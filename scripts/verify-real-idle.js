(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const el = (id) => document.getElementById(id);
  const out = [];
  const rec = (key, value) =>
    out.push(`${key}=${typeof value === 'object' ? JSON.stringify(value) : String(value)}`);

  const inboxRow = () => document.querySelector('.folder-row[data-role="inbox"]');
  const badge = () => {
    const row = inboxRow();
    const count = row && row.querySelector('.nav-count');
    return count ? count.textContent.trim() : null;
  };
  const ensureExpanded = () => {
    if (!document.querySelector('.folder-row[data-role="inbox"]')) {
      const toggle = document.querySelector('.account-row');
      if (toggle) toggle.click();
    }
  };

  if (el('update-dialog').open) {
    el('update-later').click();
    await wait(300);
  }

  rec('startAccounts', document.querySelectorAll('.account-block').length);

  el('settings-btn').click();
  await wait(400);
  el('settings-add-account').click();
  await wait(400);
  rec('dialogOpen', el('account-dialog').open);

  el('account-email').value = 'tester@idle.local';
  el('account-name').value = 'IDLE 测试';
  el('account-provider').value = 'custom';
  el('account-provider').dispatchEvent(new Event('change'));
  await wait(100);
  el('imap-host').value = '127.0.0.1';
  el('imap-port').value = '11430';
  el('imap-secure').checked = false;
  el('smtp-host').value = '127.0.0.1';
  el('smtp-port').value = '12550';
  el('smtp-secure').checked = false;
  el('account-password').value = 'test-pass';
  el('account-password').dispatchEvent(new Event('input'));
  await wait(150);
  el('account-form').requestSubmit();

  const saveStart = Date.now();
  let saved = false;
  for (let i = 0; i < 160; i += 1) {
    if (!el('account-dialog').open) {
      saved = true;
      break;
    }
    await wait(250);
  }
  rec('saved', saved);
  rec('saveMs', Date.now() - saveStart);
  rec('saveError', el('account-error').hidden ? '' : el('account-error').textContent);
  if (!saved) return out.join('\n');

  await wait(400);
  ensureExpanded();
  await wait(400);
  rec('badgeAfterSave', badge());
  rec('accountErrorVisible', Boolean(document.querySelector('.account-warning')));

  /* no manual refresh from here on: the only refresh source is the push */
  const history = [];
  let pushAt = null;
  const watchStart = Date.now();
  for (let i = 0; i < 140; i += 1) {
    const current = badge();
    if (history[history.length - 1] !== current) history.push(current);
    if (current === '3') {
      pushAt = Date.now() - watchStart;
      break;
    }
    await wait(200);
  }
  rec('badgeHistory', history);
  rec('pushLatencyMs', pushAt);
  rec('finalBadge', badge());
  rec('listRows', document.querySelectorAll('.msg-row').length);
  rec('listBanner', el('list-banner').hidden ? '' : el('list-banner-text').textContent);
  rec('subject', (document.querySelector('.msg-subject') || {}).textContent || '');
  return out.join('\n');
})()
