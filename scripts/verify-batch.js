(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const d = window.__dymailDemo;
  const PHASE = window.__dymailPhase || 'batch';
  const el = (id) => document.getElementById(id);
  const out = [];
  const rec = (key, value) =>
    out.push(`${key}=${typeof value === 'object' ? JSON.stringify(value) : String(value)}`);
  const rows = () => [...document.querySelectorAll('.msg-row[data-key]')];
  const checks = () => [...document.querySelectorAll('.msg-check')];
  const click = (node, shift) =>
    node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: !!shift }));
  const setValue = (id, value, event) => {
    el(id).value = value;
    if (event) el(id).dispatchEvent(new Event(event, { bubbles: true }));
  };
  const rowFlags = () => rows().map((row) => row.classList.contains('is-checked'));
  const keyOf = (message) => `${message.accountId}|${message.path}|${message.uid}`;
  const checkedNow = () => d.state.messages.filter((message) => d.state.checked.has(keyOf(message)));
  const seenOfChecked = () => checkedNow().filter((message) => message.seen).length;
  const flaggedOfChecked = () => checkedNow().filter((message) => message.flagged).length;
  const visibleState = () => ({
    barHidden: el('batch-bar').hidden,
    count: el('batch-count').textContent,
    listOn: el('message-list').classList.contains('batch-on'),
    checked: d.state.checked.size
  });
  const dismissUpdate = async () => {
    if (!el('update-dialog').open) return;
    el('update-later').click();
    await wait(250);
  };

  await dismissUpdate();

  /* ---------- starred view ---------- */
  await d.setTheme('dark');
  await wait(250);
  click(document.querySelector('[data-nav="starred"]'));
  await wait(900);
  rec('starredTitle', el('view-title').textContent);
  rec('starredRows', rows().length);
  rec('starredAllFlagged', d.state.messages.every((message) => message.flagged));
  rec('starredSidebarActive', document.querySelector('[data-nav="starred"]').classList.contains('is-active'));

  /* ---------- archived view ---------- */
  click(document.querySelector('[data-nav="archived"]'));
  await wait(900);
  rec('archivedTitle', el('view-title').textContent);
  rec('archivedRows', rows().length);
  rec('archivedFolders', [...new Set(d.state.messages.map((message) => message.path))]);
  rec('archivedSidebarActive', document.querySelector('[data-nav="archived"]').classList.contains('is-active'));
  rec(
    'archivedSorted',
    d.state.messages.every((message, i, all) => i === 0 || all[i - 1].timestamp >= message.timestamp)
  );
  click(checks()[0]);
  await wait(150);
  rec('archivedBatch', { archiveHidden: el('batch-archive').hidden, ...visibleState() });
  el('batch-clear').click();
  await wait(150);

  /* ---------- multi-select ---------- */
  click(document.querySelector('[data-nav="unified"]'));
  await wait(900);
  click(checks()[0]);
  await wait(120);
  rec('oneCheck', visibleState());
  click(checks()[4], true);
  await wait(150);
  rec('shiftRange', { ...visibleState(), marks: rowFlags().slice(0, 6) });

  /* ---------- batch star / unstar ---------- */
  rec('checkedBeforeStar', { size: d.state.checked.size, flagged: flaggedOfChecked() });
  el('batch-star').click();
  await wait(350);
  rec('afterBatchStar', {
    toast: el('toast').textContent,
    flagged: flaggedOfChecked(),
    barHidden: el('batch-bar').hidden
  });
  el('batch-unstar').click();
  await wait(350);
  rec('afterBatchUnstar', {
    toast: el('toast').textContent,
    flagged: flaggedOfChecked(),
    totalFlagged: d.state.messages.filter((message) => message.flagged).length
  });

  /* ---------- batch read / unread ---------- */
  rec('checkedBeforeRead', { size: d.state.checked.size, seen: seenOfChecked() });
  el('batch-read').click();
  await wait(350);
  rec('afterBatchRead', { toast: el('toast').textContent, seen: seenOfChecked() });
  el('batch-unread').click();
  await wait(350);
  rec('afterBatchUnread', { toast: el('toast').textContent, seen: seenOfChecked() });

  /* ---------- batch trash ---------- */
  click(checks()[0]);
  await wait(120);
  click(checks()[2], true);
  await wait(150);
  const beforeTrash = d.state.messages.length;
  const movesBefore = window.dymailDemoCalls.moves.length;
  const trashStart = performance.now();
  el('batch-trash').click();
  for (let i = 0; i < 30 && d.state.checked.size; i += 1) await wait(100);
  await wait(150);
  rec('afterBatchTrash', {
    toast: el('toast').textContent,
    removed: beforeTrash - d.state.messages.length,
    checkedLeft: d.state.checked.size,
    barHidden: el('batch-bar').hidden,
    /* one command per account + folder, never one per message */
    calls: window.dymailDemoCalls.moves.length - movesBefore,
    moved: window.dymailDemoCalls.moves.slice(movesBefore),
    elapsedMs: Math.round(performance.now() - trashStart)
  });

  /* ---------- gutter geometry & select all ---------- */
  const rowBox = rows()[0].getBoundingClientRect();
  const checkBox = rows()[0].querySelector('.msg-check').getBoundingClientRect();
  const avatarBox = rows()[0].querySelector('.msg-avatar').getBoundingClientRect();
  const dotBox = rows()[0].querySelector('.unread-mark').getBoundingClientRect();
  rec('gutter', {
    checkLeft: +(checkBox.left - rowBox.left).toFixed(1),
    checkCenter: +(checkBox.top + checkBox.height / 2 - rowBox.top).toFixed(1),
    avatarCenter: +(avatarBox.top + avatarBox.height / 2 - rowBox.top).toFixed(1),
    dotCenter: +(dotBox.top + dotBox.height / 2 - rowBox.top).toFixed(1),
    gapToAvatar: +(avatarBox.left - checkBox.right).toFixed(1)
  });
  el('select-all').click();
  await wait(250);
  rec('selectAll', {
    ...visibleState(),
    rows: rows().length,
    allMarks: rowFlags().every((mark) => mark === true),
    title: el('select-all').title,
    on: el('select-all').classList.contains('is-on')
  });
  el('select-all').click();
  await wait(250);
  rec('selectNone', { ...visibleState(), title: el('select-all').title, on: el('select-all').classList.contains('is-on') });
  el('batch-clear').click();
  await wait(150);

  /* ---------- body translation ---------- */
  const cjk = (value) => (value.match(/[぀-ヿ㐀-鿿豈-﫿]/g) || []).length;
  const frameSrc = () => el('mail-frame').getAttribute('src') || '';
  rec('translateFound', d.selectSubject('Your payout summary'));
  await wait(1600);
  rec('translateBefore', {
    subject: el('reader-subject').textContent,
    hidden: el('action-translate').hidden,
    disabled: el('action-translate').disabled,
    title: el('action-translate').title,
    on: el('action-translate').classList.contains('is-on'),
    originalCjk: cjk(d.state.readerDocument)
  });
  const beforeSrc = frameSrc();
  el('action-translate').click();
  await wait(250);
  rec('translateBusy', { disabled: el('action-translate').disabled, title: el('action-translate').title });
  for (let i = 0; i < 40 && d.state.readerTranslating; i += 1) await wait(400);
  await wait(600);
  const translatedDoc = (d.state.readerTranslation || {}).document || '';
  rec('translateAfter', {
    translated: d.state.readerTranslated,
    toast: el('toast').textContent,
    title: el('action-translate').title,
    on: el('action-translate').classList.contains('is-on'),
    cjkGained: cjk(translatedDoc) > cjk(d.state.readerDocument),
    frameChanged: frameSrc() !== beforeSrc,
    originalKept: d.state.readerDocument.length > 0
  });
  const translatedSrc = frameSrc();
  el('action-translate').click();
  await wait(700);
  rec('translateRevert', {
    translated: d.state.readerTranslated,
    title: el('action-translate').title,
    on: el('action-translate').classList.contains('is-on'),
    frameRestored: frameSrc() !== translatedSrc
  });
  /* a second pass reuses the cached translation instead of hitting the service */
  el('action-translate').click();
  await wait(700);
  rec('translateCached', {
    translated: d.state.readerTranslated,
    busy: d.state.readerTranslating,
    sameDoc: frameSrc() !== '' && d.state.readerTranslation.document === translatedDoc
  });
  /* Chinese mail is refused — the batch phases above already trashed the newest rows */
  const zh = d.state.messages.find((message) => /[一-鿿]/.test(String(message.subject || '')));
  rec('chinesePick', zh ? zh.subject : '');
  if (zh) d.selectSubject(zh.subject);
  await wait(1500);
  el('action-translate').click();
  await wait(500);
  rec('translateChinese', {
    toast: el('toast').textContent,
    translated: d.state.readerTranslated,
    on: el('action-translate').classList.contains('is-on')
  });

  /* ---------- deepl key field ---------- */
  d.openSettings('general');
  await wait(300);
  rec('deeplEmpty', { value: el('deepl-key-input').value, hint: el('deepl-key-state').textContent });
  setValue('deepl-key-input', 'demo-key:fx', 'input');
  await wait(120);
  rec('deeplTyped', { hint: el('deepl-key-state').textContent });
  el('general-save').click();
  await wait(500);
  rec('deeplSaved', {
    calls: window.dymailDemoCalls.deeplKeys,
    value: el('deepl-key-input').value,
    hint: el('deepl-key-state').textContent,
    stored: d.state.settings.hasDeeplKey
  });
  setValue('deepl-key-input', '', 'input');
  el('general-save').click();
  await wait(500);
  rec('deeplCleared', {
    calls: window.dymailDemoCalls.deeplKeys,
    hint: el('deepl-key-state').textContent,
    stored: d.state.settings.hasDeeplKey
  });
  click(document.querySelector('[data-close="settings"]'));
  await wait(250);

  /* ---------- contacts ---------- */
  click(document.querySelector('[data-nav="contacts"]'));
  await wait(350);
  rec('contactsOpened', {
    open: el('contacts-dialog').open,
    rows: document.querySelectorAll('#contacts-list [data-contact]').length,
    active: document.querySelectorAll('#contacts-list .contact-row.is-active').length
  });
  el('contact-new').click();
  await wait(120);
  setValue('contact-name', '赵明');
  setValue('contact-email', 'zhaoming@northwind.cn');
  el('contact-form').requestSubmit();
  await wait(500);
  rec('contactAdded', {
    rows: document.querySelectorAll('#contacts-list [data-contact]').length,
    stored: window.dymailDemoCalls.contacts.map((item) => item.email),
    errorHidden: el('contact-error').hidden
  });
  /* duplicate address is rejected inline */
  el('contact-new').click();
  await wait(120);
  setValue('contact-name', '赵明重复');
  setValue('contact-email', 'zhaoming@northwind.cn');
  el('contact-form').requestSubmit();
  await wait(400);
  rec('contactDuplicate', {
    error: el('contact-error').textContent,
    hidden: el('contact-error').hidden,
    rows: document.querySelectorAll('#contacts-list [data-contact]').length
  });
  click(document.querySelector('#contacts-list [data-contact="zhaoming@northwind.cn"]'));
  await wait(150);
  rec('contactSelected', {
    name: el('contact-name').value,
    email: el('contact-email').value,
    deleteHidden: el('contact-delete').hidden
  });
  el('contact-delete').click();
  await wait(600);
  rec('contactDeleted', {
    rows: document.querySelectorAll('#contacts-list [data-contact]').length,
    stored: window.dymailDemoCalls.contacts.length
  });

  /* ---------- compose contact picker ---------- */
  el('contacts-dialog').close();
  await wait(200);
  d.openCompose();
  await wait(500);
  rec('selectInk', {
    bg: getComputedStyle(el('compose-account')).backgroundColor,
    color: getComputedStyle(el('compose-account')).color
  });
  click(document.querySelector('[data-pick="to"]'));
  await wait(250);
  rec('pickerOpened', {
    hidden: el('contact-pop').hidden,
    top: el('contact-pop').style.top,
    left: el('contact-pop').style.left,
    items: document.querySelectorAll('#contact-pop-list [data-pick-contact]').length
  });
  setValue('contact-search', '王', 'input');
  await wait(200);
  rec('pickerFiltered', {
    items: document.querySelectorAll('#contact-pop-list [data-pick-contact]').length,
    first: (document.querySelector('#contact-pop-list [data-pick-contact]') || {}).dataset
  });
  click(document.querySelector('#contact-pop-list [data-pick-contact]'));
  await wait(200);
  rec('afterPick', { to: el('compose-to').value, hidden: el('contact-pop').hidden });
  setValue('compose-to', `${el('compose-to').value}, zhaoming@northwind.cn`);
  click(document.querySelector('[data-pick="cc"]'));
  await wait(200);
  setValue('contact-search', '陈', 'input');
  await wait(180);
  click(document.querySelector('#contact-pop-list [data-pick-contact]'));
  await wait(200);
  rec('afterCcPick', { cc: el('compose-cc').value, hidden: el('contact-pop').hidden });
  /* picking the same address twice does not duplicate it */
  click(document.querySelector('[data-pick="to"]'));
  await wait(200);
  click(document.querySelector('#contact-pop-list [data-pick-contact="wangting@northwind.cn"]'));
  await wait(200);
  rec('noDuplicate', { to: el('compose-to').value });

  /* ---------- resting state for the screenshot ---------- */
  await dismissUpdate();
  if (PHASE === 'contacts') {
    click(document.querySelector('[data-close="contacts"]'));
    click(document.querySelector('[data-nav="contacts"]'));
    await wait(400);
  } else if (PHASE === 'archived') {
    el('compose-close').click();
    await wait(300);
    click(document.querySelector('[data-nav="archived"]'));
    await wait(900);
    for (let i = 0; i < Math.min(3, rows().length); i += 1) {
      click(checks()[i]);
      await wait(90);
    }
    rec('finalArchived', visibleState());
  } else if (PHASE === 'perf') {
    el('compose-close').click();
    await wait(300);
    click(document.querySelector('[data-nav="unified"]'));
    await wait(900);
    el('select-all').click();
    await wait(250);
    const total = d.state.checked.size;
    let sidebarMutations = 0;
    const observer = new MutationObserver((records) => {
      sidebarMutations += records.length;
    });
    observer.observe(el('sidebar-nav'), { childList: true, subtree: true, characterData: true });
    const movesBefore = window.dymailDemoCalls.moves.length;
    const start = performance.now();
    el('batch-trash').click();
    for (let i = 0; i < 60 && d.state.checked.size; i += 1) await wait(100);
    await wait(250);
    observer.disconnect();
    rec('perfTrash', {
      total,
      calls: window.dymailDemoCalls.moves.length - movesBefore,
      moved: window.dymailDemoCalls.moves.slice(movesBefore),
      elapsedMs: Math.round(performance.now() - start),
      sidebarMutations,
      rowsLeft: rows().length,
      checkedLeft: d.state.checked.size
    });
  } else if (PHASE === 'translate') {
    el('compose-close').click();
    await wait(300);
    click(document.querySelector('[data-nav="unified"]'));
    await wait(900);
    d.selectSubject('Your payout summary');
    await wait(1600);
    el('action-translate').click();
    for (let i = 0; i < 40 && d.state.readerTranslating; i += 1) await wait(400);
    await wait(700);
    rec('finalTranslate', {
      translated: d.state.readerTranslated,
      title: el('action-translate').title,
      on: el('action-translate').classList.contains('is-on')
    });
  } else if (PHASE === 'starred') {
    el('compose-close').click();
    await wait(300);
    click(document.querySelector('[data-nav="starred"]'));
    await wait(900);
  } else if (PHASE === 'picker') {
    el('compose-to').value = '王婷 <wangting@northwind.cn>';
    click(document.querySelector('[data-pick="to"]'));
    await wait(300);
  } else {
    el('compose-close').click();
    await wait(300);
    click(document.querySelector('[data-nav="unified"]'));
    await wait(900);
    const list = d.state.messages;
    for (let i = 0; i < 3; i += 1) {
      click(checks()[i]);
      await wait(90);
    }
    const unread = list.filter((message) => !message.seen).length;
    rec('finalBatch', { ...visibleState(), unreadRows: unread });
  }

  return out.join('\n');
})()
