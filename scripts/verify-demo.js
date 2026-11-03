(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const d = window.__dymailDemo;
  const s = () => d.state.settings;
  const calls = () => window.dymailDemoCalls;
  const out = [];
  const rec = (key, value) => out.push(`${key}=${typeof value === 'object' ? JSON.stringify(value) : String(value)}`);

  rec('appVersion', d.state.appVersion);
  rec('bootNotifications', calls().notifications.length);

  /* remote images switch */
  d.openSettings();
  await wait(250);
  document.querySelector('.settings-tab[data-tab="general"]').click();
  await wait(150);
  const blockEl = document.getElementById('block-remote-input');
  blockEl.checked = true;
  blockEl.dispatchEvent(new Event('change', { bubbles: true }));
  document.getElementById('general-save').click();
  await wait(600);
  rec('remoteAfterBlockSave', s().remoteImages);

  rec('selectFigma', d.selectSubject('Figma'));
  await wait(1500);
  rec('bannerWhileBlocked', {
    hidden: document.getElementById('remote-banner').hidden,
    hasRemote: d.state.readerHasRemote,
    allow: d.state.readerAllowRemote
  });
  document.getElementById('show-images').click();
  await wait(1200);
  rec('bannerAfterShowImages', {
    hidden: document.getElementById('remote-banner').hidden,
    allow: d.state.readerAllowRemote
  });

  document.querySelector('.settings-tab[data-tab="general"]').click();
  await wait(150);
  const blockEl2 = document.getElementById('block-remote-input');
  blockEl2.checked = false;
  blockEl2.dispatchEvent(new Event('change', { bubbles: true }));
  document.getElementById('general-save').click();
  await wait(600);
  rec('remoteRestored', s().remoteImages);

  /* update panel */
  document.querySelector('.settings-tab[data-tab="update"]').click();
  await wait(250);
  rec('updateVersionRow', document.getElementById('update-version').textContent);
  const repoLink = document.getElementById('update-repo-link');
  const repoOpenedBefore = window.dymailDemoCalls.opened.length;
  repoLink.click();
  await wait(200);
  rec('repoLink', {
    hidden: repoLink.hidden,
    text: repoLink.textContent,
    opened: window.dymailDemoCalls.opened.slice(repoOpenedBefore)
  });

  const dlg = document.getElementById('update-dialog');
  document.getElementById('update-check-now').click();
  await wait(1600);
  rec('offerDialog', {
    open: dlg.open,
    from: document.getElementById('update-from').textContent,
    to: document.getElementById('update-to').textContent
  });
  document.getElementById('update-download').click();
  await wait(700);
  rec('afterDownload', { dialogOpen: dlg.open, opened: JSON.stringify(calls().opened) });

  document.getElementById('update-check-now').click();
  await wait(1600);
  document.getElementById('update-ignore').click();
  await wait(600);
  rec('afterIgnore', { skipped: s().updateSkipped, dialogOpen: dlg.open });
  document.getElementById('update-check-now').click();
  await wait(1600);
  rec('recheckWhileSkipped', { dialogOpen: dlg.open, note: document.getElementById('update-note').textContent });
  document.getElementById('update-reset-skip').click();
  await wait(500);
  rec('afterResetSkip', { skipped: s().updateSkipped, resetHidden: document.getElementById('update-reset-skip').hidden });

  /* add account shows up without a restart */
  const before = d.state.accounts.length;
  d.openAccount();
  await wait(300);
  document.getElementById('account-email').value = 'fresh.box@gmail.com';
  document.getElementById('account-name').value = '新账户';
  document.getElementById('account-password').value = 'demo-password';
  document.getElementById('account-email').dispatchEvent(new Event('blur'));
  await wait(150);
  rec('providerFields', {
    provider: document.getElementById('account-provider').value,
    imapHost: document.getElementById('imap-host').value,
    smtpHost: document.getElementById('smtp-host').value
  });
  document.getElementById('account-form').requestSubmit();
  await wait(5000);
  rec('accountAddedLive', `${before}->${d.state.accounts.length} ${d.state.accounts.map((item) => item.email).join(',')}`);
  rec('accountDialogOpen', document.getElementById('account-dialog').open);
  rec('accountErrorText', document.getElementById('account-error').textContent);
  rec('sidebarShowsNewAccount', document.body.textContent.includes('新账户'));

  /* new mail notification */
  await d.simulateNewMail(2);
  await wait(1000);
  rec('notifications', JSON.stringify(calls().notifications));

  /* leave the fixed-width digest email rendered in a narrow frame for the screenshot */
  document.querySelector('[data-close="settings"]').click();
  await wait(200);
  rec('selectDigest', d.selectSubject('Northwind 每周精选'));
  await wait(1600);
  document.getElementById('mail-frame').style.width = '300px';
  await wait(300);

  return out.join('\n');
})()
