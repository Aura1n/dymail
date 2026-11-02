(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const el = (id) => document.getElementById(id);
  const out = [];
  const rec = (key, value) =>
    out.push(`${key}=${typeof value === 'object' ? JSON.stringify(value) : String(value)}`);
  const dismissUpdate = async () => {
    if (!el('update-dialog').open) return;
    el('update-later').click();
    await wait(250);
  };
  const snapshot = (label) => {
    rec(label, {
      provider: el('account-provider').value,
      passwordLabel: el('account-password-label').textContent,
      hint: el('account-hint').textContent,
      helpHidden: el('account-help').hidden,
      helpText: el('account-help').textContent
    });
  };
  const rowText = () => document.getElementById('account-form').getBoundingClientRect().height;

  /* ---------- update dialog still fires at boot ---------- */
  rec('bootOffer', {
    open: el('update-dialog').open,
    from: el('update-from').textContent,
    to: el('update-to').textContent
  });
  rec('bootOpenedUrls', window.dymailDemoCalls.opened.length);
  await dismissUpdate();

  /* ---------- per-provider authorization guidance ---------- */
  el('add-account-btn').click();
  await wait(300);
  const options = [...el('account-provider').options].map((option) => option.value);
  for (const id of options) {
    el('account-provider').value = id;
    el('account-provider').dispatchEvent(new Event('change', { bubbles: true }));
    await wait(60);
    snapshot(`provider.${id}`);
  }
  /* the help link hands its URL to the shell opener */
  el('account-provider').value = 'qq';
  el('account-provider').dispatchEvent(new Event('change', { bubbles: true }));
  await wait(80);
  const openedBefore = window.dymailDemoCalls.opened.length;
  el('account-help').click();
  await wait(200);
  rec('helpClick.qq', window.dymailDemoCalls.opened.slice(openedBefore));
  /* fresh dialog: typing a QQ address auto-picks the provider and keeps the guidance */
  document.querySelector('[data-close="account"]').click();
  await wait(200);
  el('add-account-btn').click();
  await wait(300);
  el('account-email').value = 'demo@qq.com';
  el('account-email').dispatchEvent(new Event('blur'));
  await wait(120);
  snapshot('afterEmailBlur');
  rec('formHeight', Math.round(rowText()));
  document.querySelector('[data-close="account"]').click();
  await wait(200);

  return out.join('\n');
})()
