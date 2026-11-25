'use strict';

/* UI verification for the four new features: conversation grouping,
   scheduled send, attachment handling and rules/blacklist. */

(async () => {
  const out = {};
  const el = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const rec = (name, value) => {
    out[name] = value;
  };

  if (el('update-dialog') && el('update-dialog').open) el('update-dialog').close();
  await wait(120);

  rec('threadToggleVisible', Boolean(el('thread-toggle')) && !el('thread-toggle').hidden);

  el('thread-toggle').click();
  await wait(260);
  const threadRows = [...document.querySelectorAll('.msg-row.thread-row')];
  rec('threadRows', threadRows.length);
  rec('checkboxHiddenInThreads', !document.querySelector('.msg-check'));

  const target = threadRows.find((row) => row.textContent.includes('本周产品评审安排'));
  if (target) target.click();
  await wait(780);
  rec('threadReader', {
    visible: el('reader-thread') && !el('reader-thread').hidden,
    chips: document.querySelectorAll('.thread-chip').length,
    subject: el('reader-subject') ? el('reader-subject').textContent : '',
    active: document.querySelectorAll('.thread-chip.is-active').length
  });

  const chips = [...document.querySelectorAll('.thread-chip')];
  if (chips.length > 1) {
    chips[0].click();
    await wait(420);
  }
  rec('threadSwitchActive', document.querySelectorAll('.thread-chip.is-active').length);

  el('thread-toggle').click();
  await wait(220);

  const scheduledNav = document.querySelector('[data-nav="scheduled"]');
  rec('scheduledNav', Boolean(scheduledNav));
  scheduledNav.click();
  await wait(420);
  rec('scheduledRows', document.querySelectorAll('.scheduled-row').length);
  const firstScheduled = document.querySelector('.scheduled-row');
  if (firstScheduled) firstScheduled.click();
  await wait(300);
  rec('scheduledDetail', {
    visible: el('scheduled-detail') && !el('scheduled-detail').hidden,
    subject: document.querySelector('.scheduled-subject')
      ? document.querySelector('.scheduled-subject').textContent
      : '',
    actions: [...document.querySelectorAll('[data-schedule-action]')].map(
      (button) => button.dataset.scheduleAction
    )
  });

  el('compose-btn').click();
  await wait(260);
  el('compose-to').value = 'wangting@northwind.cn';
  el('compose-subject').value = '定时验收';
  el('compose-subject').dispatchEvent(new Event('input', { bubbles: true }));
  el('compose-editor').innerHTML = '<p>这是一封定时发送的验收邮件。</p>';
  el('compose-editor').dispatchEvent(new Event('input', { bubbles: true }));
  el('compose-attach').click();
  await wait(180);
  rec('composeAttachments', {
    summary: document.querySelector('.attachment-summary') ? document.querySelector('.attachment-summary').textContent.trim() : '',
    chips: document.querySelectorAll('#compose-attachments .compose-chip').length
  });

  el('compose-schedule').click();
  await wait(160);
  rec('scheduleDialogOpen', el('schedule-dialog').open);
  const at = new Date(Date.now() + 70 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  el('schedule-at').value = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(
    at.getHours()
  )}:${pad(at.getMinutes())}`;
  el('schedule-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await wait(900);
  rec('afterSchedule', {
    dialogOpen: el('schedule-dialog').open,
    composeHidden: el('compose-layer').hidden,
    toast: el('toast').hidden ? '' : el('toast').textContent
  });

  scheduledNav.click();
  await wait(520);
  rec('scheduledAfterSave', document.querySelectorAll('.scheduled-row').length);

  el('settings-btn').click();
  await wait(160);
  document.querySelector('.settings-tab[data-tab="rules"]').click();
  await wait(420);
  rec('rulesTab', {
    panel: document.querySelector('[data-panel="rules"]') && !document.querySelector('[data-panel="rules"]').hidden,
    ruleEmpty: Boolean(document.querySelector('.rules-empty'))
  });

  el('rule-new').click();
  await wait(80);
  el('rule-name').value = 'GitHub 通知归档';
  el('rule-field').value = 'from';
  el('rule-value').value = 'github.com';
  el('rule-action').value = 'archive';
  el('rule-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await wait(460);
  rec('ruleSaved', {
    rows: document.querySelectorAll('.rule-row').length,
    text: document.querySelector('.rule-row') ? document.querySelector('.rule-row').textContent.trim() : '',
    error: el('rule-error').hidden ? '' : el('rule-error').textContent,
    toast: el('toast').hidden ? '' : el('toast').textContent
  });

  el('blacklist-email').value = 'spam@example.com';
  el('blacklist-add').click();
  await wait(240);
  rec('blacklistRows', document.querySelectorAll('.blacklist-row').length);

  document.querySelector('[data-close="settings"]').click();
  await wait(160);

  el('toast').hidden = true;
  scheduledNav.click();
  await wait(460);
  const rows = [...document.querySelectorAll('.scheduled-row')];
  const newRow = rows.find((row) => row.textContent.includes('定时验收'));
  if (newRow) newRow.click();
  await wait(360);
  el('toast').hidden = true;
  rec('final', {
    scheduledRows: document.querySelectorAll('.scheduled-row').length,
    subject: document.querySelector('.scheduled-subject')
      ? document.querySelector('.scheduled-subject').textContent
      : '',
    attachments: document.querySelector('.scheduled-body')
      ? document.querySelector('.scheduled-body').textContent.includes('预算模板.xlsx')
      : false
  });

  return JSON.stringify(out, null, 1);
})()
