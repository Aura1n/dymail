(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const d = window.__dymailDemo;
  const calls = () => window.dymailDemoCalls;
  const el = (id) => document.getElementById(id);
  const out = [];
  const rec = (key, value) =>
    out.push(`${key}=${typeof value === 'object' ? JSON.stringify(value) : String(value)}`);
  const label = () => el('account-password-label').textContent;
  const warn = () => ({ hidden: el('account-password-warn').hidden, text: el('account-password-warn').textContent });
  const help = () => ({ hidden: el('account-help').hidden, text: el('account-help').textContent, url: el('account-help').dataset.url || '' });
  const state = () => ({ label: label(), warn: warn(), help: help(), hint: el('account-hint').textContent });
  const setValue = (id, value, event) => {
    el(id).value = value;
    if (event) el(id).dispatchEvent(new Event(event, { bubbles: true }));
  };

  /* fresh dialog: no gmail-specific chrome */
  d.openAccount();
  await wait(300);
  rec('newAccountInitial', { provider: el('account-provider').value, ...state() });

  /* typing a gmail address auto-selects the provider and its guidance */
  setValue('account-email', 'lin.chen@gmail.com');
  el('account-email').dispatchEvent(new Event('blur'));
  await wait(200);
  rec('autodetected', {
    provider: el('account-provider').value,
    imap: el('imap-host').value,
    smtp: el('smtp-host').value,
    ...state()
  });

  setValue('account-password', 'MyLoginPass!', 'input');
  rec('loginPasswordWarn', warn());
  setValue('account-password', 'abcd efgh ijkl mnop', 'input');
  rec('spacedAppPasswordWarn', warn());
  setValue('account-password', 'abcdefghijklmnop', 'input');
  rec('validAppPasswordWarn', warn());

  /* help link opens the Google page outside the app */
  const openedBefore = calls().opened.length;
  el('account-help').click();
  await wait(250);
  rec('helpOpened', {
    grew: calls().opened.length - openedBefore,
    url: calls().opened[calls().opened.length - 1]
  });

  /* another provider resets the form chrome */
  setValue('account-provider', 'qq', 'change');
  await wait(150);
  rec('afterSwitchToQQ', { provider: el('account-provider').value, ...state() });

  /* saving strips the spaces Google prints around app passwords */
  setValue('account-provider', 'gmail', 'change');
  await wait(100);
  setValue('account-email', 'fresh.box@gmail.com');
  setValue('account-name', 'Gmail 账户');
  setValue('account-password', 'abcd efgh ijkl mnop');
  const savedBefore = calls().accountSaves.length;
  el('account-form').requestSubmit();
  await wait(1200);
  rec('savedPayload', calls().accountSaves[savedBefore]);
  rec('dialogClosedAfterSave', !el('account-dialog').open);

  /* editing the existing gmail account keeps the app-password wording */
  const gmail = d.state.accounts.find((item) => /gmail\.com/.test(item.email));
  d.openAccount(gmail && gmail.id);
  await wait(350);
  rec('editGmail', { provider: el('account-provider').value, ...state(), advancedOpen: el('account-advanced').open });
  el('account-dialog').close();
  await wait(150);

  /* editing a non-gmail account falls back to the generic wording */
  const qq = d.state.accounts.find((item) => /qq\.com/.test(item.email));
  d.openAccount(qq && qq.id);
  await wait(350);
  rec('editQQ', { provider: el('account-provider').value, ...state(), advancedOpen: el('account-advanced').open });

  /* leave the Gmail form on screen for the screenshot */
  setValue('account-provider', 'gmail', 'change');
  await wait(150);
  setValue('account-password', 'MyLoginPass!', 'input');
  await wait(200);
  rec('finalFormState', state());

  return out.join('\n');
})()
