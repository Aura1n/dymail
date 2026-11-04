(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const el = (id) => document.getElementById(id);
  const d = window.__dymailDemo;
  const out = [];
  const rec = (key, value) =>
    out.push(`${key}=${typeof value === 'object' ? JSON.stringify(value) : String(value)}`);
  const calls = () => window.dymailDemoCalls.autoLaunch;

  if (el('update-dialog').open) {
    el('update-later').click();
    await wait(250);
  }

  d.openSettings('general');
  await wait(320);
  rec('initial', { checked: el('auto-launch-input').checked, state: d.state.autoLaunch, calls: calls().length });

  /* flip it on and save */
  el('auto-launch-input').click();
  await wait(80);
  el('general-save').click();
  await wait(500);
  rec('afterEnable', {
    checked: el('auto-launch-input').checked,
    state: d.state.autoLaunch,
    calls: calls(),
    note: el('general-note').textContent
  });

  /* reopening reads the system state back into the switch */
  document.querySelector('[data-close="settings"]').click();
  await wait(200);
  d.openSettings('general');
  await wait(320);
  rec('reloadShowsOn', { checked: el('auto-launch-input').checked, state: d.state.autoLaunch });

  /* saving without touching the switch must not rewrite the login item */
  const before = calls().length;
  el('general-save').click();
  await wait(500);
  rec('noOpSaveSkips', { newCalls: calls().length - before });

  /* flip it off */
  el('auto-launch-input').click();
  el('general-save').click();
  await wait(500);
  rec('afterDisable', { checked: el('auto-launch-input').checked, state: d.state.autoLaunch, calls: calls() });

  const scroller = document.querySelector('[data-panel="general"] .settings-scroll');
  rec('generalFit', {
    scrollH: scroller.scrollHeight,
    clientH: scroller.clientHeight,
    fits: scroller.scrollHeight <= scroller.clientHeight
  });
  const sheet = document.querySelector('dialog.settings-sheet').getBoundingClientRect();
  rec('sheetHeight', Math.round(sheet.height));

  document.querySelector('[data-close="settings"]').click();
  await wait(200);
  return out.join('\n');
})()
