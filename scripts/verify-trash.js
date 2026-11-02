(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const d = window.__dymailDemo;
  const el = (id) => document.getElementById(id);
  const out = [];
  const rec = (key, value) =>
    out.push(`${key}=${typeof value === 'object' ? JSON.stringify(value) : String(value)}`);
  const rows = () => [...document.querySelectorAll('.msg-row[data-key]')];
  const checks = () => [...document.querySelectorAll('.msg-check')];
  const click = (node, shift) =>
    node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: !!shift }));
  const subjects = () => d.state.messages.map((message) => message.subject);
  const setValue = (id, value) => {
    el(id).value = value;
    el(id).dispatchEvent(new Event('change', { bubbles: true }));
  };
  const goFolder = async (accountId, role) => {
    click(document.querySelector(`[data-account="${accountId}"][data-role="${role}"]`));
    await wait(900);
  };
  const dismissUpdate = async () => {
    if (!el('update-dialog').open) return;
    el('update-later').click();
    await wait(250);
  };
  const scrollFit = async (tab) => {
    d.openSettings(tab);
    await wait(300);
    const panel = document.querySelector(`[data-panel="${tab}"]`);
    const scroller = panel.querySelector('.settings-scroll') || panel;
    const res = {
      scrollH: scroller.scrollHeight,
      clientH: scroller.clientHeight,
      fits: scroller.scrollHeight <= scroller.clientHeight
    };
    rec(`settingsFit.${tab}`, res);
    return res;
  };

  await dismissUpdate();

  /* ---------- boot purge ---------- */
  rec('purgeCalls', window.dymailDemoCalls.purges);
  rec('purgeToast', el('toast').textContent);
  rec('purgeSetting', d.state.settings.trashPurgeDays);

  /* a second request inside the same day is refused by the timestamp guard */
  const demo = await import('./demo.js');
  const api2 = demo.createDemoApi();
  rec('purgeSecond', await api2.mail.purgeTrash());

  /* ---------- what survived the sweep ---------- */
  await goFolder('acc-work', 'trash');
  rec('workTrash', subjects());
  await goFolder('acc-gmail', 'trash');
  rec('gmailTrash', subjects());
  await goFolder('acc-qq', 'trash');
  rec('qqTrash', subjects());

  /* ---------- single restore from the reader ---------- */
  await goFolder('acc-work', 'trash');
  click(checks()[0]);
  await wait(200);
  rec('batchBarInTrash', {
    restoreHidden: el('batch-restore').hidden,
    restoreTitle: el('batch-restore').title,
    archiveHidden: el('batch-archive').hidden
  });
  d.selectSubject('上周周报（旧版本）');
  await wait(800);
  rec('readerInTrash', {
    subject: el('reader-subject').textContent,
    restoreHidden: el('action-restore').hidden,
    archiveHidden: el('action-archive').hidden,
    trashTitle: el('action-trash').title
  });
  const restoresBefore = window.dymailDemoCalls.restores.length;
  el('action-restore').click();
  await wait(900);
  rec('afterSingleRestore', {
    toast: el('toast').textContent,
    rowsLeft: rows().length,
    calls: window.dymailDemoCalls.restores.length - restoresBefore,
    last: window.dymailDemoCalls.restores.slice(-1)[0]
  });
  await goFolder('acc-work', 'inbox');
  rec('workInboxHasRestored', subjects().includes('上周周报（旧版本）'));

  /* ---------- batch restore costs one request per folder ---------- */
  await goFolder('acc-gmail', 'trash');
  const gmailBefore = rows().length;
  for (let i = 0; i < gmailBefore; i += 1) {
    click(checks()[i]);
    await wait(110);
  }
  rec('gmailChecked', { count: el('batch-count').textContent, size: d.state.checked.size });
  const callsBefore = window.dymailDemoCalls.restores.length;
  const started = performance.now();
  el('batch-restore').click();
  for (let i = 0; i < 30 && d.state.checked.size; i += 1) await wait(100);
  await wait(250);
  rec('afterBatchRestore', {
    toast: el('toast').textContent,
    busyLabel: el('batch-count').textContent,
    rowsLeft: rows().length,
    calls: window.dymailDemoCalls.restores.length - callsBefore,
    moved: window.dymailDemoCalls.restores.slice(callsBefore),
    elapsedMs: Math.round(performance.now() - started),
    barHidden: el('batch-bar').hidden
  });
  await goFolder('acc-gmail', 'inbox');
  rec(
    'gmailInboxGrew',
    subjects().filter((s) => /Ticket #4402|hotel booking|Wrong draft/.test(s)).length
  );

  /* ---------- 还原 is offered nowhere else ---------- */
  click(document.querySelector('[data-nav="unified"]'));
  await wait(900);
  click(checks()[0]);
  await wait(200);
  rec('batchBarOutsideTrash', { restoreHidden: el('batch-restore').hidden });
  d.selectFirst();
  await wait(800);
  rec('readerOutsideTrash', { restoreHidden: el('action-restore').hidden });
  el('batch-clear').click();
  await wait(200);

  /* ---------- settings ---------- */
  rec('settingsFit.general.before', await scrollFit('general'));
  rec('purgeSelect', {
    value: el('trash-purge-select').value,
    options: [...el('trash-purge-select').options].map((option) => option.value)
  });
  setValue('trash-purge-select', '0');
  el('general-save').click();
  await wait(700);
  rec('purgeOff', { stored: d.state.settings.trashPurgeDays });
  rec('purgeOffSkips', await api2.mail.purgeTrash());
  d.openSettings('general');
  await wait(320);
  rec('purgeOffReloaded', el('trash-purge-select').value);
  setValue('trash-purge-select', '90');
  el('general-save').click();
  await wait(700);
  rec('purge90', { stored: d.state.settings.trashPurgeDays });
  await scrollFit('accounts');
  await scrollFit('appearance');
  await scrollFit('update');
  click(document.querySelector('[data-close="settings"]'));
  await wait(250);

  /* ---------- resting state for the screenshot ---------- */
  await dismissUpdate();
  await goFolder('acc-qq', 'trash');
  if (rows().length) {
    click(checks()[0]);
    await wait(150);
  }
  rec('finalBar', { hidden: el('batch-bar').hidden, count: el('batch-count').textContent });
  return out.join('\n');
})()
